"""
"3. Reliability Analysis: Brier - expected calibration error - reliability
diagram" (QBADS_Recalibration_Architecture.pdf, Section 03).
"""

from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics import brier_score_loss

N_BINS = 10


@dataclass
class ReliabilityBin:
    binLow: float
    binHigh: float
    count: int
    meanPredicted: float
    empiricalRate: float  # actual fraud rate among samples in this bin


@dataclass
class ReliabilityReport:
    brier: float
    ece: float  # expected calibration error
    bins: list = field(default_factory=list)


def _reliability_bins(scores: np.ndarray, outcomes: np.ndarray) -> list[ReliabilityBin]:
    edges = np.linspace(0, 1, N_BINS + 1)
    bins = []
    for i in range(N_BINS):
        lo, hi = edges[i], edges[i + 1]
        mask = (scores >= lo) & (scores < hi if i < N_BINS - 1 else scores <= hi)
        count = int(mask.sum())
        if count == 0:
            bins.append(ReliabilityBin(binLow=float(lo), binHigh=float(hi), count=0, meanPredicted=0.0, empiricalRate=0.0))
            continue
        bins.append(
            ReliabilityBin(
                binLow=float(lo),
                binHigh=float(hi),
                count=count,
                meanPredicted=float(scores[mask].mean()),
                empiricalRate=float(outcomes[mask].mean()),
            )
        )
    return bins


def analyze_reliability(scores: np.ndarray, outcomes: np.ndarray) -> ReliabilityReport:
    bins = _reliability_bins(scores, outcomes)
    total = len(scores)
    ece = sum(b.count / total * abs(b.meanPredicted - b.empiricalRate) for b in bins if b.count > 0) if total else 0.0

    return ReliabilityReport(
        brier=float(brier_score_loss(outcomes, scores)) if total else 1.0,
        ece=float(ece),
        bins=bins,
    )
