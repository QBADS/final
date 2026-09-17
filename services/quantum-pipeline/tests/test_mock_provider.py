import pytest

from app.providers.mock import MockQuantumProvider


@pytest.mark.asyncio
async def test_list_backends_returns_fixed_roster():
    provider = MockQuantumProvider()
    backends = await provider.list_backends()
    assert len(backends) == 3
    assert backends[0].name == "mock_backend_a"
    assert backends[0].status == "online"


@pytest.mark.asyncio
async def test_submit_job_returns_deterministic_id_shape():
    provider = MockQuantumProvider()
    handle = await provider.submit_job(program_id="sampler", backend="mock_backend_a", params={})
    assert handle.id.startswith("mock-job-")
    assert handle.backend == "mock_backend_a"


@pytest.mark.asyncio
async def test_status_transitions_from_queued_to_completed():
    provider = MockQuantumProvider()
    handle = await provider.submit_job(program_id="sampler", backend="mock_backend_a", params={})

    status = await provider.get_job_status(handle.id)
    assert status.status == "Queued"

    # Backdate submission instead of sleeping, to keep the test fast and
    # deterministic while still exercising the real elapsed-time logic.
    provider._submitted_at[handle.id] -= 10
    status = await provider.get_job_status(handle.id)
    assert status.status == "Completed"

    result = await provider.get_job_result(handle.id)
    assert result.ready is True
    assert result.payload["mock"] is True


@pytest.mark.asyncio
async def test_result_not_ready_before_completion():
    provider = MockQuantumProvider()
    handle = await provider.submit_job(program_id="sampler", backend="mock_backend_a", params={})
    result = await provider.get_job_result(handle.id)
    assert result.ready is False
    assert result.payload is None


@pytest.mark.asyncio
async def test_cancel_before_completion_succeeds_and_forgets_job():
    provider = MockQuantumProvider()
    handle = await provider.submit_job(program_id="estimator", backend="mock_backend_b", params={})
    cancelled = await provider.cancel_job(handle.id)
    assert cancelled is True
    with pytest.raises(KeyError):
        await provider.get_job_status(handle.id)


@pytest.mark.asyncio
async def test_cancel_after_completion_returns_false():
    provider = MockQuantumProvider()
    handle = await provider.submit_job(program_id="sampler", backend="mock_backend_a", params={})
    provider._submitted_at[handle.id] -= 10
    cancelled = await provider.cancel_job(handle.id)
    assert cancelled is False


@pytest.mark.asyncio
async def test_unknown_job_id_raises_keyerror():
    provider = MockQuantumProvider()
    with pytest.raises(KeyError):
        await provider.get_job_status("nonexistent")
    with pytest.raises(KeyError):
        await provider.cancel_job("nonexistent")


@pytest.mark.asyncio
async def test_health_check_always_reachable():
    provider = MockQuantumProvider()
    health = await provider.health_check()
    assert health.reachable is True
