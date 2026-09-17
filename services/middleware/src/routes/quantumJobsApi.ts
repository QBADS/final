import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config } from "../config";
import { recordQuantumJobAuditOnChain } from "../integrations/blockchainClient";
import { quantumJobsClient } from "../integrations/quantumJobsClient";
import { rateLimiter } from "../middleware/rateLimiter";
import { store } from "../store/inMemoryStore";
import type { QuantumJob, QuantumJobStatus, QuantumProgramId } from "../domainTypes";

/**
 * Public, versioned IBM Quantum job-management API - the first /api/v1
 * prefix in this repo, added deliberately for this feature (see the
 * implementation plan for why: this service owns auth/ownership/DB/rate
 * limiting; services/quantum-pipeline owns the actual QuantumProvider
 * abstraction and real IBM REST calls, one hop away).
 *
 * Mounted in server.ts as:
 *   app.use("/api/v1/quantum", requireDashboardSession, requireExecAdmin, quantumJobsRouter)
 * - exec-admin only (auth/dashboardAuth.ts's requireExecAdmin), matching
 * today's QuantumComputing.tsx page's own internal-exec scope.
 */
export const quantumJobsRouter = Router();

const ACTIVE_STATUSES: QuantumJobStatus[] = ["submitted", "queued", "running"];
const TERMINAL_STATUSES: QuantumJobStatus[] = ["completed", "failed", "cancelled"];
const MAX_TAGS = 8;

function providerStatusToJobStatus(providerStatus: string): QuantumJobStatus | null {
  switch (providerStatus) {
    case "Queued":
      return "queued";
    case "Running":
      return "running";
    case "Completed":
      return "completed";
    case "Cancelled":
    case "Cancelled - Ran too long":
      return "cancelled";
    case "Failed":
      return "failed";
    default:
      return null; // unrecognized - leave the cached status alone rather than guess
  }
}

/** Fire-and-forget, never awaited in the response path - see blockchainClient.ts. */
function recordAuditIfNewlyTerminal(job: QuantumJob): void {
  if (!job.chainRecorded && TERMINAL_STATUSES.includes(job.status)) {
    void recordQuantumJobAuditOnChain(job).then((ok) => {
      if (ok) store.setQuantumJobChainRecorded(job.id);
    });
  }
}

function serializeJob(job: QuantumJob, requestId: string) {
  return {
    id: job.id,
    providerJobId: job.providerJobId,
    backend: job.backend,
    programId: job.programId,
    tags: job.tags,
    status: job.status,
    statusReason: job.statusReason,
    submittedAt: job.submittedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    resultAvailable: job.resultPayload !== null,
    chainRecorded: job.chainRecorded,
    requestId,
  };
}

interface ValidatedSubmitBody {
  programId: QuantumProgramId;
  backend: string;
  params: Record<string, unknown>;
  tags: string[];
  costSeconds?: number;
}

function validateSubmitBody(body: unknown): { ok: true; value: ValidatedSubmitBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "body must be an object" };
  const { programId, backend, params, tags, costSeconds } = body as Record<string, unknown>;

  if (programId !== "sampler" && programId !== "estimator") {
    return { ok: false, error: 'programId must be "sampler" or "estimator"' };
  }
  if (typeof backend !== "string" || !backend.trim()) {
    return { ok: false, error: "backend must be a non-empty string" };
  }
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return { ok: false, error: "params must be an object" };
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > MAX_TAGS || tags.some((t) => typeof t !== "string"))) {
    return { ok: false, error: `tags must be a string[] of at most ${MAX_TAGS} entries` };
  }
  if (costSeconds !== undefined && (typeof costSeconds !== "number" || costSeconds < 0 || costSeconds > 10_800)) {
    return { ok: false, error: "costSeconds must be a number between 0 and 10800" };
  }

  return {
    ok: true,
    value: {
      programId,
      backend,
      params: params as Record<string, unknown>,
      tags: (tags as string[] | undefined) ?? [],
      costSeconds: costSeconds as number | undefined,
    },
  };
}

/**
 * Idempotency (see the implementation plan's §2.6): required client-supplied
 * Idempotency-Key header, chosen over server-derived content-hash dedupe
 * because two intentionally identical circuit submissions are legitimate in
 * this domain, not duplicates.
 */
quantumJobsRouter.post(
  "/jobs",
  rateLimiter({
    windowMs: 60_000,
    maxRequests: config.quantumJobsRateLimitPerMinute,
    keyFn: (req) => req.dashboardSession!.username,
    message: "quantum job submission rate limit exceeded, try again shortly",
  }),
  async (req, res, next) => {
    try {
      const session = req.dashboardSession!;
      const idempotencyKey = req.header("idempotency-key");
      if (!idempotencyKey) {
        res.status(400).json({ error: "Idempotency-Key header is required", requestId: req.requestId });
        return;
      }

      const existing = store.findQuantumJobByIdempotencyKey(idempotencyKey);
      if (existing) {
        res.status(200).set("X-Idempotent-Replay", "true").json(serializeJob(existing, req.requestId));
        return;
      }

      const activeCount = store.quantumJobsBySubmitter(session.username).filter((j) => ACTIVE_STATUSES.includes(j.status)).length;
      if (activeCount >= config.quantumJobsMaxConcurrentPerUser) {
        res.status(429).json({
          error: `too many concurrent quantum jobs (max ${config.quantumJobsMaxConcurrentPerUser}) - wait for one to finish`,
          requestId: req.requestId,
        });
        return;
      }

      const validated = validateSubmitBody(req.body);
      if (!validated.ok) {
        res.status(422).json({ error: validated.error, requestId: req.requestId });
        return;
      }

      const now = new Date().toISOString();
      const job: QuantumJob = {
        id: randomUUID(),
        providerJobId: null,
        submittedByUsername: session.username,
        backend: validated.value.backend,
        programId: validated.value.programId,
        tags: validated.value.tags,
        status: "submitted",
        statusReason: null,
        submittedAt: now,
        updatedAt: now,
        completedAt: null,
        idempotencyKey,
        resultPayload: null,
        chainRecorded: false,
      };

      try {
        // Insert BEFORE calling quantum-pipeline: a crash mid-flight still
        // leaves a durable idempotency-key record. The UNIQUE constraint on
        // idempotencyKey is the race-safety backstop for concurrent
        // identical requests (caught below).
        store.addQuantumJob(job);
      } catch {
        const raced = store.findQuantumJobByIdempotencyKey(idempotencyKey);
        if (raced) {
          res.status(200).set("X-Idempotent-Replay", "true").json(serializeJob(raced, req.requestId));
          return;
        }
        throw new Error(`failed to persist quantum job ${job.id}`);
      }

      try {
        const handle = await quantumJobsClient.submit({
          programId: validated.value.programId,
          backend: validated.value.backend,
          params: validated.value.params,
          tags: validated.value.tags.length ? validated.value.tags : undefined,
          costSeconds: validated.value.costSeconds,
        });
        const updated = store.updateQuantumJob(job.id, { providerJobId: handle.id, status: "queued" })!;
        res.status(201).json(serializeJob(updated, req.requestId));
      } catch (err) {
        // Ambiguous outcome (timeout/5xx) - never auto-retried. Marking the
        // job terminal-failed means retrying requires a deliberately NEW
        // Idempotency-Key, not resubmission of this one - see module docstring.
        const updated = store.updateQuantumJob(job.id, {
          status: "failed",
          statusReason: "submission failed or timed out - unknown provider-side outcome",
        })!;
        res.status(502).json({
          error: (err as Error).message,
          job: serializeJob(updated, req.requestId),
          requestId: req.requestId,
        });
      }
    } catch (err) {
      next(err);
    }
  },
);

quantumJobsRouter.get("/jobs/:id", async (req, res, next) => {
  try {
    const job = store.quantumJobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "quantum job not found", requestId: req.requestId });
      return;
    }

    if (job.providerJobId && ACTIVE_STATUSES.includes(job.status)) {
      try {
        const statusPayload = await quantumJobsClient.getStatus(job.providerJobId);
        const mapped = providerStatusToJobStatus(statusPayload.status);
        if (mapped && mapped !== job.status) {
          const updated = store.updateQuantumJob(job.id, {
            status: mapped,
            statusReason: statusPayload.reason ?? null,
            completedAt: TERMINAL_STATUSES.includes(mapped) ? new Date().toISOString() : null,
          })!;
          recordAuditIfNewlyTerminal(updated);
          res.json(serializeJob(updated, req.requestId));
          return;
        }
      } catch (err) {
        // Best-effort refresh - a downed quantum-pipeline shouldn't break
        // reading a job's last-known cached status.
        console.warn(`[quantumJobsApi] status refresh for ${job.id} failed: ${(err as Error).message}`);
      }
    }

    res.json(serializeJob(job, req.requestId));
  } catch (err) {
    next(err);
  }
});

quantumJobsRouter.get("/jobs/:id/result", async (req, res, next) => {
  try {
    const job = store.quantumJobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "quantum job not found", requestId: req.requestId });
      return;
    }
    if (job.resultPayload !== null) {
      res.json({ id: job.id, ready: true, payload: job.resultPayload, requestId: req.requestId });
      return;
    }
    if (!job.providerJobId) {
      res.json({ id: job.id, ready: false, payload: null, requestId: req.requestId });
      return;
    }
    const result = await quantumJobsClient.getResult(job.providerJobId);
    if (result.ready && result.payload) {
      store.updateQuantumJob(job.id, { resultPayload: result.payload });
    }
    res.json({ ...result, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

quantumJobsRouter.post("/jobs/:id/cancel", async (req, res, next) => {
  try {
    const job = store.quantumJobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "quantum job not found", requestId: req.requestId });
      return;
    }
    if (TERMINAL_STATUSES.includes(job.status)) {
      res.json({ cancelled: false, job: serializeJob(job, req.requestId), requestId: req.requestId });
      return;
    }
    if (!job.providerJobId) {
      res.status(409).json({ error: "job was never confirmed by the provider - nothing to cancel", requestId: req.requestId });
      return;
    }

    const result = await quantumJobsClient.cancel(job.providerJobId);
    if (result.cancelled) {
      const updated = store.updateQuantumJob(job.id, { status: "cancelled", completedAt: new Date().toISOString() })!;
      recordAuditIfNewlyTerminal(updated);
      res.json({ cancelled: true, job: serializeJob(updated, req.requestId), requestId: req.requestId });
      return;
    }
    res.json({ cancelled: false, job: serializeJob(job, req.requestId), requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

quantumJobsRouter.get("/backends", async (req, res, next) => {
  try {
    const backends = await quantumJobsClient.listBackends();
    res.json({ backends, requestId: req.requestId });
  } catch (err) {
    next(err);
  }
});

/** Never throws - same honesty pattern as integrations/platformHealthClient.ts. */
quantumJobsRouter.get("/health", async (req, res) => {
  try {
    const health = await quantumJobsClient.health();
    res.json({ ...health, requestId: req.requestId });
  } catch (err) {
    res.json({ reachable: false, detail: (err as Error).message, provider: "unknown", requestId: req.requestId });
  }
});
