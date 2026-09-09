"""
"10. Retraining: Cadence and Triggers" (QBADS_Training_Learning_Architecture.pdf,
Section 10): "Retraining is event-driven as well as calendar-driven. Both
mechanisms run simultaneously." No scheduler daemon runs in this repo (that
would be a cron/task-queue concern for actual deployment, not something to
fake by leaving a background process running in a dev session) - what's
here are the pure trigger-evaluation functions plus the documented cadence
table, so wiring in a real scheduler later is "call these on a timer," not
"design the retraining logic."
"""

from dataclasses import dataclass

import numpy as np

SCHEDULED_CADENCE = {
    "continuous": "Collect confirmed outcomes and monitor live performance",
    "daily": "Data-quality and drift analysis",
    "weekly": "Candidate evaluation; lightweight retraining if sufficient new data",
    "monthly": "Full model comparison and retraining",
    "quarterly": "Deep model and circuit review",
    "emergency": "Immediate retraining on severe degradation or a new fraud pattern",
}


@dataclass
class TriggerEvaluation:
    trigger: str
    fired: bool
    reason: str


def compute_quantum_drift_score(
    current_noise_sensitivity: float,
    current_circuit_depth: float,
    historical_noise_sensitivities: list[float],
    historical_circuit_depths: list[float],
) -> float:
    """Trigger E's real signal, mirroring how Trigger C's `data_drift_score`
    is computed by its caller: a rolling historical baseline (mean of the
    same model type's past cycles, pulled from the registry by
    `trigger_runner.check_triggers_now`) compared against the current
    candidate/champion's own quantum-specific benchmarking.py metrics
    (noise-sensitivity under input perturbation, circuit-depth). Returns a
    0-1+ relative-deviation score, the larger of the two metrics' relative
    deviation from their own rolling mean - a real, useful measure of
    simulator-level circuit/backend behavior drift between training runs,
    not a claim about live QPU backend drift (there is no QPU here).

    With no history yet (first cycle for this model type) there is nothing
    to drift from, so this returns 0.0 rather than fabricating a baseline.
    """
    if not historical_noise_sensitivities or not historical_circuit_depths:
        return 0.0

    baseline_noise = float(np.mean(historical_noise_sensitivities))
    baseline_depth = float(np.mean(historical_circuit_depths))

    noise_dev = abs(current_noise_sensitivity - baseline_noise) / max(baseline_noise, 1e-6)
    depth_dev = abs(current_circuit_depth - baseline_depth) / max(baseline_depth, 1e-6)

    return float(max(noise_dev, depth_dev))


def evaluate_triggers(
    *,
    current_recall: float,
    baseline_recall: float,
    false_negative_rate: float,
    baseline_false_negative_rate: float,
    data_drift_score: float,  # 0-1, e.g. population-stability-index-style metric; caller supplies it
    new_fraud_pattern_detected: bool,
    recall_floor: float = 0.5,
    fnr_spike_threshold: float = 0.1,
    drift_threshold: float = 0.25,
    quantum_drift_score: float = 0.0,  # see compute_quantum_drift_score() above; caller supplies it
    quantum_drift_threshold: float = 0.35,
) -> list[TriggerEvaluation]:
    """
    Section 10's five triggers (A-E). E (quantum drift) is explicitly
    marked in the doc as "a future capability" - it's implemented here for
    real (see compute_quantum_drift_score above), scoped honestly: this
    detects simulator-level circuit/backend behavior drift between training
    runs (noise-sensitivity + circuit-depth deviation from a rolling
    registry baseline), not real live QPU backend drift, since there is no
    QPU in this repo to drift.
    """
    evaluations = []

    evaluations.append(
        TriggerEvaluation(
            trigger="A_performance",
            fired=current_recall < recall_floor,
            reason=f"recall {current_recall:.3f} vs floor {recall_floor}",
        )
    )

    fnr_increase = false_negative_rate - baseline_false_negative_rate
    evaluations.append(
        TriggerEvaluation(
            trigger="B_false_negatives",
            fired=fnr_increase > fnr_spike_threshold,
            reason=f"false-negative rate {baseline_false_negative_rate:.3f} -> {false_negative_rate:.3f}",
        )
    )

    evaluations.append(
        TriggerEvaluation(
            trigger="C_data_drift",
            fired=data_drift_score > drift_threshold,
            reason=f"drift score {data_drift_score:.3f} vs threshold {drift_threshold}",
        )
    )

    evaluations.append(
        TriggerEvaluation(
            trigger="D_new_fraud_pattern",
            fired=new_fraud_pattern_detected,
            reason="novel pattern flagged" if new_fraud_pattern_detected else "none flagged",
        )
    )

    evaluations.append(
        TriggerEvaluation(
            trigger="E_quantum_drift",
            fired=quantum_drift_score > quantum_drift_threshold,
            reason=(
                f"quantum backend drift score {quantum_drift_score:.3f} vs threshold {quantum_drift_threshold} "
                "(noise-sensitivity + circuit-depth deviation from rolling registry baseline; "
                "simulator-level only - no live QPU backend to compare against)"
            ),
        )
    )

    return evaluations


def should_retrain(evaluations: list[TriggerEvaluation]) -> bool:
    return any(e.fired for e in evaluations)
