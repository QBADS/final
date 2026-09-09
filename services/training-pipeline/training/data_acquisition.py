"""
"1. DATA ACQUISITION LAYER: Real Transactions + confirmed outcomes,
Confirmed Fraud + confirmed non-fraud, Synthetic/Adversarial generated fraud
scenarios" (QBADS_Training_Learning_Architecture.pdf, Section 02).

There is no real transaction history anywhere in this repo yet - Middleware
is in-memory and ephemeral (see services/middleware/README.md), and no
institution has been live long enough to accumulate confirmed outcomes even
if it persisted. This generates a synthetic dataset standing in for all
three acquisition sources, spread across a simulated multi-month timeline so
the time-aware split in dataset_builder.py has something real to split.

Every record also carries a "true_risk" latent score, not exposed to the
model - it exists only so this generator can deliberately construct the
harder dataset categories from Section 03's table (false-positive,
false-negative, suspicious/reviewed) as genuine feature/label mismatches
rather than uniformly random labels.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np

from .config import settings

RAW_FEATURE_DIM = 12  # transaction / behavioural / temporal / velocity / geographic / network signals

Category = str  # confirmed_fraud | confirmed_legitimate | false_positive | false_negative | suspicious_reviewed | synthetic_fraud | adversarial | new_fraud_pattern | cross_institution | temporal_behaviour


@dataclass
class TrainingRecord:
    record_id: str
    institution_id: str
    timestamp: datetime
    raw_features: np.ndarray  # RAW_FEATURE_DIM-length, unnormalized
    category: Category
    label: int  # 0 = legitimate, 1 = fraud - the ground truth the model trains against
    context: dict = field(default_factory=dict)


def _make_institution_ids(n: int) -> list[str]:
    return [f"inst-{i+1}" for i in range(n)]


def generate_dataset() -> list[TrainingRecord]:
    rng = np.random.default_rng(settings.synthetic_seed)
    institutions = _make_institution_ids(settings.synthetic_n_institutions)
    start = datetime(2026, 1, 1)

    records: list[TrainingRecord] = []
    record_idx = 0

    for day in range(settings.synthetic_days):
        day_ts = start + timedelta(days=day)
        for _ in range(settings.synthetic_records_per_day * len(institutions)):
            record_idx += 1
            institution_id = institutions[rng.integers(0, len(institutions))]
            hour = rng.integers(0, 24)
            timestamp = day_ts + timedelta(hours=int(hour), minutes=int(rng.integers(0, 60)))

            # Decide the category/label and a target latent risk level first,
            # then sample raw features to actually carry that signal - not
            # the other way around. (An earlier version of this generator
            # computed true_risk from independently-random raw features and
            # never fed it back in, so labels ended up statistically
            # decoupled from the features a model would train on; caught via
            # a classical logistic-regression sanity check that came back at
            # AUC ~0.52, barely above chance.)
            roll = rng.random()
            if roll < 0.55:
                category, label, true_risk = "confirmed_legitimate", 0, rng.uniform(0.0, 0.35)
            elif roll < 0.72:
                category, label, true_risk = "confirmed_fraud", 1, rng.uniform(0.65, 1.0)
            elif roll < 0.80:
                # Looked risky, institution/reviewer confirmed it wasn't -
                # "teach the model what not to flag."
                category, label, true_risk = "false_positive", 0, rng.uniform(0.6, 0.9)
            elif roll < 0.87:
                # Looked safe, turned out fraudulent - "identify missed fraud."
                category, label, true_risk = "false_negative", 1, rng.uniform(0.05, 0.35)
            elif roll < 0.93:
                category, true_risk = "suspicious_reviewed", rng.uniform(0.4, 0.6)
                label = int(rng.random() < 0.5)  # genuinely borderline
            elif roll < 0.97:
                category, label, true_risk = "synthetic_fraud", 1, rng.uniform(0.6, 1.0)
            else:
                # Adversarial: engineered to look legitimate on the surface
                # despite being fraud - deliberately the opposite of what
                # the label would predict, which is exactly what makes
                # these hard.
                category, label, true_risk = "adversarial", 1, rng.uniform(0.1, 0.3)

            # First 4 raw dims carry the signal (mirrors Middleware's
            # heaviest fields - amount, cross-border, new-device, absent-MFA);
            # the rest are irrelevant noise a model has to learn to ignore.
            raw = np.empty(RAW_FEATURE_DIM)
            raw[:4] = np.clip(rng.normal(true_risk, 0.12, size=4), 0, 1)
            raw[4:] = rng.uniform(0, 1, size=RAW_FEATURE_DIM - 4)

            records.append(
                TrainingRecord(
                    record_id=f"TRAIN-{record_idx:06d}",
                    institution_id=institution_id,
                    timestamp=timestamp,
                    raw_features=raw,
                    category=category,
                    label=label,
                    context={"true_risk": true_risk},
                )
            )

    end = start + timedelta(days=settings.synthetic_days)
    records.extend(_generate_new_fraud_pattern_records(rng, institutions, start, end, record_idx))
    record_idx += settings.synthetic_new_fraud_pattern_records
    records.extend(_generate_cross_institution_records(rng, institutions, start, end, record_idx))
    record_idx += settings.synthetic_cross_institution_groups * 2
    records.extend(_generate_temporal_behaviour_records(rng, institutions, start, end, record_idx))

    records.sort(key=lambda r: r.timestamp)
    return records


def _generate_new_fraud_pattern_records(
    rng: np.random.Generator,
    institutions: list[str],
    start: datetime,
    end: datetime,
    record_idx: int,
) -> list[TrainingRecord]:
    """Section 03's "new fraud patterns" category: a fraud signature none
    of the other seven generators above produce. Two things make it
    genuinely novel rather than a relabeled copy of "confirmed_fraud":

    1. Signal shape - the other categories put risk into raw[:4] as a
       roughly uniform elevated block (`true_risk +/- noise`). This
       category instead encodes risk as a *sharp, alternating* pattern
       (high/low/high/low) that a model trained only on the other
       categories' smooth-block signal would not have learned to read.
    2. Timing - it only appears in the last 15% of the timeline, i.e.
       *after* the dataset_builder.py temporal cutoffs that put the rest
       of the bootstrap data into train/validation. A model trained on the
       other categories genuinely has not seen this pattern by
       construction, not just by label.
    """
    n = settings.synthetic_new_fraud_pattern_records
    window_start = start + (end - start) * 0.85
    records = []
    for i in range(n):
        institution_id = institutions[rng.integers(0, len(institutions))]
        timestamp = window_start + (end - window_start) * rng.random()
        raw = np.empty(RAW_FEATURE_DIM)
        # Alternating high/low block - a shape, not just a level, that the
        # smooth-block generators above never produce.
        raw[0] = rng.uniform(0.75, 1.0)
        raw[1] = rng.uniform(0.0, 0.15)
        raw[2] = rng.uniform(0.75, 1.0)
        raw[3] = rng.uniform(0.0, 0.15)
        raw[4:] = rng.uniform(0, 1, size=RAW_FEATURE_DIM - 4)
        records.append(
            TrainingRecord(
                record_id=f"TRAIN-{record_idx + i + 1:06d}",
                institution_id=institution_id,
                timestamp=timestamp,
                raw_features=raw,
                category="new_fraud_pattern",
                label=1,
                context={"true_risk": 0.9, "pattern": "alternating_signal_late_window"},
            )
        )
    return records


def _generate_cross_institution_records(
    rng: np.random.Generator,
    institutions: list[str],
    start: datetime,
    end: datetime,
    record_idx: int,
) -> list[TrainingRecord]:
    """Section 03's "cross-institution patterns" category: individually
    unremarkable-looking transactions that are only suspicious once you
    correlate them across institutions - the same device fingerprint
    attempting transactions at 2+ different institutions within a short
    window. Needs >=2 institutions to be meaningful; if the deployment is
    configured with just one, this degenerates to nothing (logged as 0
    groups, not silently mislabeled)."""
    records = []
    if len(institutions) < 2:
        return records
    idx = 0
    for g in range(settings.synthetic_cross_institution_groups):
        fingerprint = f"device-{rng.integers(0, 1_000_000):06d}"
        n_institutions_hit = min(len(institutions), int(rng.integers(2, min(3, len(institutions)) + 1)))
        hit_institutions = list(rng.choice(institutions, size=n_institutions_hit, replace=False))
        base_time = start + (end - start) * rng.random()
        for inst in hit_institutions:
            # Same fingerprint, different institution, minutes apart - the
            # "short window" that makes this cross-institution fraud rather
            # than two unrelated legitimate transactions.
            offset = timedelta(minutes=float(rng.uniform(0, 12)))
            raw = np.empty(RAW_FEATURE_DIM)
            raw[:4] = np.clip(rng.normal(0.7, 0.1, size=4), 0, 1)
            raw[4:] = rng.uniform(0, 1, size=RAW_FEATURE_DIM - 4)
            records.append(
                TrainingRecord(
                    record_id=f"TRAIN-{record_idx + idx + 1:06d}",
                    institution_id=inst,
                    timestamp=base_time + offset,
                    raw_features=raw,
                    category="cross_institution",
                    label=1,
                    context={"true_risk": 0.75, "device_fingerprint": fingerprint, "linked_institutions": hit_institutions},
                )
            )
            idx += 1
    return records


def _generate_temporal_behaviour_records(
    rng: np.random.Generator,
    institutions: list[str],
    start: datetime,
    end: datetime,
    record_idx: int,
) -> list[TrainingRecord]:
    """Section 03's "temporal behaviour" category: velocity/time-of-day
    anomalies, distinct from the general dataset's plain timestamp field -
    a burst of several transactions within a tight window (velocity
    anomaly) at an hour a legitimate customer of that pattern wouldn't
    normally transact at (time-of-day anomaly), both encoded explicitly in
    `context` so they're inspectable, not just implied by timestamp
    proximity."""
    records = []
    idx = 0
    for g in range(settings.synthetic_temporal_behaviour_groups):
        institution_id = institutions[rng.integers(0, len(institutions))]
        burst_size = int(rng.integers(4, 8))
        anomalous_hour = int(rng.integers(1, 5))  # 1am-4am, well outside normal daytime activity
        day_offset = timedelta(days=float(rng.integers(0, settings.synthetic_days)))
        burst_start = start + day_offset + timedelta(hours=anomalous_hour)
        for b in range(burst_size):
            # Whole burst inside a 90-second window - a velocity anomaly no
            # single-record timestamp field on its own would flag.
            offset = timedelta(seconds=float(rng.uniform(0, 90)))
            raw = np.empty(RAW_FEATURE_DIM)
            raw[:4] = np.clip(rng.normal(0.65, 0.1, size=4), 0, 1)
            raw[4:] = rng.uniform(0, 1, size=RAW_FEATURE_DIM - 4)
            records.append(
                TrainingRecord(
                    record_id=f"TRAIN-{record_idx + idx + 1:06d}",
                    institution_id=institution_id,
                    timestamp=burst_start + offset,
                    raw_features=raw,
                    category="temporal_behaviour",
                    label=1,
                    context={
                        "true_risk": 0.7,
                        "burst_size": burst_size,
                        "burst_position": b,
                        "anomalous_hour": anomalous_hour,
                    },
                )
            )
            idx += 1
    return records
