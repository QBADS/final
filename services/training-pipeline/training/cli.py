"""
Entry point for the Training Intelligence Layer and the Recalibration Layer
that sits beside it. No scheduler daemon (see retrain_triggers.py /
recalibration/triggers.py) - this is what a cron job / task queue would invoke.

    python -m training.cli run                                     # one full training cycle (Sections 02-09)
    python -m training.cli federated                                # one federated-averaging round (Section 11)
    python -m training.cli check-triggers                            # evaluate model-retraining triggers against the current champion
    python -m training.cli recalibrate                                  # one recalibration cycle for the current champion (Recalibration Architecture)
    python -m training.cli check-recalibration-triggers      # evaluate recalibration triggers
    python -m training.cli status                                        # print the registry + current champion
"""

import argparse
import json
import logging
import sys

from . import registry
from .federated_aggregator import run_federated_round
from .promotion import run_training_cycle
from .recalibration import registry as cal_registry
from .recalibration.cycle import run_recalibration_cycle
from .recalibration.triggers import evaluate_triggers as evaluate_recal_triggers, should_refit
from .retrain_triggers import evaluate_triggers, should_retrain

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def cmd_run(_args) -> None:
    result = run_training_cycle()
    summary = {
        "cycle": result.cycle,
        "dataQualityPassed": result.quality_report.passed,
        "candidates": [
            {"modelType": o.candidate.model_type, "recall": o.benchmark.recall, "promotable": o.gates.promotable}
            for o in result.outcomes
        ],
        "promoted": result.promoted.candidate.model_type if result.promoted else None,
        "deployedToEngine": result.deployed_to_engine,
    }
    print(json.dumps(summary, indent=2))


def cmd_federated(_args) -> None:
    champion = registry.get_champion()
    initial_point = None
    if champion and champion["modelType"] == "VQC":
        import numpy as np

        from .config import settings

        weights_path = settings.registry_dir / champion["artifactPath"]
        if weights_path.exists():
            initial_point = np.load(weights_path)

    weights, updates = run_federated_round(initial_point)
    print(
        json.dumps(
            {
                "institutions": [{"id": u.institution_id, "sampleCount": u.sample_count} for u in updates],
                "globalWeightsShape": list(weights.shape),
            },
            indent=2,
        )
    )


def cmd_check_triggers(_args) -> None:
    champion = registry.get_champion()
    if not champion:
        print("no champion registered yet - run `training.cli run` first")
        sys.exit(1)

    bench = champion["benchmark"]
    evaluations = evaluate_triggers(
        current_recall=bench["recall"],
        baseline_recall=bench["recall"],
        false_negative_rate=bench["false_negative_rate"],
        baseline_false_negative_rate=bench["false_negative_rate"],
        data_drift_score=0.0,  # no live traffic distribution to compare against yet
        new_fraud_pattern_detected=False,
    )
    for e in evaluations:
        print(f"{'FIRED' if e.fired else 'ok   '}  {e.trigger}: {e.reason}")
    if should_retrain(evaluations):
        print("\n-> retraining recommended")
        sys.exit(2)
    print("\n-> no retrain trigger fired")


def cmd_recalibrate(_args) -> None:
    result = run_recalibration_cycle()
    summary = {
        "modelType": result.model_type,
        "modelVersion": result.model_version,
        "baselineBrier": result.baseline_reliability.brier,
        "baselineEce": result.baseline_reliability.ece,
        "candidates": [
            {
                "method": o.cal_map.method,
                "recalibrationScore": o.verdict.recalibration_score,
                "promotable": o.gates.promotable,
            }
            for o in result.outcomes
        ],
        "promoted": result.promoted.cal_map.method if result.promoted else None,
        "deployed": result.deployed,
    }
    print(json.dumps(summary, indent=2))


def cmd_check_recalibration_triggers(_args) -> None:
    champion = registry.get_champion()
    if not champion:
        print("no model champion registered yet - run `training.cli run` first")
        sys.exit(1)

    cal_champion = cal_registry.get_calibration_champion(champion["modelType"], champion["version"])
    if not cal_champion:
        print(f"no calibration map promoted yet for {champion['modelType']} {champion['version']} - run `training.cli recalibrate`")
        sys.exit(1)

    index = cal_registry.load_calibration_index()
    matching = [e for e in index if e["calibrationVersion"] == cal_champion["calibrationVersion"]]
    benchmark = matching[-1]["supervisor"]["findings"]["reliability"] if matching else {"brierAfter": 1.0, "eceAfter": 1.0}

    evaluations = evaluate_recal_triggers(
        rolling_brier=benchmark["brierAfter"],
        champion_map_brier_benchmark=benchmark["brierAfter"],
        rolling_ece=benchmark["eceAfter"],
        champion_map_ece_benchmark=benchmark["eceAfter"],
        disagreement_rate_increase_pct=0.0,  # no live Middleware feed to sample this from yet
        backend_or_shots_changed=False,
        new_model_promoted=False,
        holdout_sample_count=matching[-1]["supervisor"]["findings"]["operational"]["holdoutSamples"] if matching else 0,
    )
    for e in evaluations:
        print(f"{'FIRED' if e.fired else 'ok   '}  {e.trigger}: {e.reason}")
    if should_refit(evaluations):
        print("\n-> recalibration recommended")
        sys.exit(2)
    print("\n-> no recalibration trigger fired")


def cmd_status(_args) -> None:
    champion = registry.get_champion()
    index = registry.load_index()
    print(json.dumps({"champion": champion, "totalCandidatesEverTrained": len(index)}, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(prog="training.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run").set_defaults(func=cmd_run)
    sub.add_parser("federated").set_defaults(func=cmd_federated)
    sub.add_parser("check-triggers").set_defaults(func=cmd_check_triggers)
    sub.add_parser("recalibrate").set_defaults(func=cmd_recalibrate)
    sub.add_parser("check-recalibration-triggers").set_defaults(func=cmd_check_recalibration_triggers)
    sub.add_parser("status").set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
