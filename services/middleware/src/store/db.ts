import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Persistent storage for Middleware (README's "Not done here: Persistent
 * storage (everything resets on restart)"). node:sqlite is built into this
 * Node version (v22.22.2 - checked at implementation time, `node -v`) so it
 * needs no new dependency, unlike better-sqlite3. It's still flagged
 * "experimental" by Node itself (a console warning, not a functional
 * limitation) - synchronous API, single file, no server process, exactly
 * matching the scale this service actually runs at.
 *
 * File path defaults to services/middleware/data/middleware.sqlite3,
 * overridable via MIDDLEWARE_DB_PATH (the restart-persistence test in the
 * README/validation flow points sqlite3 directly at this file). Use
 * MIDDLEWARE_DB_PATH=:memory: for ephemeral test runs.
 */
const DEFAULT_DB_PATH = join(__dirname, "..", "..", "data", "middleware.sqlite3");
export const DB_PATH = process.env.MIDDLEWARE_DB_PATH ?? DEFAULT_DB_PATH;

if (DB_PATH !== ":memory:") {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
-- apiKeyHash is UNIQUE (not apiKey - the plaintext is never stored, see
-- onboarding/apiKeys.ts) so a hash collision can't silently alias two
-- institutions. Nullable: no key exists until an application is approved.
CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  apiKeyHash TEXT UNIQUE,
  apiKeyPreview TEXT,
  status TEXT NOT NULL,
  onboardingStatus TEXT NOT NULL,
  connectedSince TEXT NOT NULL,
  kind TEXT NOT NULL,
  region TEXT NOT NULL,
  fabricOrgId TEXT NOT NULL,
  contactName TEXT NOT NULL,
  contactEmail TEXT NOT NULL,
  appliedAt TEXT NOT NULL,
  approvedAt TEXT,
  approvedBy TEXT,
  rejectionReason TEXT
);
CREATE INDEX IF NOT EXISTS idx_institutions_apiKeyHash ON institutions(apiKeyHash);
CREATE INDEX IF NOT EXISTS idx_institutions_onboardingStatus ON institutions(onboardingStatus);

CREATE TABLE IF NOT EXISTS transactions (
  txId TEXT PRIMARY KEY,
  institutionId TEXT NOT NULL,
  submittedAt TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  chainConfirmed INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_institution ON transactions(institutionId);
CREATE INDEX IF NOT EXISTS idx_transactions_submittedAt ON transactions(submittedAt);

CREATE TABLE IF NOT EXISTS decisions (
  txId TEXT PRIMARY KEY,
  institutionId TEXT NOT NULL,
  riskScore REAL NOT NULL,
  riskLevel TEXT NOT NULL,
  decision TEXT NOT NULL,
  confidence REAL NOT NULL,
  modelVersion TEXT NOT NULL,
  source TEXT NOT NULL,
  decidedAt TEXT NOT NULL,
  pipelineLatencyMs REAL NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  txId TEXT NOT NULL,
  institutionId TEXT NOT NULL,
  institutionVerdict TEXT NOT NULL,
  note TEXT,
  submittedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS live_feed (
  id TEXT PRIMARY KEY,
  transactionId TEXT NOT NULL,
  institutionName TEXT NOT NULL,
  chainStatus TEXT NOT NULL,
  riskLevel TEXT NOT NULL,
  riskScore REAL NOT NULL,
  occurredAt TEXT NOT NULL,
  rowOrder INTEGER
);

CREATE TABLE IF NOT EXISTS auth_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  keyPrefix TEXT,
  path TEXT NOT NULL,
  occurredAt TEXT NOT NULL,
  rowOrder INTEGER
);

CREATE TABLE IF NOT EXISTS pipeline_warnings (
  id TEXT PRIMARY KEY,
  txId TEXT NOT NULL,
  institutionId TEXT NOT NULL,
  warnings TEXT NOT NULL,
  occurredAt TEXT NOT NULL,
  rowOrder INTEGER
);

-- Dashboard session-token revocation list (logout). Tokens are otherwise
-- stateless JWTs; this is the one piece of session state that must survive
-- a restart so a logged-out token can't be replayed after Middleware
-- bounces. Rows are pruned once their token would have expired anyway.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  revokedAt TEXT NOT NULL
);

-- IBM Quantum job management (exec-admin only, routes/quantumJobsApi.ts).
-- idempotencyKey is UNIQUE so a concurrent duplicate POST /jobs with the
-- same client-supplied key fails on insert rather than double-submitting to
-- quantum-pipeline - see quantumJobsApi.ts's idempotency flow.
CREATE TABLE IF NOT EXISTS quantum_jobs (
  id TEXT PRIMARY KEY,
  providerJobId TEXT,
  submittedByUsername TEXT NOT NULL,
  backend TEXT NOT NULL,
  programId TEXT NOT NULL,
  tags TEXT NOT NULL,
  status TEXT NOT NULL,
  statusReason TEXT,
  submittedAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  completedAt TEXT,
  idempotencyKey TEXT NOT NULL UNIQUE,
  resultPayload TEXT,
  chainRecorded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quantum_jobs_status ON quantum_jobs(status);
CREATE INDEX IF NOT EXISTS idx_quantum_jobs_submittedBy ON quantum_jobs(submittedByUsername);
`);
