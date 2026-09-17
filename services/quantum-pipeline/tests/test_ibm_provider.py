import logging

import httpx
import pytest
import respx

from app.providers.base import (
    QuantumProviderAuthError,
    QuantumProviderError,
    QuantumProviderRequestError,
    QuantumProviderTransientError,
)
from app.providers.ibm import IBMQuantumProvider

IAM_URL = "https://iam.test/identity/token"
BASE_URL = "https://quantum.test/api"


def make_provider(**overrides) -> IBMQuantumProvider:
    kwargs = dict(
        api_key="test-api-key",
        crn="crn:v1:test:instance",
        base_url=BASE_URL,
        api_version="2025-01-01",
        iam_url=IAM_URL,
        timeout_seconds=1.0,
        max_retries=2,
        token_refresh_margin_seconds=300,
    )
    kwargs.update(overrides)
    return IBMQuantumProvider(**kwargs)


def iam_ok(access_token: str = "tok", expires_in: int = 3600):
    return httpx.Response(200, json={"access_token": access_token, "expires_in": expires_in, "token_type": "Bearer"})


@pytest.mark.asyncio
@respx.mock
async def test_iam_token_is_cached_across_calls():
    iam_route = respx.post(IAM_URL).mock(return_value=iam_ok())
    backends_route = respx.get(f"{BASE_URL}/v1/backends").mock(return_value=httpx.Response(200, json={"devices": []}))
    provider = make_provider()
    await provider.list_backends()
    await provider.list_backends()
    assert iam_route.call_count == 1
    assert backends_route.call_count == 2
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_iam_token_refreshes_once_past_the_safety_margin():
    respx.post(IAM_URL).mock(return_value=iam_ok(expires_in=1))
    respx.get(f"{BASE_URL}/v1/backends").mock(return_value=httpx.Response(200, json={"devices": []}))
    # margin (2s) > ttl (1s) - the token is "stale" from the moment it's
    # minted, so every call must refresh it.
    provider = make_provider(token_refresh_margin_seconds=2)
    await provider.list_backends()
    await provider.list_backends()
    iam_calls = [c for c in respx.calls if str(c.request.url) == IAM_URL]
    assert len(iam_calls) == 2
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_iam_rejection_raises_auth_error_with_no_retry():
    iam_route = respx.post(IAM_URL).mock(return_value=httpx.Response(401, json={"error": "bad key"}))
    provider = make_provider(max_retries=3)
    with pytest.raises(QuantumProviderAuthError):
        await provider.list_backends()
    assert iam_route.call_count == 1
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_get_backends_retries_on_5xx_then_succeeds():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    route = respx.get(f"{BASE_URL}/v1/backends").mock(
        side_effect=[httpx.Response(500), httpx.Response(500), httpx.Response(200, json={"devices": []})]
    )
    provider = make_provider(max_retries=3)
    backends = await provider.list_backends()
    assert backends == []
    assert route.call_count == 3
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_get_backends_401_raises_immediately_without_retrying():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    route = respx.get(f"{BASE_URL}/v1/backends").mock(return_value=httpx.Response(401))
    provider = make_provider(max_retries=3)
    with pytest.raises(QuantumProviderAuthError):
        await provider.list_backends()
    assert route.call_count == 1
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_get_backends_422_raises_request_error_without_retrying():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    route = respx.get(f"{BASE_URL}/v1/backends").mock(return_value=httpx.Response(422, json={"error": "bad request"}))
    provider = make_provider(max_retries=3)
    with pytest.raises(QuantumProviderRequestError):
        await provider.list_backends()
    assert route.call_count == 1
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_submit_job_is_never_retried_on_timeout():
    """The concrete 'never blindly retry job submissions' requirement: a
    timeout on POST /v1/jobs means we don't know if IBM created the job, so
    this must surface to the caller after exactly one attempt, not retry."""
    respx.post(IAM_URL).mock(return_value=iam_ok())
    route = respx.post(f"{BASE_URL}/v1/jobs").mock(side_effect=httpx.TimeoutException("timed out"))
    provider = make_provider(max_retries=3)
    with pytest.raises(QuantumProviderTransientError):
        await provider.submit_job(program_id="sampler", backend="ibm_test", params={})
    assert route.call_count == 1
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_submit_job_success_maps_response_fields():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    respx.post(f"{BASE_URL}/v1/jobs").mock(
        return_value=httpx.Response(200, json={"id": "job-abc", "backend": "ibm_test", "session_id": "sess-1"})
    )
    provider = make_provider()
    handle = await provider.submit_job(program_id="sampler", backend="ibm_test", params={"shots": 100})
    assert handle.id == "job-abc"
    assert handle.backend == "ibm_test"
    assert handle.session_id == "sess-1"
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_get_job_result_204_means_not_ready():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    respx.get(f"{BASE_URL}/v1/jobs/job-1/results").mock(return_value=httpx.Response(204))
    provider = make_provider()
    result = await provider.get_job_result("job-1")
    assert result.ready is False
    assert result.payload is None
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_cancel_job_409_returns_false_not_an_error():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    respx.post(f"{BASE_URL}/v1/jobs/job-1/cancel").mock(return_value=httpx.Response(409))
    provider = make_provider()
    cancelled = await provider.cancel_job("job-1")
    assert cancelled is False
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_malformed_job_status_response_raises_clean_error_not_keyerror():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    respx.get(f"{BASE_URL}/v1/jobs/job-1").mock(return_value=httpx.Response(200, json={"oops": "no status field"}))
    provider = make_provider()
    with pytest.raises(QuantumProviderError):
        await provider.get_job_status("job-1")
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_timeout_after_exhausting_retries_raises_transient_error():
    respx.post(IAM_URL).mock(return_value=iam_ok())
    respx.get(f"{BASE_URL}/v1/backends").mock(side_effect=httpx.TimeoutException("timed out"))
    provider = make_provider(max_retries=1)
    with pytest.raises(QuantumProviderTransientError):
        await provider.list_backends()
    await provider.aclose()


@pytest.mark.asyncio
@respx.mock
async def test_secrets_are_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    respx.post(IAM_URL).mock(return_value=iam_ok(access_token="super-secret-token"))  # noqa: S106
    respx.get(f"{BASE_URL}/v1/backends").mock(return_value=httpx.Response(200, json={"devices": []}))
    provider = make_provider(api_key="super-secret-apikey")
    await provider.list_backends()
    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert "super-secret-apikey" not in log_text
    assert "super-secret-token" not in log_text
    await provider.aclose()
