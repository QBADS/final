"""
"4. Training Dataset Builder: train / validation / test - temporal holdout -
hard-negative set - stress-test set" (QBADS_Training_Learning_Architecture.pdf,
Section 02), applying the time-aware split from Section 04: "Do not train on
randomly sampled transactions... Random splits risk leakage - the model
learns patterns that would not have been available at inference time."
"""

from dataclasses import dataclass

import numpy as np

from .config import settings
from .data_acquisition import TrainingRecord
from .feature_engineering import engineer_dataset


@dataclass
class Split:
    records: list[TrainingRecord]
    x: np.ndarray
    y: np.ndarray


@dataclass
class DatasetBundle:
    train: Split
    validation: Split
    test: Split  # "future test" - the temporal holdout proper
    hard_negatives: Split  # confirmed/false-positive legitimate cases that looked risky
    stress_test: Split  # adversarial + synthetic fraud, robustness check


def _to_split(records: list[TrainingRecord]) -> Split:
    if not records:
        return Split(records=[], x=np.empty((0, settings.feature_dimension)), y=np.empty((0,)))
    x, y = engineer_dataset(records)
    return Split(records=records, x=x, y=y)


def _stratified_cap(records: list[TrainingRecord], cap: int, seed: int) -> list[TrainingRecord]:
    """Caps the quantum-training set size (see config.max_training_samples)
    while keeping the fraud/legitimate ratio roughly intact, rather than
    just taking the first N chronologically, which would train almost
    entirely on whichever class happened to be more common early on."""
    if len(records) <= cap:
        return records
    rng = np.random.default_rng(seed)
    fraud = [r for r in records if r.label == 1]
    legit = [r for r in records if r.label == 0]
    fraud_quota = max(1, round(cap * len(fraud) / len(records)))
    legit_quota = cap - fraud_quota
    picked_fraud = list(rng.choice(fraud, size=min(fraud_quota, len(fraud)), replace=False))
    picked_legit = list(rng.choice(legit, size=min(legit_quota, len(legit)), replace=False))
    picked = picked_fraud + picked_legit
    picked.sort(key=lambda r: r.timestamp)
    return picked


def build_datasets(records: list[TrainingRecord]) -> DatasetBundle:
    if not records:
        raise ValueError("no records to build datasets from")

    latest = max(r.timestamp for r in records)
    test_start = latest - _days(settings.test_holdout_days)
    validation_start = test_start - _days(settings.validation_holdout_days)

    train_records = [r for r in records if r.timestamp < validation_start]
    validation_records = [r for r in records if validation_start <= r.timestamp < test_start]
    test_records = [r for r in records if r.timestamp >= test_start]

    hard_negative_records = [
        r for r in train_records + validation_records if r.category == "false_positive"
    ]
    stress_test_records = [
        r for r in test_records if r.category in ("adversarial", "synthetic_fraud")
    ]

    capped_train = _stratified_cap(train_records, settings.max_training_samples, settings.synthetic_seed)

    return DatasetBundle(
        train=_to_split(capped_train),
        validation=_to_split(validation_records),
        test=_to_split(test_records),
        hard_negatives=_to_split(hard_negative_records),
        stress_test=_to_split(stress_test_records),
    )


def _days(n: int):
    from datetime import timedelta

    return timedelta(days=n)
