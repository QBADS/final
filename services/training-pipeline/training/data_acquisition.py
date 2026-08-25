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

Category = str  # confirmed_fraud | confirmed_legitimate | false_positive | false_negative | suspicious_reviewed | synthetic_fraud | adversarial


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

    records.sort(key=lambda r: r.timestamp)
    return records
