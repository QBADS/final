/**
 * IBM Quantum job-management feature (exec-admin dashboard capability):
 * submit/monitor/cancel a real IBM Quantum job, browse backends. Deliberately
 * separate from the existing per-transaction quantum fraud-scoring path
 * (ModelPerformance in platform.ts) - see services/middleware's
 * quantumJobsApi.ts for why.
 *
 * Field names are kept byte-identical to services/middleware/src/domainTypes.ts's
 * hand-mirrored copy, same "no cross-package import from a backend service"
 * precedent as fraud.ts/institution.ts already establish there.
 */

export type QuantumJobStatus =
  | "submitted" // accepted by middleware, not yet confirmed by quantum-pipeline
  | "queued" // confirmed submitted to the provider, waiting
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type QuantumProgramId = "sampler" | "estimator";

export interface QuantumJob {
  /** Middleware-issued UUID (primary key) - distinct from the provider's own job id. */
  id: string;
  /** The id returned by quantum-pipeline/IBM - null until submission is confirmed. */
  providerJobId: string | null;
  /** exec-admin's dashboard username, for audit. */
  submittedByUsername: string;
  backend: string;
  programId: QuantumProgramId;
  tags: string[];
  status: QuantumJobStatus;
  statusReason: string | null;
  submittedAt: string; // ISO
  updatedAt: string; // ISO
  completedAt: string | null;
  resultAvailable: boolean;
  /** Best-effort blockchain audit write succeeded (see services/blockchain's RecordQuantumJobAudit). */
  chainRecorded: boolean;
}

export type QuantumBackendStatus = "online" | "paused" | "offline";

export interface QuantumBackend {
  name: string;
  status: QuantumBackendStatus;
  qubits: number;
  queueLength: number;
  processorType: string | null;
}
