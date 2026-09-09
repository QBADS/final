"""
Section 10's cadence table ("Retraining is event-driven as well as
calendar-driven. Both mechanisms run simultaneously.") wired to actual runs.

retrain_triggers.py + trigger_runner.py had the real, tested
trigger-evaluation logic but nothing called them on a schedule - this module
is that scheduler: a plain stdlib interval loop (no new dependency - see
requirements.txt, nothing sched/task-queue-shaped is already pulled in
transitively), real enough that a deployer would wrap *this* in
systemd/cron/a container, not rewrite it.

Four cadences run independently, each on its own configurable interval
(env vars below, or CLI flags - see cli.py's `daemon` subcommand):

  - trigger check   (continuous/daily, Section 10): runs
    trigger_runner.check_triggers_now() and, if any trigger fires,
    automatically invokes `training.cli run` (promotion.run_training_cycle).
  - weekly cadence:  "Candidate evaluation; lightweight retraining if
    sufficient new data" - logged, plus a trigger check (candidate
    evaluation without necessarily a full retrain).
  - monthly cadence: "Full model comparison and retraining" - runs a full
    training cycle unconditionally, per the doc's own wording.
  - quarterly cadence: "Deep model and circuit review" - runs a full
    training cycle and explicitly logs the quantum-specific (Trigger E)
    findings, since a circuit review is exactly what that trigger checks.

Real-world defaults are the actual weeks/months/quarters cadence implies;
every interval is overridable via TRAINING_DAEMON_*_SECONDS (config.py) or
the matching --*-seconds CLI flag, specifically so this is demonstrable on
a short interval rather than only asserted to work.
"""

import logging
import time
from datetime import datetime, timezone

from . import registry
from .config import settings
from .promotion import run_training_cycle
from .retrain_triggers import SCHEDULED_CADENCE, should_retrain
from .trigger_runner import check_triggers_now

logger = logging.getLogger("training-pipeline.daemon")


def _run_full_cycle(reason: str) -> None:
    logger.info("daemon: invoking training.cli run automatically (%s)", reason)
    result = run_training_cycle()
    promoted = result.promoted.candidate.model_type if result.promoted else None
    logger.info("daemon: training run complete (%s) - promoted=%s", reason, promoted)


def _trigger_check_cycle(cycle: int, label: str) -> None:
    evaluations, champion = check_triggers_now()
    if champion is None:
        logger.info("daemon cycle %d [%s]: no champion registered yet - skipping trigger check", cycle, label)
        return
    for e in evaluations:
        logger.info("daemon cycle %d [%s]: %s %s - %s", cycle, label, "FIRED" if e.fired else "ok  ", e.trigger, e.reason)
    if should_retrain(evaluations):
        _run_full_cycle(reason=f"{label} cadence, trigger fired against champion {champion['version']}")
    else:
        logger.info("daemon cycle %d [%s]: no trigger fired - skipped run", cycle, label)


def run_daemon(
    duration_seconds: float | None = None,
    trigger_check_seconds: float | None = None,
    weekly_seconds: float | None = None,
    monthly_seconds: float | None = None,
    quarterly_seconds: float | None = None,
    tick_seconds: float | None = None,
) -> None:
    trigger_check_seconds = trigger_check_seconds or settings.daemon_trigger_check_seconds
    weekly_seconds = weekly_seconds or settings.daemon_weekly_seconds
    monthly_seconds = monthly_seconds or settings.daemon_monthly_seconds
    quarterly_seconds = quarterly_seconds or settings.daemon_quarterly_seconds
    tick_seconds = tick_seconds or settings.daemon_tick_seconds

    logger.info(
        "=== training daemon starting (trigger-check every %.0fs, weekly every %.0fs, "
        "monthly every %.0fs, quarterly every %.0fs, duration=%s) ===",
        trigger_check_seconds, weekly_seconds, monthly_seconds, quarterly_seconds,
        f"{duration_seconds:.0f}s" if duration_seconds is not None else "unbounded",
    )
    for cadence, description in SCHEDULED_CADENCE.items():
        logger.info("cadence table: %-10s -> %s", cadence, description)

    start = time.monotonic()
    next_trigger_check = start
    next_weekly = start + weekly_seconds
    next_monthly = start + monthly_seconds
    next_quarterly = start + quarterly_seconds
    cycle = 0

    try:
        while True:
            now = time.monotonic()
            elapsed = now - start
            if duration_seconds is not None and elapsed >= duration_seconds:
                logger.info("daemon: reached configured duration (%.0fs) - stopping", duration_seconds)
                break

            if now >= next_trigger_check:
                cycle += 1
                logger.info("daemon cycle %d: continuous/daily trigger check at %s", cycle, datetime.now(timezone.utc).isoformat())
                _trigger_check_cycle(cycle, "continuous")
                next_trigger_check = now + trigger_check_seconds

            if now >= next_weekly:
                logger.info("daemon: weekly cadence reached (%s)", SCHEDULED_CADENCE["weekly"])
                _trigger_check_cycle(cycle, "weekly")
                next_weekly = now + weekly_seconds

            if now >= next_monthly:
                logger.info("daemon: monthly cadence reached (%s)", SCHEDULED_CADENCE["monthly"])
                _run_full_cycle(reason="monthly cadence - full model comparison and retraining")
                next_monthly = now + monthly_seconds

            if now >= next_quarterly:
                logger.info("daemon: quarterly cadence reached (%s)", SCHEDULED_CADENCE["quarterly"])
                _run_full_cycle(reason="quarterly cadence - deep model and circuit review")
                champion = registry.get_champion()
                if champion:
                    logger.info(
                        "daemon: quarterly circuit review - champion %s noise_sensitivity=%.4f circuit_depth=%s",
                        champion["version"],
                        champion["benchmark"]["noise_sensitivity"],
                        champion["benchmark"]["circuit_depth"],
                    )
                next_quarterly = now + quarterly_seconds

            sleep_for = tick_seconds
            if duration_seconds is not None:
                sleep_for = min(sleep_for, max(duration_seconds - elapsed, 0))
            next_due = min(next_trigger_check, next_weekly, next_monthly, next_quarterly)
            sleep_for = max(0.0, min(sleep_for, next_due - time.monotonic()))
            if sleep_for > 0:
                time.sleep(sleep_for)
    except KeyboardInterrupt:
        logger.info("daemon: interrupted - stopping")

    logger.info("=== training daemon stopped after %d trigger-check cycle(s), %.0fs elapsed ===", cycle, time.monotonic() - start)
