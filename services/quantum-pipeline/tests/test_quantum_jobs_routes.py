"""
Exercises the six internal /quantum-jobs* / /quantum-backends routes via
FastAPI's TestClient, with QUANTUM_JOB_PROVIDER=mock (set in conftest.py) so
these run with no IBM account and no qiskit execution.
"""


def test_submit_job_returns_a_handle(client):
    r = client.post("/quantum-jobs", json={"programId": "sampler", "backend": "mock_backend_a", "params": {}})
    assert r.status_code == 201
    body = r.json()
    assert body["id"].startswith("mock-job-")
    assert body["backend"] == "mock_backend_a"


def test_submit_job_rejects_invalid_program_id(client):
    r = client.post("/quantum-jobs", json={"programId": "not-a-real-program", "backend": "x", "params": {}})
    assert r.status_code == 422


def test_get_job_status_for_unknown_job_is_404(client):
    r = client.get("/quantum-jobs/does-not-exist")
    assert r.status_code == 404


def test_get_job_status_for_known_job(client):
    submit = client.post("/quantum-jobs", json={"programId": "estimator", "backend": "mock_backend_b", "params": {}})
    job_id = submit.json()["id"]
    r = client.get(f"/quantum-jobs/{job_id}")
    assert r.status_code == 200
    assert r.json()["status"] in ("Queued", "Running", "Completed")


def test_get_job_result_before_completion_reports_not_ready(client):
    submit = client.post("/quantum-jobs", json={"programId": "sampler", "backend": "mock_backend_a", "params": {}})
    job_id = submit.json()["id"]
    r = client.get(f"/quantum-jobs/{job_id}/result")
    assert r.status_code == 200
    assert r.json()["ready"] is False
    assert r.json()["payload"] is None


def test_cancel_job_before_completion_succeeds(client):
    submit = client.post("/quantum-jobs", json={"programId": "sampler", "backend": "mock_backend_a", "params": {}})
    job_id = submit.json()["id"]
    r = client.post(f"/quantum-jobs/{job_id}/cancel")
    assert r.status_code == 200
    assert r.json()["cancelled"] is True


def test_cancel_unknown_job_is_404(client):
    r = client.post("/quantum-jobs/does-not-exist/cancel")
    assert r.status_code == 404


def test_list_backends(client):
    r = client.get("/quantum-backends")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 3
    assert {"name", "status", "qubits", "queueLength"} <= set(body[0].keys())


def test_provider_health_reports_mock_mode(client):
    r = client.get("/quantum-jobs/health")
    assert r.status_code == 200
    body = r.json()
    assert body["reachable"] is True
    assert body["provider"] == "mock"
