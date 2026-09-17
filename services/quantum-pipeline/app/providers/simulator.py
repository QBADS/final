"""
SimulatorQuantumProvider: local, real (not mocked) Qiskit execution for the
job-management API, so QUANTUM_JOB_PROVIDER=simulator gives a working,
inspectable circuit result with no IBM account.

Jobs are synchronous under the hood - they complete before submit_job()
returns - but are still tracked by id so the same polling API
(get_job_status/get_job_result) behaves identically to IBMQuantumProvider
from the caller's point of view.

Deliberately unrelated to app/execution_manager.py's get_estimator()/
get_sampler() seam used by the QSVM/QNN/VQC fraud models - see
app/config.py's QUANTUM_JOB_PROVIDER comment.
"""

from typing import Optional
from uuid import uuid4

from qiskit.circuit.library import real_amplitudes, zz_feature_map
from qiskit.primitives import StatevectorEstimator, StatevectorSampler
from qiskit.quantum_info import SparsePauliOp

from ..config import settings
from .base import QuantumProvider
from .types import BackendInfo, JobHandle, JobResultInfo, JobStatusInfo, ProgramId, ProviderHealth

_BACKENDS = [
    BackendInfo(
        name="local_statevector_sampler",
        status="online",
        qubits=settings.feature_dimension,
        queue_length=0,
        processor_type="simulator",
    ),
    BackendInfo(
        name="local_statevector_estimator",
        status="online",
        qubits=settings.feature_dimension,
        queue_length=0,
        processor_type="simulator",
    ),
]


class SimulatorQuantumProvider(QuantumProvider):
    def __init__(self) -> None:
        self._jobs: dict[str, JobResultInfo] = {}

    async def list_backends(self) -> list[BackendInfo]:
        return list(_BACKENDS)

    @staticmethod
    def _build_circuit(num_qubits: int):
        feature_map = zz_feature_map(feature_dimension=num_qubits, reps=1)
        ansatz = real_amplitudes(num_qubits=num_qubits, reps=1)
        circuit = feature_map.compose(ansatz)
        # Bind every free parameter to 0.0 - this provider exercises the
        # job-management plumbing (submit/poll/result), not a specific
        # fraud-model's trained weights.
        return circuit.assign_parameters([0.0] * len(circuit.parameters))

    async def submit_job(
        self,
        program_id: ProgramId,
        backend: str,
        params: dict,
        tags: Optional[list[str]] = None,
        cost_seconds: Optional[int] = None,
    ) -> JobHandle:
        num_qubits = int(params.get("num_qubits", settings.feature_dimension))
        circuit = self._build_circuit(num_qubits)
        job_id = f"sim-job-{uuid4()}"

        if program_id == "sampler":
            measured = circuit.copy()
            measured.measure_all()
            shots = int(params.get("shots", settings.shots))
            result = StatevectorSampler().run([measured], shots=shots).result()
            counts = result[0].data.meas.get_counts()
            payload = {"counts": counts, "shots": shots}
        else:  # "estimator"
            observable = SparsePauliOp("Z" * num_qubits)
            result = StatevectorEstimator().run([(circuit, observable)]).result()
            payload = {"expectationValue": float(result[0].data.evs)}

        self._jobs[job_id] = JobResultInfo(id=job_id, ready=True, payload=payload)
        return JobHandle(id=job_id, backend=backend, session_id=None)

    async def get_job_status(self, job_id: str) -> JobStatusInfo:
        if job_id not in self._jobs:
            raise KeyError(f"unknown simulator job id {job_id!r}")
        return JobStatusInfo(id=job_id, status="Completed")

    async def get_job_result(self, job_id: str) -> JobResultInfo:
        if job_id not in self._jobs:
            raise KeyError(f"unknown simulator job id {job_id!r}")
        return self._jobs[job_id]

    async def cancel_job(self, job_id: str) -> bool:
        if job_id not in self._jobs:
            raise KeyError(f"unknown simulator job id {job_id!r}")
        return False  # already-completed synchronous jobs are always terminal

    async def health_check(self) -> ProviderHealth:
        return ProviderHealth(reachable=True)
