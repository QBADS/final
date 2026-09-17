import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../config";
import { type FakeQuantumPipeline, jsonHandler, noResponseHandler, startFakeQuantumPipeline } from "../testUtils/fakeQuantumPipeline";

let fake: FakeQuantumPipeline;
let server: Server;
let baseUrl: string;
let execAdminToken: string;
let institutionToken: string;

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/dashboard/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json()) as { token: string };
  return body.token;
}

function authed(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  fake = await startFakeQuantumPipeline();
  config.quantumEngineUrl = fake.url;
  config.quantumJobsTimeoutMs = 500;
  config.quantumJobsMaxRetries = 1;
  // Generous on purpose: rate limiting / concurrency guard have their own
  // dedicated, isolated test file (quantumJobsApi.limits.test.ts) with tight
  // limits - this file exercises everything else and must not trip them.
  config.quantumJobsRateLimitPerMinute = 1000;
  config.quantumJobsMaxConcurrentPerUser = 1000;

  const { app } = await import("../server");
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  execAdminToken = await login("exec-admin", "qbads-exec-admin-2026");
  institutionToken = await login("novafintech", "qbads-novafintech-2026");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fake.close();
});

describe("auth / ownership", () => {
  it("rejects a request with no bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/quantum/backends`);
    expect(res.status).toBe(401);
  });

  it("rejects the institution role with 403", async () => {
    const res = await fetch(`${baseUrl}/api/v1/quantum/backends`, { headers: authed(institutionToken) });
    expect(res.status).toBe(403);
  });

  it("allows exec-admin", async () => {
    fake.on("GET", "/quantum-backends", jsonHandler(200, []));
    const res = await fetch(`${baseUrl}/api/v1/quantum/backends`, { headers: authed(execAdminToken) });
    expect(res.status).toBe(200);
  });
});

describe("job submission", () => {
  it("requires an Idempotency-Key header", async () => {
    const res = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json" },
      body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid body with 422", async () => {
    const res = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-invalid-body" },
      body: JSON.stringify({ programId: "not-real", backend: "ibmq_test", params: {} }),
    });
    expect(res.status).toBe(422);
  });

  it("submits successfully and returns a queued job", async () => {
    fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-success-1", backend: "ibmq_test", sessionId: null }));
    const res = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-success-1" },
      body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: { shots: 100 } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.providerJobId).toBe("prov-success-1");
    expect(body.status).toBe("queued");
  });

  it("replays the same job on a duplicate Idempotency-Key without re-calling quantum-pipeline", async () => {
    let calls = 0;
    fake.on("POST", "/quantum-jobs", (_req, res) => {
      calls += 1;
      jsonHandler(201, { id: "prov-dup-1", backend: "ibmq_test", sessionId: null })(_req, res, "");
    });

    const body = { programId: "sampler", backend: "ibmq_test", params: {} };
    const headers = { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-dup-1" };

    const first = await fetch(`${baseUrl}/api/v1/quantum/jobs`, { method: "POST", headers, body: JSON.stringify(body) });
    const firstJson = await first.json();
    expect(first.status).toBe(201);
    expect(calls).toBe(1);

    const second = await fetch(`${baseUrl}/api/v1/quantum/jobs`, { method: "POST", headers, body: JSON.stringify(body) });
    const secondJson = await second.json();
    expect(second.status).toBe(200);
    expect(second.headers.get("x-idempotent-replay")).toBe("true");
    expect(secondJson.id).toBe(firstJson.id);
    expect(calls).toBe(1); // never called quantum-pipeline a second time
  });

  it("marks the job failed (not retried) when submission never responds, and never re-submits on replay", async () => {
    let calls = 0;
    fake.on("POST", "/quantum-jobs", () => {
      calls += 1;
      // never respond - triggers the client's timeout path
    });

    const body = { programId: "sampler", backend: "ibmq_test", params: {} };
    const headers = { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-timeout-1" };

    const first = await fetch(`${baseUrl}/api/v1/quantum/jobs`, { method: "POST", headers, body: JSON.stringify(body) });
    expect(first.status).toBe(502);
    const firstJson = await first.json();
    expect(firstJson.job.status).toBe("failed");
    expect(calls).toBe(1);

    // Same Idempotency-Key again: must replay the failed record, not attempt
    // a second real submission - this is the concrete "never blindly retry"
    // guarantee at the HTTP boundary.
    const second = await fetch(`${baseUrl}/api/v1/quantum/jobs`, { method: "POST", headers, body: JSON.stringify(body) });
    expect(second.status).toBe(200);
    expect(second.headers.get("x-idempotent-replay")).toBe("true");
    const secondJson = await second.json();
    expect(secondJson.status).toBe("failed");
    expect(calls).toBe(1);
  });
});

describe("status polling, result caching, and cancellation", () => {
  it("returns 404 for an unknown job id", async () => {
    const res = await fetch(`${baseUrl}/api/v1/quantum/jobs/does-not-exist`, { headers: authed(execAdminToken) });
    expect(res.status).toBe(404);
  });

  it("refreshes status from quantum-pipeline and persists the transition", async () => {
    fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-poll-1", backend: "ibmq_test", sessionId: null }));
    const submit = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-poll-1" },
      body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: {} }),
    });
    const jobId = (await submit.json()).id as string;

    fake.on("GET", "/quantum-jobs/prov-poll-1", jsonHandler(200, { id: "prov-poll-1", status: "Running", reason: null, queuePosition: null, estimatedRunningTimeSeconds: null }));
    const running = await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}`, { headers: authed(execAdminToken) });
    expect((await running.json()).status).toBe("running");

    fake.on("GET", "/quantum-jobs/prov-poll-1", jsonHandler(200, { id: "prov-poll-1", status: "Completed", reason: null, queuePosition: null, estimatedRunningTimeSeconds: null }));
    const completed = await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}`, { headers: authed(execAdminToken) });
    const completedBody = await completed.json();
    expect(completedBody.status).toBe("completed");

    // Once terminal, polling again must not call quantum-pipeline's status
    // route anymore (ACTIVE_STATUSES check short-circuits it).
    let statusCallsAfterTerminal = 0;
    fake.on("GET", "/quantum-jobs/prov-poll-1", (_req, res) => {
      statusCallsAfterTerminal += 1;
      jsonHandler(200, { id: "prov-poll-1", status: "Completed", reason: null, queuePosition: null, estimatedRunningTimeSeconds: null })(_req, res, "");
    });
    await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}`, { headers: authed(execAdminToken) });
    expect(statusCallsAfterTerminal).toBe(0);
  });

  it("caches the result once ready so a second read doesn't re-call quantum-pipeline", async () => {
    fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-result-1", backend: "ibmq_test", sessionId: null }));
    const submit = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-result-1" },
      body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: {} }),
    });
    const jobId = (await submit.json()).id as string;

    let resultCalls = 0;
    fake.on("GET", "/quantum-jobs/prov-result-1/result", (_req, res) => {
      resultCalls += 1;
      jsonHandler(200, { id: "prov-result-1", ready: true, payload: { counts: { "0": 512, "1": 512 } } })(_req, res, "");
    });

    const first = await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}/result`, { headers: authed(execAdminToken) });
    expect((await first.json()).ready).toBe(true);
    expect(resultCalls).toBe(1);

    const second = await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}/result`, { headers: authed(execAdminToken) });
    expect((await second.json()).ready).toBe(true);
    expect(resultCalls).toBe(1); // served from the cached resultPayload, not re-fetched
  });

  it("cancels an active job", async () => {
    fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-cancel-1", backend: "ibmq_test", sessionId: null }));
    const submit = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-cancel-1" },
      body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: {} }),
    });
    const jobId = (await submit.json()).id as string;

    fake.on("POST", "/quantum-jobs/prov-cancel-1/cancel", jsonHandler(200, { cancelled: true }));
    const cancel = await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}/cancel`, { method: "POST", headers: authed(execAdminToken) });
    const cancelBody = await cancel.json();
    expect(cancel.status).toBe(200);
    expect(cancelBody.cancelled).toBe(true);
    expect(cancelBody.job.status).toBe("cancelled");
  });

  it("cancelling an already-terminal job is a no-op, not an error", async () => {
    fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-cancel-2", backend: "ibmq_test", sessionId: null }));
    const submit = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json", "idempotency-key": "key-cancel-2" },
      body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: {} }),
    });
    const jobId = (await submit.json()).id as string;

    fake.on("POST", "/quantum-jobs/prov-cancel-2/cancel", jsonHandler(200, { cancelled: true }));
    await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}/cancel`, { method: "POST", headers: authed(execAdminToken) });

    let secondCancelCalls = 0;
    fake.on("POST", "/quantum-jobs/prov-cancel-2/cancel", () => {
      secondCancelCalls += 1;
    });
    const second = await fetch(`${baseUrl}/api/v1/quantum/jobs/${jobId}/cancel`, { method: "POST", headers: authed(execAdminToken) });
    expect(second.status).toBe(200);
    expect((await second.json()).cancelled).toBe(false);
    expect(secondCancelCalls).toBe(0); // already terminal - never calls the provider again
  });
});

describe("health (never throws)", () => {
  it("reports unreachable rather than erroring when quantum-pipeline is down", async () => {
    fake.on("GET", "/quantum-jobs/health", noResponseHandler());
    const res = await fetch(`${baseUrl}/api/v1/quantum/health`, { headers: authed(execAdminToken) });
    expect(res.status).toBe(200);
    expect((await res.json()).reachable).toBe(false);
  });
});
