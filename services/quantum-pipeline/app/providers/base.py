"""
QuantumProvider: the abstraction that separates "how to run a quantum job"
from "what IBM Quantum's REST API looks like".

This governs ONLY the new, ad-hoc quantum job-management feature (submit /
poll / cancel a job, browse backends) exposed to exec-admins via
app/main.py's /quantum-jobs* routes. It is deliberately NOT wired into
execution_manager.py's get_estimator()/get_sampler() seam used by the
existing QSVM/QNN/VQC fraud models - see app/config.py's QUANTUM_JOB_PROVIDER
comment for why those stay on the local simulator unconditionally.
"""

from abc import ABC, abstractmethod
from typing import Optional

from .types import BackendInfo, JobHandle, JobResultInfo, JobStatusInfo, ProgramId, ProviderHealth


class QuantumProviderError(Exception):
    """Base class for provider failures, so callers can distinguish
    retryable transport errors from terminal API errors."""


class QuantumProviderTransientError(QuantumProviderError):
    """Network error, timeout, or 5xx - safe to retry with backoff for
    read-only calls. Never automatically retried for job submission/
    cancellation, since a timeout there means "unknown whether the
    provider received it" (see IBMQuantumProvider.submit_job)."""


class QuantumProviderAuthError(QuantumProviderError):
    """401/403, or IAM token mint/refresh failure. Not retryable without
    operator action (bad/expired/revoked credentials)."""


class QuantumProviderRequestError(QuantumProviderError):
    """4xx other than auth - malformed request. Not retryable as-is."""


class QuantumProvider(ABC):
    @abstractmethod
    async def list_backends(self) -> list[BackendInfo]: ...

    @abstractmethod
    async def submit_job(
        self,
        program_id: ProgramId,
        backend: str,
        params: dict,
        tags: Optional[list[str]] = None,
        cost_seconds: Optional[int] = None,
    ) -> JobHandle: ...

    @abstractmethod
    async def get_job_status(self, job_id: str) -> JobStatusInfo: ...

    @abstractmethod
    async def get_job_result(self, job_id: str) -> JobResultInfo: ...

    @abstractmethod
    async def cancel_job(self, job_id: str) -> bool: ...

    @abstractmethod
    async def health_check(self) -> ProviderHealth: ...
