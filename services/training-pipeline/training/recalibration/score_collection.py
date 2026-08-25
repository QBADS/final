"""
"2. Score Collection: raw scores + confirmed outcomes on a rolling holdout"
(QBADS_Recalibration_Architecture.pdf, Section 03).

Reuses dataset_builder.py's temporal test split as the "rolling holdout" -
it's already the portion of the synthetic timeline never used for training,
which is exactly what a rolling holdout of newly confirmed outcomes stands
in for here (there's no live traffic to actually roll forward - see
../../README.md's "what's synthetic" note, same caveat applies here).
"""

from dataclasses import dataclass

import numpy as np

from ..data_acquisition import generate_dataset
from ..data_quality import run_quality_checks
from ..dataset_builder import build_datasets
from .model_loader import PredictProbaFn, load_frozen_model


@dataclass
class ScoreCollection:
    raw_scores: np.ndarray
    outcomes: np.ndarray  # ground truth, 0/1
    holdout_size: int


def collect_scores(registry_entry: dict) -> ScoreCollection:
    model_fn: PredictProbaFn = load_frozen_model(registry_entry)

    records = generate_dataset()
    clean_records, _ = run_quality_checks(records)
    bundle = build_datasets(clean_records)

    raw_scores = model_fn(bundle.test.x)
    return ScoreCollection(raw_scores=np.asarray(raw_scores), outcomes=bundle.test.y, holdout_size=len(bundle.test.y))
