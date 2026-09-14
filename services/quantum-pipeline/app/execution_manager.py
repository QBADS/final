"""
"Execution Manager: Sits beneath these models and decides whether execution
occurs on a simulator, noise-aware simulator, or eventually a real QPU"
(Quantum_Engine_Base_Architecture.pdf, Section 03).

Two modes are implemented: "simulator" (local qiskit primitives, the
default) and "ibm_qpu" (IBM Quantum Platform, via qiskit-ibm-runtime).
What matters architecturally is that the model layer (models/qnn.py,
models/vqc.py, models/qsvm.py) asks this module for a primitive/kernel/pass
manager rather than constructing one itself, so routing to a different
backend is a change here, not in every model - this is the only module
that imports qiskit_ibm_runtime or knows an IBM backend exists.

Real-hardware note: this was built and verified against
qiskit_ibm_runtime.fake_provider backends (e.g. FakeSherbrooke), which
carry a real IBM device's exact coupling map/basis gates and execute
entirely locally - see config.py's IBM_QUANTUM_FAKE_BACKEND. That proves
the ISA-transpilation / primitive-invocation path below is correct. It has
NOT been exercised against a live QiskitRuntimeService account: this
sandbox's network egress proxy blocks IBM's cloud API hosts
(quantum.cloud.ibm.com, cloud.ibm.com) by the same allowlist policy that
blocks Docker Hub - confirmed, not assumed. Swapping in a real
token/instance (IBM_QUANTUM_TOKEN / IBM_QUANTUM_INSTANCE, no
IBM_QUANTUM_FAKE_BACKEND set) requires no code change, only network
reachability this environment doesn't have.
"""

from functools import lru_cache
from typing import Any

from qiskit.primitives import StatevectorEstimator, StatevectorSampler
from qiskit.transpiler.passmanager import PassManager
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

from .config import settings

_SUPPORTED_MODES = ("simulator", "ibm_qpu")


class UnsupportedBackendError(Exception):
    pass


def _require_supported_mode() -> None:
    if settings.backend_mode not in _SUPPORTED_MODES:
        raise UnsupportedBackendError(f"backend_mode={settings.backend_mode!r} not implemented yet")


@lru_cache(maxsize=1)
def _ibm_backend() -> Any:
    """
    Resolves once per process - backends/fake-backends are expensive to
    construct, and the choice can't change mid-run without a restart, same
    as every other model/config setting in this service.
    """
    if settings.ibm_fake_backend:
        from qiskit_ibm_runtime import fake_provider

        try:
            fake_cls = getattr(fake_provider, settings.ibm_fake_backend)
        except AttributeError as exc:
            raise UnsupportedBackendError(
                f"IBM_QUANTUM_FAKE_BACKEND={settings.ibm_fake_backend!r} is not a "
                "qiskit_ibm_runtime.fake_provider backend class"
            ) from exc
        return fake_cls()

    if not settings.ibm_token or not settings.ibm_instance:
        raise UnsupportedBackendError(
            "backend_mode=ibm_qpu requires IBM_QUANTUM_TOKEN and IBM_QUANTUM_INSTANCE "
            "(or IBM_QUANTUM_FAKE_BACKEND for local development/testing without a real account)"
        )

    from qiskit_ibm_runtime import QiskitRuntimeService

    service = QiskitRuntimeService(
        channel=settings.ibm_channel,
        token=settings.ibm_token,
        instance=settings.ibm_instance,
    )
    if settings.ibm_backend_name:
        return service.backend(settings.ibm_backend_name)
    return service.least_busy(operational=True, simulator=False)


def get_pass_manager() -> PassManager | None:
    """
    None on the simulator (StatevectorEstimator/Sampler run arbitrary
    circuits directly, no ISA constraint). On ibm_qpu, a preset pass
    manager targeting the resolved backend's real coupling map/basis
    gates - passed straight into EstimatorQNN/VQC/ComputeUncompute's own
    `pass_manager=` argument, which is qiskit-machine-learning's supported
    mechanism for transpiling to ISA before every primitive call. This is
    why models/qnn.py and vqc.py need one extra `pass_manager=...` line
    rather than execution_manager needing to hand-roll circuit rewriting
    itself - qiskit-machine-learning already does that correctly.
    """
    _require_supported_mode()
    if settings.backend_mode != "ibm_qpu":
        return None
    # optimization_level=1: light optimization, fast transpile - correctness
    # (mapping onto the backend's real coupling map/basis gates) matters far
    # more here than shaving circuit depth for a circuit this small (8
    # qubits, reps=1); it won't meaningfully benefit from level 2/3's extra
    # compile time.
    return generate_preset_pass_manager(backend=_ibm_backend(), optimization_level=1)


def get_estimator():
    _require_supported_mode()
    if settings.backend_mode == "ibm_qpu":
        from qiskit_ibm_runtime import EstimatorV2

        estimator = EstimatorV2(mode=_ibm_backend())
        estimator.options.default_shots = settings.shots
        return estimator
    return StatevectorEstimator()


def get_sampler():
    _require_supported_mode()
    if settings.backend_mode == "ibm_qpu":
        from qiskit_ibm_runtime import SamplerV2

        sampler = SamplerV2(mode=_ibm_backend())
        sampler.options.default_shots = settings.shots
        return sampler
    return StatevectorSampler()


def get_quantum_kernel(feature_map):
    """
    QSVM (models/qsvm.py) doesn't go through get_estimator/get_sampler
    directly - a quantum kernel is a fidelity between two feature-mapped
    states, not an expectation value or a measurement sample. On the
    simulator that's FidelityStatevectorKernel (direct statevector fidelity
    - no circuit execution at all, hence no backend to route). On ibm_qpu
    it must be FidelityQuantumKernel wrapping a ComputeUncompute fidelity,
    which actually runs the overlap circuit through a Sampler on real
    hardware - so it now correctly routes through get_sampler() and
    get_pass_manager() instead of silently staying on the local simulator
    the way it did before this function existed.
    """
    _require_supported_mode()
    if settings.backend_mode == "ibm_qpu":
        from qiskit_machine_learning.kernels import FidelityQuantumKernel
        from qiskit_machine_learning.state_fidelities import ComputeUncompute

        fidelity = ComputeUncompute(sampler=get_sampler(), pass_manager=get_pass_manager())
        return FidelityQuantumKernel(feature_map=feature_map, fidelity=fidelity)

    from qiskit_machine_learning.kernels import FidelityStatevectorKernel

    return FidelityStatevectorKernel(feature_map=feature_map)
