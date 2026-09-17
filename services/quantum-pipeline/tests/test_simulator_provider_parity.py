import pytest

from app.config import settings
from app.providers.simulator import SimulatorQuantumProvider


@pytest.mark.asyncio
async def test_sampler_job_counts_sum_to_requested_shots():
    provider = SimulatorQuantumProvider()
    handle = await provider.submit_job(program_id="sampler", backend="local_statevector_sampler", params={"shots": 256})
    result = await provider.get_job_result(handle.id)
    assert result.ready is True
    counts = result.payload["counts"]
    assert sum(counts.values()) == 256
    assert all(len(bitstring) == settings.feature_dimension for bitstring in counts)


@pytest.mark.asyncio
async def test_estimator_job_expectation_value_is_physical():
    provider = SimulatorQuantumProvider()
    handle = await provider.submit_job(program_id="estimator", backend="local_statevector_estimator", params={})
    result = await provider.get_job_result(handle.id)
    assert result.ready is True
    assert -1.0 <= result.payload["expectationValue"] <= 1.0


@pytest.mark.asyncio
async def test_job_is_immediately_completed_no_polling_needed():
    provider = SimulatorQuantumProvider()
    handle = await provider.submit_job(program_id="sampler", backend="local_statevector_sampler", params={})
    status = await provider.get_job_status(handle.id)
    assert status.status == "Completed"


@pytest.mark.asyncio
async def test_list_backends_matches_configured_qubit_count():
    provider = SimulatorQuantumProvider()
    backends = await provider.list_backends()
    assert all(b.qubits == settings.feature_dimension for b in backends)


def test_infer_is_deterministic_given_a_fixed_trained_model(client):
    """
    Zero-regression guard: this feature deliberately does NOT touch
    execution_manager.py or the QSVM/QNN/VQC models (see providers/base.py's
    module docstring), so /infer's behavior must be provably unchanged.
    Uses QSVM specifically: its FidelityStatevectorKernel path is a pure
    kernel evaluation (no measurement sampling), so it's deterministic given
    fixed weights - unlike QNN/VQC, whose predict path samples circuit
    measurements with no fixed seed and is therefore expected to vary
    slightly between calls even on unmodified, pre-existing code (confirmed
    empirically while writing this test - that variance is real, existing
    behavior, not something this change should try to paper over).
    """
    vector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    r1 = client.post("/infer", json={"recordId": "rec-parity-1", "vector": vector, "modelType": "QSVM"})
    r2 = client.post("/infer", json={"recordId": "rec-parity-1", "vector": vector, "modelType": "QSVM"})
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["anomalyScore"] == r2.json()["anomalyScore"]
    assert r1.json()["rawScore"] == r2.json()["rawScore"]
    assert r1.json()["circuitDepth"] == r2.json()["circuitDepth"]
