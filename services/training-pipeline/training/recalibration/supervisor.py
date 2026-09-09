"""
"6. AI Recalibration Supervisor: reliability - rank-safety - operational"
(QBADS_Recalibration_Architecture.pdf, Section 06). "The supervisor must
not conclude 'Brier improved, ship it.'"

Rule: "the supervisor recommends; it never overrides deterministic
evaluation. Rank Safety stays a hard, deterministic floor independent of
the Supervisor's score." Mirrors training/ai_training_supervisor.py's own
rule for model promotion - gates.py's Gate 1 re-checks rank safety
independently of whatever this recommends, same pattern.

Monotonicity itself (Section 05: "a calibration map may only be a
monotonic transform of the raw score... discarded before it reaches the
Supervisor") is enforced upstream, in cycle.py, as a hard pre-filter on
the freshly-fitted candidate - a non-monotonic map never reaches
`evaluate` below at all. The `monotonic` field on `RankSafetyCheck` here
is therefore always True by the time this module runs; it stays part of
the record purely as a redundant confirmation/telemetry field, not as the
enforcement point.
"""

import time
from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics import precision_score, recall_score

from .methods import CalibrationMap, is_monotonic
from .reliability import ReliabilityReport, analyze_reliability

# Quantum Engine's existing fixed risk-level thresholds
# (services/quantum-pipeline/app/postprocessing.py) - unchanged by this
# layer; the whole point is to check calibration doesn't quietly shift who
# lands on which side of them.
HIGH_THRESHOLD = 0.65
MEDIUM_THRESHOLD = 0.3

MIN_HOLDOUT_SAMPLES = 30


@dataclass
class RankSafetyCheck:
    monotonic: bool
    recall_before: float
    recall_after: float
    precision_before: float
    precision_after: float
    threshold_population_shift_pct: float  # max shift in any risk band's population share
    passed: bool


@dataclass
class SupervisorVerdict:
    method: str
    reliability_score: float
    rank_safety: RankSafetyCheck
    operational_score: float
    recalibration_score: float
    recommend: bool
    findings: dict = field(default_factory=dict)


def _risk_band(scores: np.ndarray) -> np.ndarray:
    bands = np.zeros(len(scores), dtype=int)  # 0=low, 1=medium, 2=high
    bands[scores > MEDIUM_THRESHOLD] = 1
    bands[scores > HIGH_THRESHOLD] = 2
    return bands


def _rank_safety(
    cal_map: CalibrationMap,
    raw_scores: np.ndarray,
    calibrated_scores: np.ndarray,
    outcomes: np.ndarray,
    max_metric_drift: float,
    max_population_shift: float,
) -> RankSafetyCheck:
    monotonic = is_monotonic(cal_map)

    pred_before = (raw_scores >= HIGH_THRESHOLD).astype(int)
    pred_after = (calibrated_scores >= HIGH_THRESHOLD).astype(int)
    recall_before = float(recall_score(outcomes, pred_before, zero_division=0))
    recall_after = float(recall_score(outcomes, pred_after, zero_division=0))
    precision_before = float(precision_score(outcomes, pred_before, zero_division=0))
    precision_after = float(precision_score(outcomes, pred_after, zero_division=0))

    bands_before = _risk_band(raw_scores)
    bands_after = _risk_band(calibrated_scores)
    shift = max(
        abs((bands_before == b).mean() - (bands_after == b).mean()) for b in (0, 1, 2)
    ) if len(raw_scores) else 0.0

    passed = (
        monotonic
        and abs(recall_after - recall_before) <= max_metric_drift
        and abs(precision_after - precision_before) <= max_metric_drift
        and shift <= max_population_shift
    )

    return RankSafetyCheck(
        monotonic=monotonic,
        recall_before=recall_before,
        recall_after=recall_after,
        precision_before=precision_before,
        precision_after=precision_after,
        threshold_population_shift_pct=round(shift * 100, 2),
        passed=passed,
    )


def evaluate(
    cal_map: CalibrationMap,
    raw_scores: np.ndarray,
    outcomes: np.ndarray,
    champion_reliability: ReliabilityReport,
    *,
    max_metric_drift: float = 0.03,
    max_population_shift: float = 0.08,
    min_quality_score: float = 0.55,
) -> SupervisorVerdict:
    calibrated_scores = cal_map.apply(raw_scores)
    candidate_reliability = analyze_reliability(calibrated_scores, outcomes)

    # Reliability: did Brier / ECE actually improve over the frozen champion's raw score?
    brier_gain = champion_reliability.brier - candidate_reliability.brier
    ece_gain = champion_reliability.ece - candidate_reliability.ece
    reliability_score = float(np.clip(0.5 + brier_gain * 5 + ece_gain * 5, 0, 1))

    rank_safety = _rank_safety(
        cal_map, raw_scores, calibrated_scores, outcomes, max_metric_drift, max_population_shift
    )

    t0 = time.time()
    cal_map.apply(raw_scores[:1])
    latency_ms = (time.time() - t0) * 1000
    sample_adequacy = min(len(raw_scores) / MIN_HOLDOUT_SAMPLES, 1.0)
    operational_score = float(np.clip(sample_adequacy * 0.7 + (1.0 if latency_ms < 5 else 0.3) * 0.3, 0, 1))

    recalibration_score = (
        reliability_score * 0.5 + (1.0 if rank_safety.passed else 0.0) * 0.3 + operational_score * 0.2
    )

    return SupervisorVerdict(
        method=cal_map.method,
        reliability_score=reliability_score,
        rank_safety=rank_safety,
        operational_score=operational_score,
        recalibration_score=float(recalibration_score),
        recommend=recalibration_score >= min_quality_score and rank_safety.passed,
        findings={
            "reliability": {
                "brierBefore": champion_reliability.brier,
                "brierAfter": candidate_reliability.brier,
                "eceBefore": champion_reliability.ece,
                "eceAfter": candidate_reliability.ece,
            },
            "operational": {
                "latencyMs": round(latency_ms, 4),
                "holdoutSamples": len(raw_scores),
                "sampleAdequate": len(raw_scores) >= MIN_HOLDOUT_SAMPLES,
            },
        },
    )
