import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuantumJob } from "../domainTypes";

function makeJob(overrides: Partial<QuantumJob> = {}): QuantumJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    providerJobId: null,
    submittedByUsername: "exec-admin",
    backend: "ibmq_test",
    programId: "sampler",
    tags: [],
    status: "submitted",
    statusReason: null,
    submittedAt: now,
    updatedAt: now,
    completedAt: null,
    idempotencyKey: "idem-1",
    resultPayload: null,
    chainRecorded: false,
    ...overrides,
  };
}

describe("PersistentStore quantum job CRUD (in-memory db, from vitest.setup.ts)", () => {
  it("adds a job and finds it by idempotency key", async () => {
    const { store } = await import("./inMemoryStore");
    store.addQuantumJob(makeJob({ id: "job-a", idempotencyKey: "idem-a" }));
    const found = store.findQuantumJobByIdempotencyKey("idem-a");
    expect(found?.id).toBe("job-a");
    expect(store.quantumJobs.get("job-a")?.status).toBe("submitted");
  });

  it("updates status/providerJobId/completedAt via updateQuantumJob", async () => {
    const { store } = await import("./inMemoryStore");
    store.addQuantumJob(makeJob({ id: "job-b", idempotencyKey: "idem-b" }));
    const updated = store.updateQuantumJob("job-b", { providerJobId: "prov-b", status: "queued" });
    expect(updated?.providerJobId).toBe("prov-b");
    expect(updated?.status).toBe("queued");
    expect(store.quantumJobs.get("job-b")?.status).toBe("queued");
  });

  it("setQuantumJobChainRecorded flips chainRecorded to true", async () => {
    const { store } = await import("./inMemoryStore");
    store.addQuantumJob(makeJob({ id: "job-c", idempotencyKey: "idem-c" }));
    store.setQuantumJobChainRecorded("job-c");
    expect(store.quantumJobs.get("job-c")?.chainRecorded).toBe(true);
  });

  it("quantumJobsBySubmitter filters by submittedByUsername", async () => {
    const { store } = await import("./inMemoryStore");
    store.addQuantumJob(makeJob({ id: "job-d1", idempotencyKey: "idem-d1", submittedByUsername: "exec-admin" }));
    store.addQuantumJob(makeJob({ id: "job-d2", idempotencyKey: "idem-d2", submittedByUsername: "someone-else" }));
    const mine = store.quantumJobsBySubmitter("exec-admin");
    expect(mine.map((j) => j.id)).toContain("job-d1");
    expect(mine.map((j) => j.id)).not.toContain("job-d2");
  });
});

describe("quantum job restart-recovery (real file-backed db)", () => {
  let dbDir: string;
  const originalDbPath = process.env.MIDDLEWARE_DB_PATH;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "qbads-quantum-jobs-"));
    process.env.MIDDLEWARE_DB_PATH = join(dbDir, "test.sqlite3");
  });

  afterEach(() => {
    process.env.MIDDLEWARE_DB_PATH = originalDbPath;
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("reloads a persisted job after a fresh PersistentStore instantiation, as if the process restarted", async () => {
    vi.resetModules();
    const { store: beforeRestart } = await import("./inMemoryStore");
    const { db: dbBeforeRestart } = await import("./db");
    beforeRestart.addQuantumJob(makeJob({ id: "job-restart", idempotencyKey: "idem-restart", status: "queued", providerJobId: "prov-restart" }));
    dbBeforeRestart.close(); // release the Windows file lock before reopening below

    vi.resetModules();
    const { store: afterRestart } = await import("./inMemoryStore");
    const { db: dbAfterRestart } = await import("./db");
    const reloaded = afterRestart.quantumJobs.get("job-restart");
    expect(reloaded).toBeDefined();
    expect(reloaded?.providerJobId).toBe("prov-restart");
    expect(reloaded?.status).toBe("queued");
    expect(afterRestart.findQuantumJobByIdempotencyKey("idem-restart")?.id).toBe("job-restart");
    dbAfterRestart.close(); // release the lock so afterEach's rmSync can delete the temp dir
  });
});
