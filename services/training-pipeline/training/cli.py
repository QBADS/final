"""
Entry point for the Training Intelligence Layer and the Recalibration Layer
that sits beside it.

    python -m training.cli run                                     # one full training cycle (Sections 02-09)
    python -m training.cli federated                                # one federated-averaging round (Section 11)
    python -m training.cli check-triggers                            # evaluate model-retraining triggers against the current champion
    python -m training.cli recalibrate                                  # one recalibration cycle for the current champion (Recalibration Architecture)
    python -m training.cli check-recalibration-triggers      # evaluate recalibration triggers
    python -m training.cli recalibrate-rollback --model-version <v> [--to <calibration-id> | --identity]   # instant rollback (Section 10)
    python -m training.cli daemon [--duration-seconds N] [--trigger-check-seconds N] ...   # Section 10 cadence scheduler, see daemon.py
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
from .recalibration.cycle import deploy_calibration_map, run_recalibration_cycle
from .recalibration.triggers import evaluate_triggers as evaluate_recal_triggers, should_refit
from .retrain_triggers import should_retrain
from .trigger_runner import check_triggers_now

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def cmd_run(_args) -> None:
    result = run_training_cycle()
    summary = {
        "cycle": result.cycle,
        "dataQualityPassed": result.quality_report.passed,
        "datasetCategories": {
            "counts": result.quality_report.category_counts,
            "present": f"{result.quality_report.categories_present}/{len(result.quality_report.category_counts)}",
            "missing": result.quality_report.categories_missing,
        },
        "candidates": [
            {"modelType": o.candidate.model_type, "recall": o.benchmark.recall, "promotable": o.gates.promotable}
            for o in result.outcomes
        ],
        "promoted": result.promoted.candidate.model_type if result.promoted else None,
        "deployedToEngine": result.deployed_to_engine,
        "shadowMirror": (
            {
                "source": result.promoted.shadow_mirror.source,
                "sampleCount": result.promoted.shadow_mirror.sample_count,
                "agreementRate": result.promoted.shadow_mirror.agreement_rate,
                "meanScoreDrift": result.promoted.shadow_mirror.mean_score_drift,
            }
            if result.promoted and result.promoted.shadow_mirror
            else None
        ),
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
    evaluations, champion = check_triggers_now()
    if not champion:
        print("no champion registered yet - run `training.cli run` first")
        sys.exit(1)

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
    # .get(..., default) throughout: a `recalibrate-rollback` entry (e.g. an
    # identity rollback with no prior model registry entry to measure
    # against) may carry partially-filled findings, same shape either way.
    findings = matching[-1].get("supervisor", {}).get("findings", {}) if matching else {}
    benchmark = findings.get("reliability") or {"brierAfter": 1.0, "eceAfter": 1.0}
    holdout_samples = (findings.get("operational") or {}).get("holdoutSamples") or 0

    evaluations = evaluate_recal_triggers(
        rolling_brier=benchmark["brierAfter"],
        champion_map_brier_benchmark=benchmark["brierAfter"],
        rolling_ece=benchmark["eceAfter"],
        champion_map_ece_benchmark=benchmark["eceAfter"],
        disagreement_rate_increase_pct=0.0,  # no live Middleware feed to sample this from yet
        backend_or_shots_changed=False,
        new_model_promoted=False,
        holdout_sample_count=holdout_samples,
    )
    for e in evaluations:
        print(f"{'FIRED' if e.fired else 'ok   '}  {e.trigger}: {e.reason}")
    if should_refit(evaluations):
        print("\n-> recalibration recommended")
        sys.exit(2)
    print("\n-> no recalibration trigger fired")


def _resolve_model_type(model_version: str) -> str | None:
    """A model registry version string is already type-prefixed
    ("QNN-c1") - prefer an exact lookup in ../registry.py's index (works
    even if that convention ever changes), falling back to the prefix
    itself when the version was never actually trained here."""
    matches = [e for e in registry.load_index() if e["version"] == model_version]
    if matches:
        return matches[-1]["modelType"]
    champion = registry.get_champion()
    if champion and champion["version"] == model_version:
        return champion["modelType"]
    prefix = model_version.split("-", 1)[0]
    return prefix or None


def cmd_recalibrate_rollback(args) -> None:
    model_version = args.model_version
    model_type = _resolve_model_type(model_version)
    if model_type is None:
        print(f"could not determine model type for version {model_version!r}")
        sys.exit(1)

    if args.to and args.identity:
        print("pass at most one of --to / --identity")
        sys.exit(1)

    reliability_findings, holdout_samples = None, None
    if args.identity:
        method, params, calibration_version = "identity", {}, "identity"
        source = "identity map (raw score passthrough)"
        # No fitted candidate to copy findings from - measure the identity
        # map's own reliability on a fresh holdout so this entry stays
        # readable the same way a normal fitted entry is (e.g. by
        # `check-recalibration-triggers`), rather than leaving it blank.
        model_entry = next((e for e in registry.load_index() if e["version"] == model_version), None)
        if model_entry is not None:
            from .recalibration.reliability import analyze_reliability
            from .recalibration.score_collection import collect_scores

            scores = collect_scores(model_entry)
            identity_reliability = analyze_reliability(scores.raw_scores, scores.outcomes)
            reliability_findings = {
                "brierBefore": identity_reliability.brier, "brierAfter": identity_reliability.brier,
                "eceBefore": identity_reliability.ece, "eceAfter": identity_reliability.ece,
            }
            holdout_samples = scores.holdout_size
    elif args.to:
        historical = cal_registry.get_calibration_by_version(model_type, model_version, args.to)
        if historical is None:
            print(f"no calibration map {args.to!r} found in the registry history for {model_type} {model_version}")
            sys.exit(1)
        method, params, calibration_version = historical["method"], historical["params"], historical["calibrationVersion"]
        source = f"historical map {calibration_version} ({method})"
        reliability_findings = historical.get("supervisor", {}).get("findings", {}).get("reliability")
        holdout_samples = historical.get("supervisor", {}).get("findings", {}).get("operational", {}).get("holdoutSamples")
    else:
        previous = cal_registry.get_previous_champion(model_type, model_version)
        if previous is None:
            print(
                f"no previous champion calibration map recorded for {model_type} {model_version} - "
                "pass --identity to revert to raw score passthrough, or --to <calibration-id> for a specific map"
            )
            sys.exit(1)
        method, params, calibration_version = previous["method"], previous["params"], previous["calibrationVersion"]
        source = f"previous champion map {calibration_version} ({method})"
        reliability_findings = previous.get("supervisor", {}).get("findings", {}).get("reliability")
        holdout_samples = previous.get("supervisor", {}).get("findings", {}).get("operational", {}).get("holdoutSamples")

    deployed = deploy_calibration_map(
        model_type, model_version,
        {"calibrationVersion": calibration_version, "method": method, "params": params},
    )
    if not deployed:
        print(f"rollback FAILED - could not deploy {source} to the quantum engine")
        sys.exit(1)

    entry = cal_registry.record_rollback(
        model_type, model_version,
        calibration_version=calibration_version, method=method, params=params,
        rolled_back_to=calibration_version,
        reliability_findings=reliability_findings, holdout_samples=holdout_samples,
    )
    print(f"rolled back {model_type} {model_version} to {source} - now live and champion of record")
    print(json.dumps(
        {
            "modelType": model_type,
            "modelVersion": model_version,
            "rolledBackTo": calibration_version,
            "method": entry["method"],
            "params": entry["params"],
            "deployed": deployed,
        },
        indent=2,
    ))


def cmd_daemon(args) -> None:
    from .daemon import run_daemon

    run_daemon(
        duration_seconds=args.duration_seconds,
        trigger_check_seconds=args.trigger_check_seconds,
        weekly_seconds=args.weekly_seconds,
        monthly_seconds=args.monthly_seconds,
        quarterly_seconds=args.quarterly_seconds,
        tick_seconds=args.tick_seconds,
    )


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

    rollback = sub.add_parser("recalibrate-rollback")
    rollback.add_argument("--model-version", required=True, help='e.g. "QNN-c1" - must match a champion registry version')
    rollback.add_argument("--to", metavar="CALIBRATION_ID", help='a specific historical calibrationVersion, e.g. "cal-c3"')
    rollback.add_argument("--identity", action="store_true", help="revert to an identity map (raw score passthrough)")
    rollback.set_defaults(func=cmd_recalibrate_rollback)

    daemon = sub.add_parser("daemon", help="run the Section 10 cadence scheduler (see daemon.py)")
    daemon.add_argument(
        "--duration-seconds", type=float, default=None,
        help="stop after this many seconds (default: run forever - Ctrl+C to stop). Useful for demos/tests.",
    )
    daemon.add_argument("--trigger-check-seconds", type=float, default=None, help="overrides TRAINING_DAEMON_TRIGGER_CHECK_SECONDS")
    daemon.add_argument("--weekly-seconds", type=float, default=None, help="overrides TRAINING_DAEMON_WEEKLY_SECONDS")
    daemon.add_argument("--monthly-seconds", type=float, default=None, help="overrides TRAINING_DAEMON_MONTHLY_SECONDS")
    daemon.add_argument("--quarterly-seconds", type=float, default=None, help="overrides TRAINING_DAEMON_QUARTERLY_SECONDS")
    daemon.add_argument("--tick-seconds", type=float, default=None, help="overrides TRAINING_DAEMON_TICK_SECONDS")
    daemon.set_defaults(func=cmd_daemon)

    sub.add_parser("status").set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
