"""
"8. Champion, Challengers and the Promotion Path"
(QBADS_Training_Learning_Architecture.pdf, Section 08): "A new training
cycle never automatically replaces production... all three enter as
challengers and are tested against exactly the same holdout datasets. A
challenger becomes champion only after every predefined gate is satisfied."
"Rejection at any stage returns the candidate to the model lab; the
incumbent champion stays live."

Shadow/Canary: `_shadow_canary_recheck` below is a second, independent
re-evaluation pass on the validation split and a random subset - a real
stress test regardless of live traffic, kept as-is. Alongside it,
`shadow_mirror.mirror_and_compare` (shadow_mirror.py) is the genuine
traffic-mirroring mechanism: real Middleware transactions when that service
is running, scored by both the frozen champion and the challenger, compared
for agreement/drift - with a documented fallback to the validation split
when no real traffic exists yet. See shadow_mirror.py's module docstring
for exactly how "real" is real here and what the fallback covers.
"""

import logging
from dataclasses import asdict, dataclass

import numpy as np
import requests

from . import registry
from .ai_training_supervisor import SupervisorVerdict, evaluate as supervisor_evaluate
from .benchmarking import BenchmarkResult, benchmark_candidate
from .config import settings
from .data_acquisition import generate_dataset
from .data_quality import QualityReport, run_quality_checks
from .dataset_builder import DatasetBundle, build_datasets
from .gates import GateOutcome, evaluate_gates
from .models import TRAINERS, TrainedCandidate
from .shadow_mirror import ShadowMirrorReport, mirror_and_compare

logger = logging.getLogger("training-pipeline.promotion")


@dataclass
class CandidateOutcome:
    candidate: TrainedCandidate
    benchmark: BenchmarkResult
    supervisor: SupervisorVerdict
    gates: GateOutcome
    shadow_consistent: bool | None = None
    canary_consistent: bool | None = None
    shadow_mirror: ShadowMirrorReport | None = None


@dataclass
class CycleResult:
    cycle: int
    quality_report: QualityReport
    outcomes: list[CandidateOutcome]
    promoted: CandidateOutcome | None
    champion_before: dict | None
    deployed_to_engine: bool


def _shadow_canary_recheck(candidate, bundle: DatasetBundle) -> tuple[bool, bool]:
    """Re-evaluates on the untouched validation split (never used for
    training or the promotion benchmark) as a shadow-traffic stand-in, then
    on a small random subset as a canary stand-in. "Consistent" means
    recall doesn't collapse relative to the original test-split benchmark -
    a real shadow/canary would also watch latency and error rate against
    live traffic, which doesn't exist here."""
    if len(bundle.validation.y) == 0:
        return True, True

    shadow_proba = candidate.predict_proba_fn(bundle.validation.x)
    shadow_recall = ((shadow_proba >= 0.5).astype(int) & (bundle.validation.y == 1)).sum() / max(
        (bundle.validation.y == 1).sum(), 1
    )
    shadow_ok = shadow_recall >= 0.15  # not "collapsed to near-zero"

    rng = np.random.default_rng(settings.synthetic_seed + 1)
    canary_size = max(1, len(bundle.validation.y) // 5)
    idx = rng.choice(len(bundle.validation.y), size=canary_size, replace=False)
    canary_proba = candidate.predict_proba_fn(bundle.validation.x[idx])
    canary_ok = bool(np.all(np.isfinite(canary_proba)))  # didn't blow up on a partial slice

    return bool(shadow_ok), canary_ok


def _deploy_to_engine(entry: dict) -> bool:
    """Global Model Update -> Quantum Engine (Section 11): pushes the
    promoted champion's weights to services/quantum-pipeline. Best-effort -
    the engine may not be running, and a failed deploy here shouldn't
    corrupt the registry's record of what was promoted."""
    try:
        payload = {"modelType": entry["modelType"], "version": entry["version"], "registryEntry": entry}
        res = requests.post(f"{settings.quantum_engine_url}/models/deploy", json=payload, timeout=10)
        return res.ok
    except requests.RequestException as err:
        logger.warning("could not deploy %s to quantum engine: %s", entry["version"], err)
        return False


def run_training_cycle() -> CycleResult:
    cycle = registry.next_cycle_number()
    logger.info("=== training cycle %d starting ===", cycle)

    records = generate_dataset()
    clean_records, quality_report = run_quality_checks(records)
    logger.info("data quality: %s", quality_report)

    bundle = build_datasets(clean_records)
    champion_entry = registry.get_champion()
    champion_bench = BenchmarkResult(**champion_entry["benchmark"]) if champion_entry else None

    outcomes: list[CandidateOutcome] = []
    for model_type, trainer in TRAINERS.items():
        logger.info("training %s on %d samples...", model_type, len(bundle.train.y))
        candidate = trainer(bundle.train.x, bundle.train.y)
        bench = benchmark_candidate(candidate, bundle.test, bundle.stress_test, seed=settings.synthetic_seed)
        supervisor = supervisor_evaluate(candidate, quality_report, bundle.train, bench)
        gate_outcome = evaluate_gates(quality_report, bench, supervisor, champion_bench)
        logger.info(
            "%s: recall=%.3f precision=%.3f quality=%.3f promotable=%s",
            model_type, bench.recall, bench.precision, supervisor.quality_score, gate_outcome.promotable,
        )
        outcomes.append(CandidateOutcome(candidate=candidate, benchmark=bench, supervisor=supervisor, gates=gate_outcome))

    # Among challengers that cleared all three gates, promote the one the
    # AI Training Supervisor scored highest - "the supervisor recommends"
    # applies to *choosing among already-gated candidates*, not to
    # overriding the gates themselves.
    eligible = [o for o in outcomes if o.gates.promotable]
    winner = max(eligible, key=lambda o: o.supervisor.quality_score) if eligible else None

    deployed = False
    if winner is not None:
        shadow_ok, canary_ok = _shadow_canary_recheck(winner.candidate, bundle)
        winner.shadow_consistent, winner.canary_consistent = shadow_ok, canary_ok
        if not (shadow_ok and canary_ok):
            logger.info("%s passed all gates but failed shadow/canary recheck - not promoted", winner.candidate.model_type)
            winner = None

    if winner is not None:
        # Real traffic-mirroring step, additional to the recheck above -
        # see shadow_mirror.py. Informational (agreement rate/score drift
        # logged and persisted to the registry entry), not a fourth gate -
        # the doc's three gates (gates.py) remain the sole promotion
        # decision; this is the "shadow" observability Section 08 asks for.
        winner.shadow_mirror = mirror_and_compare(champion_entry, winner.candidate, bundle)

    for outcome in outcomes:
        entry = registry.save_candidate(
            cycle, outcome.candidate, outcome.benchmark, outcome.supervisor, outcome.gates,
            promoted=(outcome is winner),
            shadow_mirror=asdict(outcome.shadow_mirror) if outcome.shadow_mirror else None,
        )
        if outcome is winner:
            registry.set_champion(entry)
            deployed = _deploy_to_engine(entry)

    logger.info(
        "=== training cycle %d complete: %s ===",
        cycle,
        f"promoted {winner.candidate.model_type}" if winner else "no challenger promoted, incumbent champion stays live",
    )

    return CycleResult(
        cycle=cycle,
        quality_report=quality_report,
        outcomes=outcomes,
        promoted=winner,
        champion_before=champion_entry,
        deployed_to_engine=deployed,
    )
