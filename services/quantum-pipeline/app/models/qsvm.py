import numpy as np
from qiskit.circuit.library import zz_feature_map
from qiskit_machine_learning.algorithms import QSVC
from qiskit_machine_learning.kernels import FidelityStatevectorKernel

from ..config import settings
from .base import QuantumFraudModel


class QSVMModel(QuantumFraudModel):
    """
    "A. QSVM - kernel-based classifier" (Quantum_Engine_Base_Architecture.pdf,
    Section 05, box 4A): quantum feature map -> quantum kernel -> kernel
    matrix -> classical SVM optimization. Uses FidelityStatevectorKernel
    (direct statevector fidelity) rather than the primitive/sampler-based
    FidelityQuantumKernel - benchmarked ~100x faster for local simulation
    since it skips per-pair circuit transpilation, which matters because
    prediction requires a kernel evaluation against every bootstrap sample.
    """

    model_type = "QSVM"

    def __init__(self) -> None:
        self.model_version = settings.model_version
        self._feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
        self._kernel = FidelityStatevectorKernel(feature_map=self._feature_map)
        self._qsvc = QSVC(quantum_kernel=self._kernel)
        self._fitted = False

    def fit(self, x: np.ndarray, y: np.ndarray) -> None:
        self._qsvc.fit(x, y)
        self._fitted = True

    def load_qsvc(self, qsvc: QSVC, version: str) -> None:
        """
        Installs a QSVC trained elsewhere (services/training-pipeline).
        Unlike QNN/VQC, QSVM has no fixed-size weight vector to inject - a
        kernel method's "parameters" are its support vectors - so the whole
        fitted classifier is swapped in rather than reconstructed.
        """
        self._qsvc = qsvc
        self._fitted = True
        self.model_version = version

    def predict_proba(self, x: np.ndarray) -> float:
        if not self._fitted:
            raise RuntimeError("QSVMModel.fit must be called before predict_proba")
        # decision_function's sign gives the class; its magnitude is not a
        # calibrated probability, so squash it through a logistic to get a
        # 0-1 score without the extra cost of sklearn's probability=True
        # path (which internally cross-validates and roughly 5x's fit time).
        margin = self._qsvc.decision_function(x.reshape(1, -1))[0]
        return float(1 / (1 + np.exp(-margin)))

    def circuit_depth(self) -> int:
        return self._feature_map.decompose().depth()
