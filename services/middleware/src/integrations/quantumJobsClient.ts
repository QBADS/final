import { config } from "../config";

/**
 * Client for quantum-pipeline's internal /quantum-jobs* endpoints (the
 * QuantumProvider-backed job-management API - see
 * services/quantum-pipeline/app/providers/). Combines
 * platformHealthClient.ts's/blockchainClient.ts's "safe outbound client"
 * shape with pipeline/quantumOrchestrationClient.ts's retry-loop.
 *
 * Reads (listBackends/getStatus/getResult/health) retry up to
 * config.quantumJobsMaxRetries, matching the existing inference client's
 * pattern. Writes (submit/cancel) are NEVER retried here - a timeout means
 * "unknown whether quantum-pipeline (and in turn IBM) received it", and
 * retry safety for submission is handled entirely by routes/quantumJobsApi.ts's
 * DB-backed idempotency-key flow, not by this client.
 *
 * Invariant: this file never reads an IBM_* env var and never will - the
 * IBM API key/CRN live only in quantum-pipeline's own process, one network
 * hop away. This client only ever talks to quantum-pipeline's existing
 * internal, unauthenticated-by-design boundary (same trust model as
 * pipeline/quantumOrchestrationClient.ts's calls to /infer).
 */

export class QuantumProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuantumProviderUnavailableError";
  }
}

export interface QuantumJobSubmitPayload {
  programId: "sampler" | "estimator";
  backend: string;
  params: Record<string, unknown>;
  tags?: string[];
  costSeconds?: number;
}

export interface QuantumJobHandle {
  id: string;
  backend: string;
  sessionId: string | null;
}

export interface QuantumJobStatusPayload {
  id: string;
  status: string;
  reason: string | null;
  queuePosition: number | null;
  estimatedRunningTimeSeconds: number | null;
}

export interface QuantumJobResultPayload {
  id: string;
  ready: boolean;
  payload: Record<string, unknown> | null;
}

export interface QuantumBackendPayload {
  name: string;
  status: "online" | "paused" | "offline";
  qubits: number;
  queueLength: number;
  processorType: string | null;
}

export interface QuantumJobProviderHealth {
  reachable: boolean;
  detail: string | null;
  provider: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`quantum-pipeline request timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

interface RequestOptions {
  timeoutMs: number;
  maxRetries: number;
  retryable: boolean;
}

async function requestJson<T>(path: string, init: RequestInit, opts: RequestOptions): Promise<T> {
  let lastError: unknown;
  const attempts = opts.retryable ? opts.maxRetries + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await withTimeout(
        fetch(`${config.quantumEngineUrl}${path}`, {
          headers: { "content-type": "application/json" },
          ...init,
        }),
        opts.timeoutMs,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`quantum-pipeline ${path} responded ${res.status}: ${body}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw new QuantumProviderUnavailableError(
    lastError instanceof Error ? lastError.message : `quantum-pipeline ${path} failed`,
  );
}

export const quantumJobsClient = {
  // Reads: safe to retry (idempotent GETs against quantum-pipeline).
  listBackends: () =>
    requestJson<QuantumBackendPayload[]>(
      "/quantum-backends",
      { method: "GET" },
      { timeoutMs: config.quantumJobsTimeoutMs, maxRetries: config.quantumJobsMaxRetries, retryable: true },
    ),
  getStatus: (providerJobId: string) =>
    requestJson<QuantumJobStatusPayload>(
      `/quantum-jobs/${encodeURIComponent(providerJobId)}`,
      { method: "GET" },
      { timeoutMs: config.quantumJobsTimeoutMs, maxRetries: config.quantumJobsMaxRetries, retryable: true },
    ),
  getResult: (providerJobId: string) =>
    requestJson<QuantumJobResultPayload>(
      `/quantum-jobs/${encodeURIComponent(providerJobId)}/result`,
      { method: "GET" },
      { timeoutMs: config.quantumJobsTimeoutMs, maxRetries: config.quantumJobsMaxRetries, retryable: true },
    ),
  health: () =>
    requestJson<QuantumJobProviderHealth>(
      "/quantum-jobs/health",
      { method: "GET" },
      { timeoutMs: config.quantumJobsTimeoutMs, maxRetries: config.quantumJobsMaxRetries, retryable: true },
    ),

  // Writes: NEVER retried here - see module docstring. routes/quantumJobsApi.ts
  // is what makes retrying a submission safe (or not) via its idempotency key.
  submit: (payload: QuantumJobSubmitPayload) =>
    requestJson<QuantumJobHandle>(
      "/quantum-jobs",
      { method: "POST", body: JSON.stringify(payload) },
      { timeoutMs: config.quantumJobsTimeoutMs, maxRetries: 0, retryable: false },
    ),
  cancel: (providerJobId: string) =>
    requestJson<{ cancelled: boolean }>(
      `/quantum-jobs/${encodeURIComponent(providerJobId)}/cancel`,
      { method: "POST" },
      { timeoutMs: config.quantumJobsTimeoutMs, maxRetries: 0, retryable: false },
    ),
};
