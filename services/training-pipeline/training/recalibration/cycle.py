"""
Orchestrates QBADS_Recalibration_Architecture.pdf's full flow (Section 03)
for whichever model is currently champion in ../registry.py.

Method selection follows Section 05's defaults (Platt for QSVM, temperature
for QNN/VQC) but also always fits isotonic and lets them compete under the
gates - Section 03 step 4 frames this as "CANDIDATE MAP FITTING - METHODS
COMPETE," the same competitive-candidates pattern
../ai_training_supervisor.py already uses for model promotion, rather than
a strict escalate-only-on-failure sequence.

Per-candidate call order (Section 05): fit -> monotonicity pre-filter ->
AI Recalibration Supervisor -> gates. "A calibration map may only be a
monotonic transform of the raw score. Any candidate that reorders two
score bands out of rank... is discarded before it reaches the Supervisor."
`_reject_non_monotonic` below is that hard pre-filter: a non-monotonic
candidate is turned into a rejected outcome directly and `supervisor.evaluate`
is never called on it - not even to have the Supervisor assign it a fail
score. Only candidates that pass the pre-filter reach `supervisor_evaluate`.
"""

import logging
from dataclasses import dataclass

import requests

from .. import registry as model_registry
from ..config import settings
from . import registry as cal_registry
from .gates import GateResult, RecalibrationGateOutcome, evaluate_gates
from .methods import FITTERS, CalibrationMap, identity_map, is_monotonic
from .reliability import ReliabilityReport, analyze_reliability
from .score_collection import ScoreCollection, collect_scores
from .supervisor import RankSafetyCheck, SupervisorVerdict, evaluate as supervisor_evaluate

logger = logging.getLogger("training-pipeline.recalibration")

DEFAULT_METHOD = {"QSVM": "platt", "QNN": "temperature", "VQC": "temperature"}


@dataclass
class CandidateMapOutcome:
    cal_map: CalibrationMap
    verdict: SupervisorVerdict
    gates: RecalibrationGateOutcome


@dataclass
class RecalibrationCycleResult:
    model_type: str
    model_version: str
    baseline_reliability: ReliabilityReport
    outcomes: list[CandidateMapOutcome]
    promoted: CandidateMapOutcome | None
    deployed: bool


def _current_baseline_map(model_type: str, model_version: str) -> CalibrationMap:
    """The map currently serving in production for this exact model version -
    identity if none has ever cleared both gates for it yet (Section 08:
    "the new champion serves raw, uncalibrated scores until a fresh map
    clears both gates")."""
    existing = cal_registry.get_calibration_champion(model_type, model_version)
    if existing is None:
        return identity_map()
    return CalibrationMap(method=existing["method"], params=existing["params"])


def _reject_non_monotonic(cal_map: CalibrationMap) -> CandidateMapOutcome:
    """Hard pre-filter outcome for a candidate map that fails the Section 05
    monotonicity constraint. Built directly, without calling
    `supervisor.evaluate` - the candidate is discarded before it ever
    reaches the AI Recalibration Supervisor, per the spec's call order."""
    rank_safety = RankSafetyCheck(
        monotonic=False,
        recall_before=0.0,
        recall_after=0.0,
        precision_before=0.0,
        precision_after=0.0,
        threshold_population_shift_pct=0.0,
        passed=False,
    )
    verdict = SupervisorVerdict(
        method=cal_map.method,
        reliability_score=0.0,
        rank_safety=rank_safety,
        operational_score=0.0,
        recalibration_score=0.0,
        recommend=False,
        findings={
            "reliability": {"brierBefore": None, "brierAfter": None, "eceBefore": None, "eceAfter": None},
            "operational": {"latencyMs": None, "holdoutSamples": None, "sampleAdequate": None},
            "preFilterRejected": True,
            "preFilterReason": "candidate map is not monotonic - discarded before it reached the Supervisor (Section 05)",
        },
    )
    fidelity_gate = GateResult(
        name="fidelity",
        passed=False,
        ran=True,
        reasons=["candidate map is not monotonic - rejected by the pre-Supervisor monotonicity filter, never scored"],
    )
    deployment_gate = GateResult(name="skipped", passed=False, ran=False, reasons=["upstream gate failed"])
    gates = RecalibrationGateOutcome(fidelity_gate=fidelity_gate, deployment_gate=deployment_gate)
    return CandidateMapOutcome(cal_map=cal_map, verdict=verdict, gates=gates)


def deploy_calibration_map(model_type: str, model_version: str, entry: dict) -> bool:
    try:
        res = requests.post(
            f"{settings.quantum_engine_url}/models/recalibrate",
            json={
                "modelType": model_type,
                "version": model_version,
                "calibrationVersion": entry["calibrationVersion"],
                "method": entry["method"],
                "params": entry["params"],
            },
            timeout=10,
        )
        return res.ok
    except requests.RequestException as err:
        logger.warning("could not deploy calibration map for %s %s: %s", model_type, model_version, err)
        return False


def run_recalibration_cycle() -> RecalibrationCycleResult:
    champion = model_registry.get_champion()
    if champion is None:
        raise RuntimeError("no model champion registered yet - run `training.cli run` first")

    model_type, model_version = champion["modelType"], champion["version"]
    logger.info("=== recalibration cycle starting for %s %s ===", model_type, model_version)

    scores: ScoreCollection = collect_scores(champion)
    baseline_map = _current_baseline_map(model_type, model_version)
    baseline_scores = baseline_map.apply(scores.raw_scores)
    baseline_reliability = analyze_reliability(baseline_scores, scores.outcomes)
    logger.info(
        "baseline (%s map): brier=%.4f ece=%.4f on %d holdout samples",
        baseline_map.method, baseline_reliability.brier, baseline_reliability.ece, scores.holdout_size,
    )

    methods_to_try = {DEFAULT_METHOD[model_type], "isotonic"}
    outcomes: list[CandidateMapOutcome] = []
    for method in methods_to_try:
        cal_map = FITTERS[method](scores.raw_scores, scores.outcomes)

        # Hard pre-filter (Section 05), run BEFORE the Supervisor ever sees
        # the candidate: a non-monotonic map is discarded here and never
        # passed into supervisor_evaluate at all.
        if not is_monotonic(cal_map):
            logger.info("%s: REJECTED before reaching the Supervisor - candidate map is not monotonic", method)
            outcomes.append(_reject_non_monotonic(cal_map))
            continue

        verdict = supervisor_evaluate(cal_map, scores.raw_scores, scores.outcomes, baseline_reliability)
        gate_outcome = evaluate_gates(verdict)
        logger.info(
            "%s: recalibration_score=%.3f promotable=%s (brier %.4f->%.4f)",
            method, verdict.recalibration_score, gate_outcome.promotable,
            verdict.findings["reliability"]["brierBefore"], verdict.findings["reliability"]["brierAfter"],
        )
        outcomes.append(CandidateMapOutcome(cal_map=cal_map, verdict=verdict, gates=gate_outcome))

    eligible = [o for o in outcomes if o.gates.promotable]
    winner = max(eligible, key=lambda o: o.verdict.recalibration_score) if eligible else None

    cycle = cal_registry.next_calibration_version()
    deployed = False
    for outcome in outcomes:
        entry = cal_registry.save_candidate(
            cycle, model_type, model_version, outcome.cal_map, outcome.verdict, outcome.gates,
            promoted=(outcome is winner),
        )
        if outcome is winner:
            cal_registry.set_calibration_champion(entry)
            deployed = deploy_calibration_map(model_type, model_version, entry)

    logger.info(
        "=== recalibration cycle complete: %s ===",
        f"promoted {winner.cal_map.method}" if winner else "no candidate map promoted, incumbent map stays live",
    )

    return RecalibrationCycleResult(
        model_type=model_type,
        model_version=model_version,
        baseline_reliability=baseline_reliability,
        outcomes=outcomes,
        promoted=winner,
        deployed=deployed,
    )
