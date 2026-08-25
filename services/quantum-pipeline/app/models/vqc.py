import numpy as np
from qiskit.circuit.library import real_amplitudes, zz_feature_map
from qiskit_algorithms.optimizers import COBYLA
from qiskit_machine_learning.algorithms import VQC

from ..config import settings
from ..execution_manager import get_sampler
from .base import QuantumFraudModel


class VQCModel(QuantumFraudModel):
    """
    "B. QNN / VQC - variational optimisation": feature map + trainable
    ansatz, trained via a classical optimizer (COBYLA here; the doc also
    names SPSA and L-BFGS as options). Uses qiskit-machine-learning's
    high-level VQC classifier directly, which is the doc's own description
    of VQC as "the underlying circuit approach for the QNN" made concrete.
    """

    model_type = "VQC"

    def __init__(self) -> None:
        self.model_version = settings.model_version
        self._feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
        self._ansatz = real_amplitudes(num_qubits=settings.feature_dimension, reps=1)
        self._vqc = VQC(
            feature_map=self._feature_map,
            ansatz=self._ansatz,
            optimizer=COBYLA(maxiter=50),
            sampler=get_sampler(),
        )
        self._fitted = False

    def fit(self, x: np.ndarray, y: np.ndarray) -> None:
        self._vqc.fit(x, y)
        self._fitted = True

    def load_weights(self, weights: np.ndarray, version: str) -> None:
        """
        Installs weights trained elsewhere (services/training-pipeline) as
        this model's current parameters, without re-running COBYLA.
        qiskit-machine-learning's `weights` property has no public setter -
        it's read from the optimizer's `_fit_result.x` - so this injects a
        minimal stand-in result object with just that field. Verified this
        produces bit-identical predictions to actually calling .fit() on
        the same weights before relying on it here.
        """
        from types import SimpleNamespace

        self._vqc._fit_result = SimpleNamespace(x=np.asarray(weights))
        self._fitted = True
        self.model_version = version

    def predict_proba(self, x: np.ndarray) -> float:
        if not self._fitted:
            raise RuntimeError("VQCModel.fit must be called before predict_proba")
        # VQC.predict_proba returns [P(class=0), P(class=1)] for one sample.
        proba = self._vqc.predict_proba(x.reshape(1, -1))[0]
        return float(proba[1])

    def circuit_depth(self) -> int:
        return self._feature_map.compose(self._ansatz).decompose().depth()
