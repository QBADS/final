"""
MockQuantumProvider: fully deterministic canned data, no qiskit execution at
all. Default provider (QUANTUM_JOB_PROVIDER=mock) so the whole job-management
feature works out of the box with no IBM credentials and no simulator
overhead - this is what the default test suite and local dev exercise.
"""

import time
from typing import Optional
from uuid import uuid4

from .base import QuantumProvider
from .types import BackendInfo, JobHandle, JobResultInfo, JobStatusInfo, ProgramId, ProviderHealth

_FIXED_BACKENDS = [
    BackendInfo(name="mock_backend_a", status="online", qubits=27, queue_length=3, processor_type="mock"),
    BackendInfo(name="mock_backend_b", status="online", qubits=127, queue_length=12, processor_type="mock"),
    BackendInfo(name="mock_backend_paused", status="paused", qubits=5, queue_length=0, processor_type="mock"),
]

# Wall-clock seconds since submission at which a mock job's status advances -
# just enough to let dashboard polling exercise Queued -> Running -> Completed
# without a real backend.
_RUNNING_AFTER_SECONDS = 2.0
_COMPLETED_AFTER_SECONDS = 5.0


class MockQuantumProvider(QuantumProvider):
    def __init__(self) -> None:
        self._submitted_at: dict[str, float] = {}
        self._backend_by_job: dict[str, str] = {}

    async def list_backends(self) -> list[BackendInfo]:
        return list(_FIXED_BACKENDS)

    async def submit_job(
        self,
        program_id: ProgramId,
        backend: str,
        params: dict,
        tags: Optional[list[str]] = None,
        cost_seconds: Optional[int] = None,
    ) -> JobHandle:
        job_id = f"mock-job-{uuid4()}"
        self._submitted_at[job_id] = time.time()
        self._backend_by_job[job_id] = backend
        return JobHandle(id=job_id, backend=backend, session_id=None)

    def _status_for(self, job_id: str) -> str:
        if job_id not in self._submitted_at:
            raise KeyError(f"unknown mock job id {job_id!r}")
        elapsed = time.time() - self._submitted_at[job_id]
        if elapsed < _RUNNING_AFTER_SECONDS:
            return "Queued"
        if elapsed < _COMPLETED_AFTER_SECONDS:
            return "Running"
        return "Completed"

    async def get_job_status(self, job_id: str) -> JobStatusInfo:
        status = self._status_for(job_id)
        return JobStatusInfo(
            id=job_id,
            status=status,
            queue_position=0 if status == "Queued" else None,
            estimated_running_time_seconds=1.0 if status != "Completed" else None,
        )

    async def get_job_result(self, job_id: str) -> JobResultInfo:
        status = self._status_for(job_id)
        if status != "Completed":
            return JobResultInfo(id=job_id, ready=False, payload=None)
        return JobResultInfo(
            id=job_id,
            ready=True,
            payload={"counts": {"00000000": 512, "11111111": 512}, "shots": 1024, "mock": True},
        )

    async def cancel_job(self, job_id: str) -> bool:
        if job_id not in self._submitted_at:
            raise KeyError(f"unknown mock job id {job_id!r}")
        if self._status_for(job_id) == "Completed":
            return False
        del self._submitted_at[job_id]
        return True

    async def health_check(self) -> ProviderHealth:
        return ProviderHealth(reachable=True, detail=None)
