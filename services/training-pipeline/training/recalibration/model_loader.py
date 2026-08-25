"""
"1. FROZEN CHAMPION MODEL: QSVM support vectors / QNN, VQC theta - untouched
throughout" (QBADS_Recalibration_Architecture.pdf, Section 03).

Reconstructs a read-only predict_proba function from a registry artifact
(../registry.py's index/artifacts, the same ones services/quantum-pipeline
loads via POST /models/deploy) without ever calling .fit() - recalibration
must not be able to move a single weight. QNN/VQC injection via
`_fit_result` mirrors services/quantum-pipeline/app/models/{qnn,vqc}.py's
`load_weights` - verified there to produce bit-identical predictions to an
actual .fit() on the same weights.
"""

from pathlib import Path
from types import SimpleNamespace
from typing import Callable

import joblib
import numpy as np
from qiskit.circuit.library import real_amplitudes, zz_feature_map
from qiskit.primitives import StatevectorEstimator, StatevectorSampler
from qiskit_machine_learning.algorithms import VQC
from qiskit_machine_learning.algorithms.classifiers import NeuralNetworkClassifier
from qiskit_machine_learning.neural_networks import EstimatorQNN

from ..config import settings

PredictProbaFn = Callable[[np.ndarray], np.ndarray]


def load_frozen_model(registry_entry: dict) -> PredictProbaFn:
    model_type = registry_entry["modelType"]
    artifact_path = settings.registry_dir / registry_entry["artifactPath"]

    if model_type == "QSVM":
        return _load_qsvm(artifact_path)
    if model_type == "QNN":
        return _load_qnn(artifact_path)
    if model_type == "VQC":
        return _load_vqc(artifact_path)
    raise ValueError(f"unknown model type {model_type!r}")


def _load_qsvm(artifact_path: Path) -> PredictProbaFn:
    bundle = joblib.load(artifact_path)
    qsvc = bundle["qsvc"]

    def predict_proba(x: np.ndarray) -> np.ndarray:
        margins = qsvc.decision_function(x)
        return 1 / (1 + np.exp(-margins))

    return predict_proba


def _load_qnn(artifact_path: Path) -> PredictProbaFn:
    weights = np.load(artifact_path)
    feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
    ansatz = real_amplitudes(num_qubits=settings.feature_dimension, reps=1)
    circuit = feature_map.compose(ansatz)
    qnn = EstimatorQNN(
        circuit=circuit,
        estimator=StatevectorEstimator(),
        input_params=feature_map.parameters,
        weight_params=ansatz.parameters,
    )
    classifier = NeuralNetworkClassifier(neural_network=qnn)
    classifier._fit_result = SimpleNamespace(x=weights)  # noqa: SLF001 - see module docstring

    def predict_proba(x: np.ndarray) -> np.ndarray:
        raw = qnn.forward(x, classifier.weights).reshape(-1)
        return (raw + 1) / 2

    return predict_proba


def _load_vqc(artifact_path: Path) -> PredictProbaFn:
    weights = np.load(artifact_path)
    feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
    ansatz = real_amplitudes(num_qubits=settings.feature_dimension, reps=1)
    vqc = VQC(feature_map=feature_map, ansatz=ansatz, sampler=StatevectorSampler())
    vqc._fit_result = SimpleNamespace(x=weights)  # noqa: SLF001 - see module docstring

    def predict_proba(x: np.ndarray) -> np.ndarray:
        return vqc.predict_proba(x)[:, 1]

    return predict_proba
