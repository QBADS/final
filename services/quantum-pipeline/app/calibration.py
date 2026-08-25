"""
Applies a calibration map fit by services/training-pipeline/training/recalibration
(QBADS_Recalibration_Architecture.pdf). This module is deliberately
dependency-light (plain numpy, no scikit-learn) - it only ever *applies* a
map that arrives fully-fitted over the wire via POST /models/recalibrate;
all the fitting happens on the training-pipeline side.

"8. Live Quantum Engine: post-processing swap only - weights untouched"
(Section 03) - nothing here touches a model's predict_proba, only what
happens to its output afterward.
"""

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

MethodName = Literal["identity", "platt", "temperature", "isotonic"]

_EPS = 1e-6


@dataclass
class CalibrationMap:
    method: MethodName
    version: str  # calibrationVersion, e.g. "cal-c1" - for the API response / audit trail
    params: dict = field(default_factory=dict)

    def apply(self, raw_score: float) -> float:
        if self.method == "identity":
            return raw_score
        if self.method == "platt":
            a, b = self.params["a"], self.params["b"]
            return float(1 / (1 + np.exp(-(a * raw_score + b))))
        if self.method == "temperature":
            t = self.params["T"]
            p = min(max(raw_score, _EPS), 1 - _EPS)
            logit = np.log(p / (1 - p))
            return float(1 / (1 + np.exp(-(logit / t))))
        if self.method == "isotonic":
            x = self.params["x"]
            y = self.params["y"]
            return float(np.interp(raw_score, x, y))
        raise ValueError(f"unknown calibration method {self.method!r}")

    def local_slope(self, raw_score: float, h: float = 1e-3) -> float:
        """
        "Confidence (all three) - Derived from the recalibrated curve's own
        steepness at that score" (Recalibration doc, Section 04). A flat
        (near-zero-slope) region means a small change in the raw score
        wouldn't move the calibrated probability much - a stable, confident
        read. A steep region means the calibrated output is sensitive to
        small input noise right around that score - the standard reading of
        a probability curve's steepness near a decision boundary.
        """
        lo = self.apply(max(0.0, raw_score - h))
        hi = self.apply(min(1.0, raw_score + h))
        span = min(1.0, raw_score + h) - max(0.0, raw_score - h)
        return abs(hi - lo) / span if span > 0 else 0.0


def identity_map() -> CalibrationMap:
    return CalibrationMap(method="identity", version="none", params={})
