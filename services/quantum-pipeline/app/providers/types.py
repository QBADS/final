"""
Shared value types for the QuantumProvider abstraction (app/providers/base.py).

These are deliberately provider-agnostic: MockQuantumProvider,
SimulatorQuantumProvider and IBMQuantumProvider all return the same shapes so
app/main.py's job-management routes never need to know which one is live.
"""

from dataclasses import dataclass, field
from typing import Literal, Optional

JobStatus = Literal[
    "Queued",
    "Running",
    "Completed",
    "Cancelled",
    "Cancelled - Ran too long",
    "Failed",
]

BackendStatusName = Literal["online", "paused", "offline"]

ProgramId = Literal["sampler", "estimator"]


@dataclass
class BackendInfo:
    name: str
    status: BackendStatusName
    qubits: int
    queue_length: int
    processor_type: Optional[str] = None


@dataclass
class JobHandle:
    id: str
    backend: str
    session_id: Optional[str] = None


@dataclass
class JobStatusInfo:
    id: str
    status: JobStatus
    reason: Optional[str] = None
    queue_position: Optional[int] = None
    estimated_running_time_seconds: Optional[float] = None


@dataclass
class JobResultInfo:
    id: str
    ready: bool  # False => still running / not ready, payload is None
    payload: Optional[dict] = field(default=None)  # raw program-specific result payload


@dataclass
class ProviderHealth:
    reachable: bool
    detail: Optional[str] = None
