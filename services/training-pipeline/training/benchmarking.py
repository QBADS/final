"""
"7. Validation & Benchmarking: holdout - stress - noise / backend
consistency" + "9. What Determines Best" (QBADS_Training_Learning_Architecture.pdf,
Sections 02 and 09): three families of criteria a candidate must be
competitive across, not accuracy alone.
"""

import time
from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from .dataset_builder import Split
from .models import TrainedCandidate

NOISE_TRIALS = 8
NOISE_STD = 0.05  # small perturbation on an already-[0, pi]-scaled input


@dataclass
class BenchmarkResult:
    model_type: str
    # Primary (detection)
    recall: float
    precision: float
    f1: float
    false_positive_rate: float
    false_negative_rate: float
    roc_auc: float
    pr_auc: float
    calibration_brier: float  # lower is better; 0 = perfectly calibrated
    # Quantum-specific
    circuit_depth: int
    noise_sensitivity: float  # avg prediction drift under small input perturbation, 0-1
    stress_test_recall: float | None  # recall on the adversarial/synthetic-fraud subset
    # Operational
    inference_latency_ms: float
    failure_rate: float
    train_seconds: float
    details: dict = field(default_factory=dict)


def _safe_rate(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def _confusion_rates(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[float, float]:
    negatives = y_true == 0
    positives = y_true == 1
    fpr = _safe_rate(int(((y_pred == 1) & negatives).sum()), int(negatives.sum()))
    fnr = _safe_rate(int(((y_pred == 0) & positives).sum()), int(positives.sum()))
    return fpr, fnr


def _noise_sensitivity(candidate: TrainedCandidate, x: np.ndarray, rng: np.random.Generator) -> float:
    if len(x) == 0:
        return 0.0
    baseline = candidate.predict_proba_fn(x)
    drifts = []
    for _ in range(NOISE_TRIALS):
        perturbed = np.clip(x + rng.normal(0, NOISE_STD, size=x.shape), 0, np.pi)
        drifts.append(np.abs(candidate.predict_proba_fn(perturbed) - baseline).mean())
    return float(np.mean(drifts))


def benchmark_candidate(
    candidate: TrainedCandidate,
    test_split: Split,
    stress_split: Split,
    seed: int,
) -> BenchmarkResult:
    rng = np.random.default_rng(seed)
    failures = 0

    try:
        t0 = time.time()
        proba = candidate.predict_proba_fn(test_split.x)
        per_sample_ms = ((time.time() - t0) / max(len(test_split.x), 1)) * 1000
    except Exception:  # noqa: BLE001 - a candidate that errors on holdout data is exactly what this measures
        failures += 1
        proba = np.full(len(test_split.y), 0.5)
        per_sample_ms = float("nan")

    y_pred = (proba >= 0.5).astype(int)
    fpr, fnr = _confusion_rates(test_split.y, y_pred)

    has_both_classes = len(set(test_split.y.tolist())) > 1
    roc_auc = roc_auc_score(test_split.y, proba) if has_both_classes else float("nan")
    pr_auc = average_precision_score(test_split.y, proba) if has_both_classes else float("nan")

    stress_recall = None
    if len(stress_split.y) and stress_split.y.sum() > 0:
        stress_proba = candidate.predict_proba_fn(stress_split.x)
        stress_recall = float(recall_score(stress_split.y, (stress_proba >= 0.5).astype(int), zero_division=0))

    return BenchmarkResult(
        model_type=candidate.model_type,
        recall=float(recall_score(test_split.y, y_pred, zero_division=0)),
        precision=float(precision_score(test_split.y, y_pred, zero_division=0)),
        f1=float(f1_score(test_split.y, y_pred, zero_division=0)),
        false_positive_rate=fpr,
        false_negative_rate=fnr,
        roc_auc=float(roc_auc) if roc_auc == roc_auc else 0.5,  # NaN-safe
        pr_auc=float(pr_auc) if pr_auc == pr_auc else 0.0,
        calibration_brier=float(brier_score_loss(test_split.y, proba)),
        circuit_depth=candidate.circuit_depth,
        noise_sensitivity=_noise_sensitivity(candidate, test_split.x, rng),
        stress_test_recall=stress_recall,
        inference_latency_ms=per_sample_ms,
        failure_rate=_safe_rate(failures, 1),
        train_seconds=candidate.train_seconds,
    )
