"""
Synthetic bootstrap dataset - stands in for the real historical, labeled
fraud dataset that services/training-pipeline (not built yet - see
QBADS_Training_Learning_Architecture.pdf) would eventually produce via its
collect -> label -> clean -> engineer -> split pipeline.

Without it, QSVM/QNN/VQC would have to run with randomly initialized,
literally untrained parameters, which is a worse default than a small
synthetic fit. This generator produces `feature_dimension`-length vectors
with a weighted-sum-plus-noise label rule, loosely mirroring how
Middleware's Stage 2 places its heaviest fields (amount, cross-border,
new-device, absent-MFA) first in the flattened vector - close enough to give
the bootstrap models a real, non-degenerate decision boundary to work with,
not an attempt to reproduce Middleware's actual feature semantics.
"""

import numpy as np

from .config import settings


def generate_bootstrap_dataset(
    n_samples: int = settings.bootstrap_samples,
    feature_dimension: int = settings.feature_dimension,
    seed: int = settings.bootstrap_seed,
) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    x = rng.uniform(0, np.pi, size=(n_samples, feature_dimension))

    # First few dims weighted heaviest, mirroring how the riskiest fields
    # (amount, cross-border, new-device) land early in Middleware's
    # flattened vector.
    weights = np.zeros(feature_dimension)
    heavy = min(4, feature_dimension)
    weights[:heavy] = 1.0
    weights[heavy:] = 0.2

    score = x @ weights + rng.normal(0, 0.5, size=n_samples)
    threshold = np.median(score)
    y = (score > threshold).astype(int)

    return x, y
