"""
Selects which QuantumProvider implementation backs the job-management
feature, based on settings.quantum_job_provider. See app/config.py for why
this is independent of backend_mode.
"""

from ..config import settings
from .base import QuantumProvider
from .ibm import IBMQuantumProvider
from .mock import MockQuantumProvider
from .simulator import SimulatorQuantumProvider


def get_job_provider() -> QuantumProvider:
    mode = settings.quantum_job_provider
    if mode == "mock":
        return MockQuantumProvider()
    if mode == "simulator":
        return SimulatorQuantumProvider()
    if mode == "ibm":
        if not settings.ibm_quantum_api_key or not settings.ibm_quantum_crn:
            raise RuntimeError(
                "QUANTUM_JOB_PROVIDER=ibm requires IBM_QUANTUM_API_KEY and IBM_QUANTUM_CRN to be set"
            )
        return IBMQuantumProvider(
            api_key=settings.ibm_quantum_api_key,
            crn=settings.ibm_quantum_crn,
            base_url=settings.ibm_quantum_api_base_url,
            api_version=settings.ibm_quantum_api_version,
            iam_url=settings.ibm_quantum_iam_url,
            timeout_seconds=settings.ibm_quantum_timeout_seconds,
            max_retries=settings.ibm_quantum_max_retries,
            token_refresh_margin_seconds=settings.ibm_quantum_token_refresh_margin_seconds,
        )
    raise RuntimeError(f"unknown QUANTUM_JOB_PROVIDER={mode!r}")


# Singleton, built at import time - mirrors the existing `settings = Settings()`
# module-level-singleton convention in app/config.py.
job_provider: QuantumProvider = get_job_provider()
