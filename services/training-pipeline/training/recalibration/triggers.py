"""
"9. Recalibration Cadence and Triggers" (QBADS_Recalibration_Architecture.pdf,
Section 09). Same shape as ../retrain_triggers.py, deliberately - "Triggers
A-D extend, rather than duplicate, Training & Learning Architecture Section
10... these govern refitting the map on top of whichever model is currently
champion." No scheduler daemon here either, same reasoning as
../retrain_triggers.py's module docstring.
"""

from dataclasses import dataclass

SCHEDULED_CADENCE = {
    "continuous": "Compare the served-score distribution against the champion map's expected distribution",
    "weekly": "Recompute the reliability diagram against newly confirmed outcomes",
    "on_model_promotion": "Mandatory fresh fit - a new champion serves uncalibrated scores until one clears both gates",
    "emergency": "Immediate refit on a material calibration or disagreement-rate spike",
}


@dataclass
class TriggerEvaluation:
    trigger: str
    fired: bool
    reason: str


def evaluate_triggers(
    *,
    rolling_brier: float,
    champion_map_brier_benchmark: float,
    rolling_ece: float,
    champion_map_ece_benchmark: float,
    disagreement_rate_increase_pct: float,
    backend_or_shots_changed: bool,
    new_model_promoted: bool,
    holdout_sample_count: int,
    drift_threshold: float = 0.03,
    disagreement_spike_threshold_pct: float = 5.0,
    min_holdout_samples: int = 30,
) -> list[TriggerEvaluation]:
    evaluations = []

    brier_drift = rolling_brier - champion_map_brier_benchmark
    ece_drift = rolling_ece - champion_map_ece_benchmark
    evaluations.append(
        TriggerEvaluation(
            trigger="A_calibration_drift",
            fired=brier_drift > drift_threshold or ece_drift > drift_threshold,
            reason=f"brier drift {brier_drift:+.4f}, ece drift {ece_drift:+.4f} vs threshold {drift_threshold}",
        )
    )

    evaluations.append(
        TriggerEvaluation(
            trigger="B_disagreement_spike",
            fired=disagreement_rate_increase_pct > disagreement_spike_threshold_pct,
            reason=f"quantum-vs-classical >40pt gap rate rose {disagreement_rate_increase_pct:.1f}pp",
        )
    )

    evaluations.append(
        TriggerEvaluation(
            trigger="C_backend_or_shot_change",
            fired=backend_or_shots_changed,
            reason="Execution Manager backend/shot count changed" if backend_or_shots_changed else "unchanged",
        )
    )

    evaluations.append(
        TriggerEvaluation(
            trigger="D_model_promotion",
            fired=new_model_promoted,
            reason="new model champion deployed - mandatory fresh fit" if new_model_promoted else "no new promotion",
        )
    )

    thin = holdout_sample_count < min_holdout_samples
    evaluations.append(
        TriggerEvaluation(
            trigger="E_thin_feedback",
            fired=thin,
            reason=f"{holdout_sample_count} confirmed outcomes (min {min_holdout_samples}) - refit blocked, alert only"
            if thin
            else f"{holdout_sample_count} confirmed outcomes, sufficient",
        )
    )

    return evaluations


def should_refit(evaluations: list[TriggerEvaluation]) -> bool:
    # E is "refit blocked, alert only" - it should never itself authorize a
    # refit, only veto one (see cli.py's use of this alongside E's fired state).
    return any(e.fired for e in evaluations if e.trigger != "E_thin_feedback")
