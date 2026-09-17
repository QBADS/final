"""
Opt-in, manual smoke test against a REAL IBM Quantum Compute Service
account. This is deliberately NOT under tests/ and NOT picked up by
pytest's testpaths=tests - it costs real IBM Cloud quota and requires real
credentials, so it must never run automatically (CI, a normal `pytest`
invocation, etc.).

Usage:
    LIVE_IBM_TEST=1 IBM_QUANTUM_API_KEY=... IBM_QUANTUM_CRN=... \
      ./.venv/Scripts/python scripts/live_ibm_smoke_test.py

What it does: mints a real IAM token, lists real backends, and submits one
small sampler job against the least-busy operational backend, then polls it
to completion (or a bounded timeout) and prints the result. It does not
retry the submission (see app/providers/ibm.py's module docstring for why)
and does not clean up/cancel on your behalf beyond what you ask it to.
"""

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.providers.ibm import IBMQuantumProvider  # noqa: E402

POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 300


async def main() -> None:
    if os.environ.get("LIVE_IBM_TEST") != "1":
        print("Refusing to run: set LIVE_IBM_TEST=1 to confirm you want to use real IBM Cloud quota.")
        sys.exit(1)

    api_key = os.environ.get("IBM_QUANTUM_API_KEY")
    crn = os.environ.get("IBM_QUANTUM_CRN")
    if not api_key or not crn:
        print("IBM_QUANTUM_API_KEY and IBM_QUANTUM_CRN must both be set.")
        sys.exit(1)

    print("!!! This will mint a real IAM token and submit a real job against your IBM Cloud account. !!!")

    provider = IBMQuantumProvider(
        api_key=api_key,
        crn=crn,
        base_url=os.environ.get("IBM_QUANTUM_API_BASE_URL", "https://quantum.cloud.ibm.com/api"),
        api_version=os.environ.get("IBM_QUANTUM_API_VERSION", "2025-01-01"),
        iam_url=os.environ.get("IBM_QUANTUM_IAM_URL", "https://iam.cloud.ibm.com/identity/token"),
    )

    try:
        health = await provider.health_check()
        print(f"health_check: reachable={health.reachable} detail={health.detail}")
        if not health.reachable:
            sys.exit(1)

        backends = await provider.list_backends()
        operational = [b for b in backends if b.status == "online"]
        if not operational:
            print("No operational backends found on this account.")
            sys.exit(1)
        backend = min(operational, key=lambda b: b.queue_length)
        print(f"submitting to backend={backend.name} (queue_length={backend.queue_length})")

        handle = await provider.submit_job(
            program_id="sampler",
            backend=backend.name,
            params={"pubs": []},  # minimal placeholder - adjust to a real circuit before use
            tags=["qbads-live-smoke-test"],
        )
        print(f"submitted job id={handle.id}")

        deadline = time.time() + POLL_TIMEOUT_SECONDS
        while time.time() < deadline:
            status = await provider.get_job_status(handle.id)
            print(f"status={status.status} reason={status.reason}")
            if status.status in ("Completed", "Failed", "Cancelled", "Cancelled - Ran too long"):
                break
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

        result = await provider.get_job_result(handle.id)
        print(f"result ready={result.ready} payload={result.payload}")
    finally:
        await provider.aclose()


if __name__ == "__main__":
    asyncio.run(main())
