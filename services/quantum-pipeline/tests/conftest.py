import os

# Must be set before app.main (and therefore app.providers.factory, which
# builds the job_provider singleton at import time) is ever imported.
os.environ.setdefault("QUANTUM_JOB_PROVIDER", "mock")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    # Session-scoped: entering the lifespan trains all three bootstrap
    # models (registry.train_all()) once for the whole test run, not once
    # per test - matching how this is a one-time startup cost in production too.
    with TestClient(app) as c:
        yield c
