"""
"3. Feature Engineering: transaction - behavioural - temporal - velocity -
geographic - network / relationship" (QBADS_Training_Learning_Architecture.pdf,
Section 02). Reduces data_acquisition.py's RAW_FEATURE_DIM raw signals down
to services/quantum-pipeline's FEATURE_DIMENSION, so a promoted model is
loadable there without a shape mismatch.

The projection matrix is fixed (seeded once, never refit on data) rather
than something like PCA fit per training run - fitting a reduction on the
full dataset before the time-aware split in dataset_builder.py would leak
future distribution information into the training window, which is exactly
the leakage risk Section 04 warns about.
"""

import numpy as np

from .config import settings
from .data_acquisition import RAW_FEATURE_DIM, TrainingRecord

_PROJECTION_SEED = 1234


def _projection_matrix() -> np.ndarray:
    rng = np.random.default_rng(_PROJECTION_SEED)
    m = rng.normal(0, 1, size=(RAW_FEATURE_DIM, settings.feature_dimension))
    return m / np.linalg.norm(m, axis=0, keepdims=True)


_PROJECTION = _projection_matrix()


#  raw_features ~ Uniform(0,1)^RAW_FEATURE_DIM and each projection column is
# unit-norm, so a projected value is a weighted average of ~Uniform(0,1)
# terms - comfortably bounded in [-1, 1.5] in practice. Fixed, not fit per
# batch or per record: a per-record min-max would stretch every vector to
# span the same [0, pi] range regardless of overall risk level, destroying
# exactly the fraud/legitimate separability data_acquisition.py builds in.
_CLIP_RANGE = (-1.0, 1.5)


def engineer_features(record: TrainingRecord) -> np.ndarray:
    projected = record.raw_features @ _PROJECTION  # RAW_FEATURE_DIM -> feature_dimension
    clipped = np.clip(projected, *_CLIP_RANGE)
    # Matches the angle-encoding range Middleware's real pipeline produces
    # (services/middleware/src/pipeline/vectorStandardization.ts).
    normalized = (clipped - _CLIP_RANGE[0]) / (_CLIP_RANGE[1] - _CLIP_RANGE[0])
    return normalized * np.pi


def engineer_dataset(records: list[TrainingRecord]) -> tuple[np.ndarray, np.ndarray]:
    x = np.stack([engineer_features(r) for r in records])
    y = np.array([r.label for r in records])
    return x, y
