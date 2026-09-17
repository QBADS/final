import type { Server } from "node:http";
import { afterAll, beforeAll, it, expect } from "vitest";
import { config } from "../config";
import { type FakeQuantumPipeline, jsonHandler, startFakeQuantumPipeline } from "../testUtils/fakeQuantumPipeline";

/** Its own file/module graph - see quantumJobsApi.rateLimit.test.ts's header comment for why. */

let fake: FakeQuantumPipeline;
let server: Server;
let baseUrl: string;
let execAdminToken: string;

async function submit(idempotencyKey: string) {
  return fetch(`${baseUrl}/api/v1/quantum/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${execAdminToken}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: {} }),
  });
}

beforeAll(async () => {
  fake = await startFakeQuantumPipeline();
  config.quantumEngineUrl = fake.url;
  config.quantumJobsTimeoutMs = 500;
  config.quantumJobsMaxRetries = 0;
  config.quantumJobsRateLimitPerMinute = 1000; // not under test here
  config.quantumJobsMaxConcurrentPerUser = 2;

  const { app } = await import("../server");
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  const res = await fetch(`${baseUrl}/api/dashboard/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "exec-admin", password: "qbads-exec-admin-2026" }),
  });
  execAdminToken = ((await res.json()) as { token: string }).token;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fake.close();
});

it("rejects a new submission once the caller already has maxConcurrentPerUser active jobs", async () => {
  // Jobs stay "queued" for the whole test (nothing polls their status), so
  // they remain counted as active - exactly what should exhaust the guard.
  fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-concurrency-a", backend: "ibmq_test", sessionId: null }));
  const first = await submit("key-concurrency-1");
  expect(first.status).toBe(201);

  fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-concurrency-b", backend: "ibmq_test", sessionId: null }));
  const second = await submit("key-concurrency-2");
  expect(second.status).toBe(201);

  const third = await submit("key-concurrency-3");
  expect(third.status).toBe(429);
  const body = await third.json();
  expect(body.error).toMatch(/too many concurrent/);
});
