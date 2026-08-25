import numpy as np
from qiskit.circuit.library import real_amplitudes, zz_feature_map
from qiskit_algorithms.optimizers import COBYLA
from qiskit_machine_learning.algorithms.classifiers import NeuralNetworkClassifier
from qiskit_machine_learning.neural_networks import EstimatorQNN

from ..config import settings
from ..execution_manager import get_estimator
from .base import QuantumFraudModel


class QNNModel(QuantumFraudModel):
    """
    "B. QNN / VQC - variational optimisation"
    (Quantum_Engine_Base_Architecture.pdf, Section 05, box 4A): feature map
    -> parameterized ansatz -> measurement -> prediction -> classical
    optimizer updates theta. Distinct from VQCModel (vqc.py) in using
    EstimatorQNN's expectation-value output directly rather than the
    higher-level VQC classifier wrapper, per the doc's own distinction that
    QNN and VQC are related but separate entries in the model layer.
    """

    model_type = "QNN"

    def __init__(self) -> None:
        self.model_version = settings.model_version
        self._feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
        self._ansatz = real_amplitudes(num_qubits=settings.feature_dimension, reps=1)
        circuit = self._feature_map.compose(self._ansatz)
        self._qnn = EstimatorQNN(
            circuit=circuit,
            estimator=get_estimator(),
            input_params=self._feature_map.parameters,
            weight_params=self._ansatz.parameters,
        )
        self._classifier = NeuralNetworkClassifier(neural_network=self._qnn, optimizer=COBYLA(maxiter=50))
        self._fitted = False

    def fit(self, x: np.ndarray, y: np.ndarray) -> None:
        # EstimatorQNN's single output is an expectation value in [-1, 1];
        # NeuralNetworkClassifier's binary convention for that output range
        # is {-1, +1} labels, not {0, 1}.
        y_pm = 2 * y - 1
        self._classifier.fit(x, y_pm)
        self._fitted = True

    def load_weights(self, weights: np.ndarray, version: str) -> None:
        """Installs weights trained by services/training-pipeline - see
        VQCModel.load_weights for why this reaches into a private attribute."""
        from types import SimpleNamespace

        self._classifier._fit_result = SimpleNamespace(x=np.asarray(weights))
        self._fitted = True
        self.model_version = version

    def predict_proba(self, x: np.ndarray) -> float:
        if not self._fitted:
            raise RuntimeError("QNNModel.fit must be called before predict_proba")
        raw = float(self._qnn.forward(x.reshape(1, -1), self._classifier.weights)[0][0])  # in [-1, 1]
        return (raw + 1) / 2

    def circuit_depth(self) -> int:
        return self._feature_map.compose(self._ansatz).decompose().depth()
