"""
IBMQuantumProvider: real IBM Cloud IAM auth + IBM Quantum Compute Service
REST API client (https://quantum.cloud.ibm.com/api, verified against
official IBM Quantum documentation, Sept 2026).

- IAM token: POST {iam_url}, form-encoded
  grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=<key>, cached and
  refreshed with a safety margin (never minted per-request).
- Every Quantum API call carries: Authorization: Bearer <token>,
  Service-CRN: <crn>, IBM-API-Version: <YYYY-MM-DD>.

Never blindly retries a job submission: a timeout/5xx on POST /v1/jobs means
"unknown whether IBM actually received it", which is surfaced to the caller
(middleware) as QuantumProviderTransientError rather than silently retried
here - middleware owns the actual idempotency guarantee via its own
DB-backed idempotency key (see services/middleware's quantumJobsApi route).

Secret redaction: the raw api_key, access_token, and Authorization header
value are never passed to any logger.* call anywhere in this module - only
token presence/expiry is logged.
"""

import asyncio
import logging
import random
import time
from typing import Optional

import httpx

from .base import (
    QuantumProvider,
    QuantumProviderAuthError,
    QuantumProviderError,
    QuantumProviderRequestError,
    QuantumProviderTransientError,
)
from .types import BackendInfo, JobHandle, JobResultInfo, JobStatusInfo, ProgramId, ProviderHealth

logger = logging.getLogger("quantum-engine.ibm-provider")

_RETRYABLE_METHODS = {"GET"}
_TRANSPORT_ERRORS = (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError)


class _CachedToken:
    __slots__ = ("access_token", "expires_at")

    def __init__(self, access_token: str, expires_at: float) -> None:
        self.access_token = access_token
        self.expires_at = expires_at


class IBMQuantumProvider(QuantumProvider):
    def __init__(
        self,
        api_key: str,
        crn: str,
        base_url: str,
        api_version: str,
        iam_url: str = "https://iam.cloud.ibm.com/identity/token",
        timeout_seconds: float = 30.0,
        max_retries: int = 3,
        token_refresh_margin_seconds: int = 300,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._api_key = api_key
        self._crn = crn
        self._base_url = base_url.rstrip("/")
        self._api_version = api_version
        self._iam_url = iam_url
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._token_refresh_margin_seconds = token_refresh_margin_seconds
        self._client = http_client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = http_client is None
        self._token: Optional[_CachedToken] = None
        self._token_lock = asyncio.Lock()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def _token_is_fresh(self) -> bool:
        return self._token is not None and time.time() < self._token.expires_at - self._token_refresh_margin_seconds

    async def _get_access_token(self) -> str:
        if self._token_is_fresh():
            return self._token.access_token
        async with self._token_lock:
            # Re-check inside the lock - another concurrent caller may have
            # already refreshed it while we were waiting our turn.
            if self._token_is_fresh():
                return self._token.access_token
            try:
                response = await self._client.post(
                    self._iam_url,
                    headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
                    data={"grant_type": "urn:ibm:params:oauth:grant-type:apikey", "apikey": self._api_key},
                )
            except _TRANSPORT_ERRORS as err:
                raise QuantumProviderTransientError(f"IAM token request failed: {err}") from err
            if response.status_code in (401, 403):
                raise QuantumProviderAuthError("IBM IAM rejected the configured API key")
            if response.status_code >= 500:
                raise QuantumProviderTransientError(f"IAM token endpoint returned {response.status_code}")
            if response.status_code >= 400:
                raise QuantumProviderRequestError(f"IAM token request malformed: {response.status_code}")
            try:
                body = response.json()
                access_token = body["access_token"]
                expires_in = float(body.get("expires_in", 3600))
            except (KeyError, TypeError, ValueError) as err:
                raise QuantumProviderError(f"malformed IAM token response: {err}") from err
            self._token = _CachedToken(access_token=access_token, expires_at=time.time() + expires_in)
            logger.info("IBM IAM token refreshed, expires_at=%.0f", self._token.expires_at)
            return access_token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        retryable: bool,
        expected_error_statuses: frozenset = frozenset(),
        **kwargs,
    ) -> httpx.Response:
        url = f"{self._base_url}{path}"
        attempts = self._max_retries + 1 if retryable and method in _RETRYABLE_METHODS else 1
        last_error: Optional[Exception] = None
        for attempt in range(attempts):
            try:
                token = await self._get_access_token()
                headers = {
                    "Authorization": f"Bearer {token}",
                    "Service-CRN": self._crn,
                    "IBM-API-Version": self._api_version,
                    "Accept": "application/json",
                }
                response = await self._client.request(method, url, headers=headers, **kwargs)
            except QuantumProviderError:
                raise  # auth/token failures are never retried here, re-raise as-is
            except _TRANSPORT_ERRORS as err:
                last_error = QuantumProviderTransientError(f"{method} {path} failed: {err}")
                if attempt + 1 < attempts:
                    await self._sleep_backoff(attempt)
                    continue
                raise last_error from err

            if response.status_code in expected_error_statuses:
                return response
            if response.status_code in (401, 403):
                raise QuantumProviderAuthError(f"{method} {path} returned {response.status_code}")
            if response.status_code >= 500:
                last_error = QuantumProviderTransientError(f"{method} {path} returned {response.status_code}")
                if attempt + 1 < attempts:
                    await self._sleep_backoff(attempt)
                    continue
                raise last_error
            if response.status_code >= 400:
                raise QuantumProviderRequestError(f"{method} {path} returned {response.status_code}: {response.text[:500]}")
            return response
        raise last_error or QuantumProviderError(f"{method} {path} failed with no response")

    @staticmethod
    async def _sleep_backoff(attempt: int) -> None:
        delay = min(2**attempt, 8) + random.uniform(0, 0.5)
        await asyncio.sleep(delay)

    async def list_backends(self) -> list[BackendInfo]:
        response = await self._request("GET", "/v1/backends", retryable=True)
        try:
            body = response.json()
            raw_devices = body.get("devices", body) if isinstance(body, dict) else body
            backends = []
            for item in raw_devices:
                status = item.get("status", {}) if isinstance(item.get("status"), dict) else {}
                processor_type = item.get("processor_type") or {}
                backends.append(
                    BackendInfo(
                        name=item["name"],
                        status=status.get("name", "offline"),
                        qubits=item.get("qubits") or item.get("physical_qubits") or 0,
                        queue_length=item.get("queue_length", 0),
                        processor_type=processor_type.get("family") if isinstance(processor_type, dict) else None,
                    )
                )
            return backends
        except (KeyError, TypeError, ValueError) as err:
            raise QuantumProviderError(f"malformed GET /v1/backends response: {err}") from err

    async def submit_job(
        self,
        program_id: ProgramId,
        backend: str,
        params: dict,
        tags: Optional[list[str]] = None,
        cost_seconds: Optional[int] = None,
    ) -> JobHandle:
        # retryable=False is deliberate: see module docstring - a timeout/5xx
        # here does not tell us whether IBM created the job.
        body: dict = {"program_id": program_id, "backend": backend, "params": params}
        if tags:
            body["tags"] = tags
        if cost_seconds is not None:
            body["cost"] = cost_seconds
        response = await self._request("POST", "/v1/jobs", retryable=False, json=body)
        try:
            payload = response.json()
            return JobHandle(
                id=payload["id"],
                backend=payload.get("backend", backend),
                session_id=payload.get("session_id"),
            )
        except (KeyError, TypeError, ValueError) as err:
            raise QuantumProviderError(f"malformed POST /v1/jobs response: {err}") from err

    async def get_job_status(self, job_id: str) -> JobStatusInfo:
        response = await self._request("GET", f"/v1/jobs/{job_id}", retryable=True)
        try:
            payload = response.json()
            state = payload.get("state") or {}
            return JobStatusInfo(
                id=payload["id"],
                status=payload["status"],
                reason=state.get("reason"),
                queue_position=None,
                estimated_running_time_seconds=payload.get("estimated_running_time_seconds"),
            )
        except (KeyError, TypeError, ValueError) as err:
            raise QuantumProviderError(f"malformed GET /v1/jobs/{{id}} response: {err}") from err

    async def get_job_result(self, job_id: str) -> JobResultInfo:
        response = await self._request(
            "GET", f"/v1/jobs/{job_id}/results", retryable=True, expected_error_statuses=frozenset({204})
        )
        if response.status_code == 204:
            return JobResultInfo(id=job_id, ready=False, payload=None)
        try:
            payload = response.json()
        except ValueError as err:
            raise QuantumProviderError(f"malformed GET /v1/jobs/{{id}}/results response: {err}") from err
        return JobResultInfo(id=job_id, ready=True, payload=payload)

    async def cancel_job(self, job_id: str) -> bool:
        # Also deliberately retryable=False - matches submit_job's reasoning.
        response = await self._request(
            "POST", f"/v1/jobs/{job_id}/cancel", retryable=False, expected_error_statuses=frozenset({409})
        )
        return response.status_code != 409

    async def health_check(self) -> ProviderHealth:
        try:
            await asyncio.wait_for(self.list_backends(), timeout=5.0)
            return ProviderHealth(reachable=True)
        except Exception as err:  # noqa: BLE001 - health checks report, never raise
            return ProviderHealth(reachable=False, detail=str(err))
