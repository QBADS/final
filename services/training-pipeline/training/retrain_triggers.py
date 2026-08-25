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
) -> list[TriggerEvaluation]:
    """
    Section 10's five triggers (A-E). E (quantum drift) is explicitly
    marked in the doc as "identified as a future capability" - included
    here as a permanently-not-fired stub for completeness, not evaluated,
    since there's no cross-backend comparison to detect it against (see
    ai_training_supervisor.py's quantum-quality "backend_drift: n/a" note).
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
            fired=False,
            reason="not implemented - doc marks this a future capability, no cross-backend signal exists yet",
        )
    )

    return evaluations


def should_retrain(evaluations: list[TriggerEvaluation]) -> bool:
    return any(e.fired for e in evaluations)
