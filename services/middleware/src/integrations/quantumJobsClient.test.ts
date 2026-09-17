import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../config";
import { type FakeQuantumPipeline, jsonHandler, noResponseHandler, startFakeQuantumPipeline } from "../testUtils/fakeQuantumPipeline";
import { QuantumProviderUnavailableError, quantumJobsClient } from "./quantumJobsClient";

let fake: FakeQuantumPipeline;

beforeAll(async () => {
  fake = await startFakeQuantumPipeline();
  config.quantumEngineUrl = fake.url;
  config.quantumJobsTimeoutMs = 300;
  config.quantumJobsMaxRetries = 2;
});

afterAll(async () => {
  await fake.close();
});

describe("quantumJobsClient reads (retryable)", () => {
  it("retries a broken connection up to maxRetries then succeeds", async () => {
    let calls = 0;
    fake.on("GET", "/quantum-backends", (_req, res) => {
      calls += 1;
      if (calls < 3) {
        res.destroy();
        return;
      }
      jsonHandler(200, [{ name: "b1", status: "online", qubits: 5, queueLength: 0, processorType: null }])(_req, res, "");
    });

    const backends = await quantumJobsClient.listBackends();
    expect(backends).toHaveLength(1);
    expect(calls).toBe(3); // 1 initial attempt + 2 retries = maxRetries
  });

  it("throws QuantumProviderUnavailableError once retries are exhausted", async () => {
    fake.on("GET", "/quantum-jobs/health", noResponseHandler());
    await expect(quantumJobsClient.health()).rejects.toBeInstanceOf(QuantumProviderUnavailableError);
  });

  it("maps a successful job-status response", async () => {
    fake.on(
      "GET",
      "/quantum-jobs/prov-1",
      jsonHandler(200, { id: "prov-1", status: "Running", reason: null, queuePosition: null, estimatedRunningTimeSeconds: 12.5 }),
    );
    const status = await quantumJobsClient.getStatus("prov-1");
    expect(status.status).toBe("Running");
    expect(status.estimatedRunningTimeSeconds).toBe(12.5);
  });
});

describe("quantumJobsClient writes (never retried)", () => {
  it("submit is attempted exactly once even when the connection breaks", async () => {
    let calls = 0;
    fake.on("POST", "/quantum-jobs", (_req, res) => {
      calls += 1;
      res.destroy();
    });
    await expect(quantumJobsClient.submit({ programId: "sampler", backend: "ibmq_test", params: {} })).rejects.toBeInstanceOf(
      QuantumProviderUnavailableError,
    );
    expect(calls).toBe(1);
  });

  it("cancel is attempted exactly once even when the connection breaks", async () => {
    let calls = 0;
    fake.on("POST", "/quantum-jobs/prov-2/cancel", (_req, res) => {
      calls += 1;
      res.destroy();
    });
    await expect(quantumJobsClient.cancel("prov-2")).rejects.toBeInstanceOf(QuantumProviderUnavailableError);
    expect(calls).toBe(1);
  });

  it("submit success maps the returned handle", async () => {
    fake.on("POST", "/quantum-jobs", jsonHandler(201, { id: "prov-3", backend: "ibmq_test", sessionId: null }));
    const handle = await quantumJobsClient.submit({ programId: "estimator", backend: "ibmq_test", params: {} });
    expect(handle.id).toBe("prov-3");
  });
});
