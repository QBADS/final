"""
Gathers real signals from the registry for retrain_triggers.evaluate_triggers
and runs them against the current champion - shared by `training.cli
check-triggers` (cli.py) and the scheduler daemon (daemon.py), so the two
paths cannot silently drift apart from each other.
"""

from . import registry
from .config import settings
from .retrain_triggers import TriggerEvaluation, compute_quantum_drift_score, evaluate_triggers


def check_triggers_now() -> tuple[list[TriggerEvaluation], dict | None]:
    """Returns (evaluations, champion_entry). champion_entry is None when
    nothing has ever been promoted yet - callers should treat that as
    "nothing to check", not as an error."""
    champion = registry.get_champion()
    if not champion:
        return [], None

    bench = champion["benchmark"]

    # Trigger E's rolling baseline: past cycles of the *same* model type,
    # excluding the champion's own entry, most recent window first -
    # mirrors how Trigger C's data_drift_score would be computed from a
    # historical distribution if this repo had live traffic to sample it
    # from (see cli.py's cmd_check_triggers comment on data_drift_score).
    index = registry.load_index()
    history = [
        e
        for e in index
        if e["modelType"] == champion["modelType"] and e["version"] != champion["version"]
    ][-settings.quantum_drift_baseline_window:]
    historical_noise = [e["benchmark"]["noise_sensitivity"] for e in history]
    historical_depth = [e["benchmark"]["circuit_depth"] for e in history]

    quantum_drift_score = compute_quantum_drift_score(
        current_noise_sensitivity=bench["noise_sensitivity"],
        current_circuit_depth=bench["circuit_depth"],
        historical_noise_sensitivities=historical_noise,
        historical_circuit_depths=historical_depth,
    )

    evaluations = evaluate_triggers(
        current_recall=bench["recall"],
        baseline_recall=bench["recall"],
        false_negative_rate=bench["false_negative_rate"],
        baseline_false_negative_rate=bench["false_negative_rate"],
        data_drift_score=0.0,  # no live traffic distribution to compare against yet
        new_fraud_pattern_detected=False,
        quantum_drift_score=quantum_drift_score,
        quantum_drift_threshold=settings.quantum_drift_threshold,
    )
    return evaluations, champion
