"""
"5. QUANTUM MODEL LAB - CANDIDATES COMPETE" (QBADS_Training_Learning_Architecture.pdf,
Section 02) + "Three-Model Training Strategy" (Section 05): QSVM, QNN and
VQC "should not be trained identically - they should compete on the same
datasets." Same circuit choices as services/quantum-pipeline/app/models/
(same feature map, same qubit count), duplicated rather than cross-imported
- these are separate services with separate venvs/deployments, the same
reason services/middleware doesn't import packages/types.
"""

import time
from dataclasses import dataclass

import numpy as np
from qiskit.circuit.library import real_amplitudes, zz_feature_map
from qiskit.primitives import StatevectorEstimator, StatevectorSampler
from qiskit_algorithms.optimizers import COBYLA
from qiskit_machine_learning.algorithms import QSVC, VQC
from qiskit_machine_learning.algorithms.classifiers import NeuralNetworkClassifier
from qiskit_machine_learning.kernels import FidelityStatevectorKernel
from qiskit_machine_learning.neural_networks import EstimatorQNN

from .config import settings


@dataclass
class TrainedCandidate:
    model_type: str  # QSVM | QNN | VQC
    predict_proba_fn: object  # Callable[[np.ndarray], np.ndarray] - vectorized, N samples in, N probabilities out
    circuit_depth: int
    train_seconds: float
    # For registry persistence (registry.py). QSVM has no fixed-size weight
    # vector (it's a kernel method - support vectors are the "parameters"),
    # QNN/VQC do.
    weights: np.ndarray | None
    support_data: tuple[np.ndarray, np.ndarray] | None  # (X, y) the QSVC was fit on


def train_qsvm(x: np.ndarray, y: np.ndarray) -> TrainedCandidate:
    """A. QSVM: quantum feature map -> quantum kernel -> kernel matrix -> classical SVM optimization."""
    feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
    kernel = FidelityStatevectorKernel(feature_map=feature_map)
    qsvc = QSVC(quantum_kernel=kernel)

    t0 = time.time()
    qsvc.fit(x, y)
    elapsed = time.time() - t0

    def predict_proba(x_query: np.ndarray) -> np.ndarray:
        margins = qsvc.decision_function(x_query)
        return 1 / (1 + np.exp(-margins))

    return TrainedCandidate(
        model_type="QSVM",
        predict_proba_fn=predict_proba,
        circuit_depth=feature_map.decompose().depth(),
        train_seconds=elapsed,
        weights=None,
        support_data=(x, y),
    )


def train_qnn(x: np.ndarray, y: np.ndarray) -> TrainedCandidate:
    """B. QNN: feature map -> parameterized ansatz -> measurement -> prediction -> classical optimizer updates theta."""
    feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
    ansatz = real_amplitudes(num_qubits=settings.feature_dimension, reps=1)
    circuit = feature_map.compose(ansatz)
    qnn = EstimatorQNN(
        circuit=circuit,
        estimator=StatevectorEstimator(),
        input_params=feature_map.parameters,
        weight_params=ansatz.parameters,
    )
    classifier = NeuralNetworkClassifier(neural_network=qnn, optimizer=COBYLA(maxiter=settings.optimizer_max_iter))

    t0 = time.time()
    classifier.fit(x, 2 * y - 1)  # EstimatorQNN's binary convention is {-1, +1}, not {0, 1}
    elapsed = time.time() - t0

    def predict_proba(x_query: np.ndarray) -> np.ndarray:
        raw = qnn.forward(x_query, classifier.weights).reshape(-1)  # in [-1, 1]
        return (raw + 1) / 2

    return TrainedCandidate(
        model_type="QNN",
        predict_proba_fn=predict_proba,
        circuit_depth=circuit.decompose().depth(),
        train_seconds=elapsed,
        weights=np.array(classifier.weights),
        support_data=None,
    )


def train_vqc(x: np.ndarray, y: np.ndarray) -> TrainedCandidate:
    """B. VQC: "the underlying circuit approach for the QNN" - feature map + trainable ansatz, COBYLA-optimized."""
    feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
    ansatz = real_amplitudes(num_qubits=settings.feature_dimension, reps=1)
    vqc = VQC(
        feature_map=feature_map,
        ansatz=ansatz,
        optimizer=COBYLA(maxiter=settings.optimizer_max_iter),
        sampler=StatevectorSampler(),
    )

    t0 = time.time()
    vqc.fit(x, y)
    elapsed = time.time() - t0

    def predict_proba(x_query: np.ndarray) -> np.ndarray:
        return vqc.predict_proba(x_query)[:, 1]

    return TrainedCandidate(
        model_type="VQC",
        predict_proba_fn=predict_proba,
        circuit_depth=feature_map.compose(ansatz).decompose().depth(),
        train_seconds=elapsed,
        weights=np.array(vqc.weights),
        support_data=None,
    )


TRAINERS = {"QSVM": train_qsvm, "QNN": train_qnn, "VQC": train_vqc}
