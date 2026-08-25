"""
"Execution Manager: Sits beneath these models and decides whether execution
occurs on a simulator, noise-aware simulator, or eventually a real QPU"
(Quantum_Engine_Base_Architecture.pdf, Section 03).

Only "simulator" is implemented - there's no QPU access or noise-model
configuration to route to yet. What matters architecturally is that the
model layer (models/qnn.py, models/vqc.py) asks this module for a
primitive rather than constructing one itself, so adding a noise-aware or
hardware backend later is a change here, not in every model.
"""

from qiskit.primitives import StatevectorEstimator, StatevectorSampler

from .config import settings


class UnsupportedBackendError(Exception):
    pass


def get_estimator() -> StatevectorEstimator:
    if settings.backend_mode != "simulator":
        raise UnsupportedBackendError(f"backend_mode={settings.backend_mode!r} not implemented yet")
    return StatevectorEstimator()


def get_sampler() -> StatevectorSampler:
    if settings.backend_mode != "simulator":
        raise UnsupportedBackendError(f"backend_mode={settings.backend_mode!r} not implemented yet")
    return StatevectorSampler()
