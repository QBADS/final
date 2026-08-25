"""
Orchestrates QBADS_Recalibration_Architecture.pdf's full flow (Section 03)
for whichever model is currently champion in ../registry.py.

Method selection follows Section 05's defaults (Platt for QSVM, temperature
for QNN/VQC) but also always fits isotonic and lets them compete under the
gates - Section 03 step 4 frames this as "CANDIDATE MAP FITTING - METHODS
COMPETE," the same competitive-candidates pattern
../ai_training_supervisor.py already uses for model promotion, rather than
a strict escalate-only-on-failure sequence.
"""

import logging
from dataclasses import dataclass

import requests

from .. import registry as model_registry
from ..config import settings
from . import registry as cal_registry
from .gates import RecalibrationGateOutcome, evaluate_gates
from .methods import FITTERS, CalibrationMap, identity_map
from .reliability import ReliabilityReport, analyze_reliability
from .score_collection import ScoreCollection, collect_scores
from .supervisor import SupervisorVerdict, evaluate as supervisor_evaluate

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


def _deploy(model_type: str, model_version: str, entry: dict) -> bool:
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
            deployed = _deploy(model_type, model_version, entry)

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
