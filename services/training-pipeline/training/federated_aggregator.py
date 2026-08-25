"""
"11. Federated Learning Layer" (QBADS_Training_Learning_Architecture.pdf,
Section 11): "Institution A / B / C -> Local Training/Statistics -> Federated
Aggregator (anonymised statistics and model deltas only) -> Global Model
Update (versioned and distributed) -> Quantum Engine (receives updated
weights; does not train live)." Constraint: "the federated layer never
receives raw transaction data."

Runs against VQC only (not all three model types) - real FedAvg needs a
fixed-size weight vector to average, which QSVM's kernel/support-vector
representation doesn't have (see registry.py's per-model-type artifact
handling for the same distinction), and doc Section 08's own example names
VQC as the running champion.

Institutions here are partitions of data_acquisition.py's single synthetic
dataset by its institution_id field, not real separate organizations - the
important thing this proves is that only weight arrays cross the
"institution boundary" in the code below, never a record's raw_features,
matching the doc's constraint even though the underlying data is synthetic.
"""

import logging
from dataclasses import dataclass

import numpy as np
from qiskit.circuit.library import real_amplitudes, zz_feature_map
from qiskit_algorithms.optimizers import COBYLA
from qiskit_machine_learning.algorithms import VQC

from .config import settings
from .data_acquisition import TrainingRecord, generate_dataset
from .data_quality import run_quality_checks
from .feature_engineering import engineer_dataset

logger = logging.getLogger("training-pipeline.federated")


@dataclass
class LocalUpdate:
    institution_id: str
    weights: np.ndarray
    sample_count: int


def _partition_by_institution(records: list[TrainingRecord]) -> dict[str, list[TrainingRecord]]:
    partitions: dict[str, list[TrainingRecord]] = {}
    for r in records:
        partitions.setdefault(r.institution_id, []).append(r)
    return partitions


def _local_train(records: list[TrainingRecord], initial_point: np.ndarray | None) -> LocalUpdate:
    x, y = engineer_dataset(records)
    feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
    ansatz = real_amplitudes(num_qubits=settings.feature_dimension, reps=1)
    vqc = VQC(
        feature_map=feature_map,
        ansatz=ansatz,
        optimizer=COBYLA(maxiter=settings.federated_local_iter),
        initial_point=initial_point,
    )
    vqc.fit(x, y)
    return LocalUpdate(institution_id=records[0].institution_id, weights=np.array(vqc.weights), sample_count=len(records))


def federated_average(updates: list[LocalUpdate]) -> np.ndarray:
    """Sample-count-weighted average of local weight deltas - "anonymised
    statistics and model deltas only": this function never sees a
    TrainingRecord, only (institution_id, weights, sample_count)."""
    total = sum(u.sample_count for u in updates)
    stacked = np.stack([u.weights * (u.sample_count / total) for u in updates])
    return stacked.sum(axis=0)


def run_federated_round(initial_point: np.ndarray | None = None) -> tuple[np.ndarray, list[LocalUpdate]]:
    records = generate_dataset()
    clean_records, _ = run_quality_checks(records)
    partitions = _partition_by_institution(clean_records)

    logger.info("federated round: %d institutions, %d records total", len(partitions), len(clean_records))

    # Cap each institution's local training slice for the same reason
    # config.max_training_samples caps the main cycle (dataset_builder.py):
    # VQC training cost scales with both sample count and iteration count,
    # and this runs once per institution.
    local_cap = max(20, settings.max_training_samples // max(len(partitions), 1))
    rng = np.random.default_rng(settings.synthetic_seed)

    updates = []
    for institution_id, institution_records in partitions.items():
        if len(institution_records) < 10:
            logger.warning("skipping %s: only %d local records", institution_id, len(institution_records))
            continue
        if len(institution_records) > local_cap:
            institution_records = list(rng.choice(institution_records, size=local_cap, replace=False))
        logger.info("local training: %s (%d records)", institution_id, len(institution_records))
        updates.append(_local_train(institution_records, initial_point))

    if not updates:
        raise RuntimeError("no institution had enough local data for a federated round")

    global_weights = federated_average(updates)
    logger.info("aggregated %d local updates into a global weight vector", len(updates))
    return global_weights, updates
