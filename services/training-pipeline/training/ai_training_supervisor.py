"""
"6. AI Training Supervisor" (QBADS_Training_Learning_Architecture.pdf,
Section 06): "The supervisor must not conclude 'accuracy = 94%, deploy'."
Interrogates three dimensions - data quality, model quality, quantum
quality - before a candidate is allowed forward.

Rule (Section 06): "the supervisor recommends; it never overrides
deterministic evaluation." Concretely: this module produces a
recommendation and a quality score, but gates.py's Gate 2 also checks hard,
deterministic thresholds (recall floor, regression-vs-champion) independent
of whatever this recommends - a high supervisor score alone cannot promote
a candidate that fails those.
"""

from dataclasses import dataclass, field

import numpy as np

from .benchmarking import BenchmarkResult
from .config import settings
from .data_quality import QualityReport
from .dataset_builder import Split
from .models import TrainedCandidate


@dataclass
class SupervisorVerdict:
    model_type: str
    data_quality_score: float
    model_quality_score: float
    quantum_quality_score: float
    quality_score: float
    recommend: bool
    findings: dict = field(default_factory=dict)


def _data_quality_score(report: QualityReport) -> tuple[float, dict]:
    dup_penalty = min(report.duplicates_removed / max(report.total_records, 1), 0.3)
    balance_score = min(report.minority_class_share / 0.5, 1.0)  # 1.0 at a perfect 50/50 split
    label_integrity = 1.0 if report.invalid_label_records == 0 else 0.5
    score = np.clip(balance_score * 0.5 + label_integrity * 0.3 + (1 - dup_penalty) * 0.2, 0, 1)
    return float(score), {
        "leakage": "not directly measurable post-hoc; prevented structurally by the temporal split in dataset_builder.py",
        "labels": "verified" if report.invalid_label_records == 0 else f"{report.invalid_label_records} invalid",
        "balance": f"minority class {report.minority_class_share:.1%}",
        "drift": "n/a - first training cycle, no prior distribution to compare against",
    }


def _model_quality_score(candidate: TrainedCandidate, train_split: Split, bench: BenchmarkResult) -> tuple[float, dict]:
    train_proba = candidate.predict_proba_fn(train_split.x)
    train_pred = (train_proba >= 0.5).astype(int)
    train_accuracy = float((train_pred == train_split.y).mean()) if len(train_split.y) else 0.0
    test_accuracy = float(((bench.recall + bench.precision) / 2)) if (bench.recall or bench.precision) else 0.0
    overfit_gap = max(train_accuracy - test_accuracy, 0.0)

    overfit_score = 1.0 - min(overfit_gap / settings.max_overfit_gap, 1.0)
    calibration_score = 1.0 - min(bench.calibration_brier / 0.25, 1.0)  # 0.25 = coin-flip Brier score
    detection_score = np.clip((bench.recall + bench.precision) / 2, 0, 1)

    score = np.clip(overfit_score * 0.3 + calibration_score * 0.2 + detection_score * 0.5, 0, 1)
    return float(score), {
        "overfitting": f"train/test gap {overfit_gap:.3f} (max allowed {settings.max_overfit_gap})",
        "calibration": f"Brier {bench.calibration_brier:.3f}",
        "recall": f"{bench.recall:.3f}",
        "precision": f"{bench.precision:.3f}",
    }


def _quantum_quality_score(bench: BenchmarkResult) -> tuple[float, dict]:
    noise_score = 1.0 - min(bench.noise_sensitivity / 0.3, 1.0)
    # Shallower circuits are more likely to survive real hardware noise -
    # this is a proxy for hardware-readiness, not a claim about simulator behavior.
    depth_score = 1.0 - min(bench.circuit_depth / 150, 1.0)
    score = np.clip(noise_score * 0.6 + depth_score * 0.4, 0, 1)
    return float(score), {
        "noise_sensitivity": f"{bench.noise_sensitivity:.4f} avg prediction drift under perturbation",
        "circuit_stability": f"depth {bench.circuit_depth}",
        "backend_drift": "n/a - single simulator backend, no cross-backend comparison available",
        "shot_stability": "n/a - exact statevector simulation, not shot-sampled",
    }


def evaluate(
    candidate: TrainedCandidate,
    quality_report: QualityReport,
    train_split: Split,
    bench: BenchmarkResult,
) -> SupervisorVerdict:
    data_score, data_findings = _data_quality_score(quality_report)
    model_score, model_findings = _model_quality_score(candidate, train_split, bench)
    quantum_score, quantum_findings = _quantum_quality_score(bench)

    quality_score = data_score * 0.25 + model_score * 0.5 + quantum_score * 0.25

    return SupervisorVerdict(
        model_type=candidate.model_type,
        data_quality_score=data_score,
        model_quality_score=model_score,
        quantum_quality_score=quantum_score,
        quality_score=float(quality_score),
        recommend=quality_score >= settings.min_quality_score,
        findings={"data": data_findings, "model": model_findings, "quantum": quantum_findings},
    )
