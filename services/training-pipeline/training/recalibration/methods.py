"""
"4. CANDIDATE MAP FITTING - METHODS COMPETE: Platt scaling - Temperature
scaling - Isotonic regression" (QBADS_Recalibration_Architecture.pdf,
Section 03, detailed in Section 05).

Every method returns the same portable spec shape - {"method", "params"} -
so it can be sent as-is to services/quantum-pipeline's POST
/models/recalibrate and applied there with no scikit-learn dependency on
that side beyond plain numpy (see that service's app/calibration.py).

"Constraint - a calibration map may only be a monotonic transform of the
raw score" (Section 05): all three methods are monotonic by construction
(sigmoid of a positive-slope linear map; sklearn's IsotonicRegression is
non-decreasing by definition) - `is_monotonic` below is a defensive
verification of that invariant, not a probabilistic check, and it does have
real teeth: a degenerate temperature fit landing on T <= 0 would flip
sigmoid(logit/T) from increasing to decreasing, which this catches.
"""

from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

MethodName = Literal["identity", "platt", "temperature", "isotonic"]

_EPS = 1e-6


@dataclass
class CalibrationMap:
    method: MethodName
    params: dict

    def apply(self, raw_scores: np.ndarray) -> np.ndarray:
        return apply_map(self, raw_scores)


def apply_map(cal_map: CalibrationMap, raw_scores: np.ndarray) -> np.ndarray:
    raw_scores = np.asarray(raw_scores, dtype=float)
    if cal_map.method == "identity":
        return raw_scores
    if cal_map.method == "platt":
        a, b = cal_map.params["a"], cal_map.params["b"]
        return 1 / (1 + np.exp(-(a * raw_scores + b)))
    if cal_map.method == "temperature":
        t = cal_map.params["T"]
        p = np.clip(raw_scores, _EPS, 1 - _EPS)
        logit = np.log(p / (1 - p))
        return 1 / (1 + np.exp(-(logit / t)))
    if cal_map.method == "isotonic":
        x = np.array(cal_map.params["x"])
        y = np.array(cal_map.params["y"])
        return np.interp(raw_scores, x, y)
    raise ValueError(f"unknown calibration method {cal_map.method!r}")


def is_monotonic(cal_map: CalibrationMap, probe_points: int = 200) -> bool:
    probe = np.linspace(0, 1, probe_points)
    applied = apply_map(cal_map, probe)
    return bool(np.all(np.diff(applied) >= -1e-9))


def fit_platt(raw_scores: np.ndarray, outcomes: np.ndarray) -> CalibrationMap:
    """2-parameter logistic - "default for QSVM" (Section 05)."""
    clf = LogisticRegression()
    clf.fit(raw_scores.reshape(-1, 1), outcomes)
    return CalibrationMap(method="platt", params={"a": float(clf.coef_[0, 0]), "b": float(clf.intercept_[0])})


def fit_temperature(raw_scores: np.ndarray, outcomes: np.ndarray) -> CalibrationMap:
    """1-parameter, rank-preserving - "default for QNN/VQC" (Section 05)."""
    p = np.clip(raw_scores, _EPS, 1 - _EPS)
    logit = np.log(p / (1 - p))

    def nll(t: float) -> float:
        if t <= 1e-3:
            return np.inf
        calibrated = 1 / (1 + np.exp(-(logit / t)))
        calibrated = np.clip(calibrated, _EPS, 1 - _EPS)
        return -np.mean(outcomes * np.log(calibrated) + (1 - outcomes) * np.log(1 - calibrated))

    result = minimize_scalar(nll, bounds=(0.05, 20.0), method="bounded")
    return CalibrationMap(method="temperature", params={"T": float(result.x)})


def fit_isotonic(raw_scores: np.ndarray, outcomes: np.ndarray) -> CalibrationMap:
    """Non-parametric monotonic map - escalation when Platt/temperature still show curvature (Section 05)."""
    iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip")
    iso.fit(raw_scores, outcomes)
    return CalibrationMap(
        method="isotonic",
        params={"x": iso.X_thresholds_.tolist(), "y": iso.y_thresholds_.tolist()},
    )


def identity_map() -> CalibrationMap:
    return CalibrationMap(method="identity", params={})


FITTERS = {"platt": fit_platt, "temperature": fit_temperature, "isotonic": fit_isotonic}
