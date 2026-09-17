import type { Server } from "node:http";
import { afterAll, beforeAll, it, expect } from "vitest";
import { config } from "../config";
import { type FakeQuantumPipeline, jsonHandler, startFakeQuantumPipeline } from "../testUtils/fakeQuantumPipeline";

/**
 * Its own file/module graph (fresh `app` import, fresh rateLimiter()
 * closure) so this test's tight rate limit never affects, or is affected
 * by, quantumJobsApi.test.ts's larger functional-test call volume, or
 * quantumJobsApi.concurrency.test.ts's own dedicated limit.
 */

let fake: FakeQuantumPipeline;
let server: Server;
let baseUrl: string;
let execAdminToken: string;

beforeAll(async () => {
  fake = await startFakeQuantumPipeline();
  config.quantumEngineUrl = fake.url;
  config.quantumJobsTimeoutMs = 500;
  config.quantumJobsMaxRetries = 0;
  config.quantumJobsRateLimitPerMinute = 3;
  config.quantumJobsMaxConcurrentPerUser = 1000; // not under test here

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

  fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-rate-limit", backend: "ibmq_test", sessionId: null }));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fake.close();
});

it("allows exactly quantumJobsRateLimitPerMinute submissions, then 429s", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < config.quantumJobsRateLimitPerMinute + 1; i++) {
    const res = await fetch(`${baseUrl}/api/v1/quantum/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${execAdminToken}`, "content-type": "application/json", "idempotency-key": `key-rate-${i}` },
      body: JSON.stringify({ programId: "sampler", backend: "ibmq_test", params: {} }),
    });
    statuses.push(res.status);
  }

  expect(statuses.filter((s) => s === 201)).toHaveLength(config.quantumJobsRateLimitPerMinute);
  expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  expect(statuses.at(-1)).toBe(429);
});
