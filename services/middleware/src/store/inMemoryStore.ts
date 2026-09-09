import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import type {
  AuthEvent,
  FeedbackItem,
  FraudDecisionRecord,
  Institution,
  LiveFeedEvent,
  PipelineWarningEvent,
  StoredTransaction,
} from "../domainTypes";

/**
 * Middleware's persistent store (formerly a pure in-memory stand-in - see
 * README's "Not done here: Persistent storage"). Now backed by SQLite
 * (../store/db.ts, node:sqlite) as a write-through cache: every mutator
 * below writes to the database synchronously *and* updates the in-memory
 * Maps/arrays, and the constructor loads everything back out of the
 * database on startup. Every other file in this codebase still reads
 * through the same synchronous Map-like surface (`store.transactions.get`,
 * `.values()`, `.size`, etc.) it always has - this file is the only thing
 * that changed to make the platform survive a restart; no call site
 * elsewhere had to change shape.
 *
 * What's persisted: institutions, transactions, decisions, feedback,
 * auth-failure events, and pipeline warnings - i.e. everything the
 * Dashboard API's KPIs/fraud-stats/security/etc. are computed from, and
 * everything a fintech would expect to still be there after an ops
 * restart. What's *not* persisted, deliberately: the PCA rolling sample
 * buffer (pipeline/pcaReducer.ts - legitimate transient warm-up state for
 * the dimensionality-reduction model, not a record of anything that
 * happened) and live SSE subscriber connections (`events` EventEmitter,
 * per-request `res` objects) - both are runtime process state that
 * correctly resets on restart, not data.
 */
class PersistentStore {
  readonly institutions = new Map<string, Institution>();
  private readonly apiKeyIndex = new Map<string, string>(); // apiKey -> institutionId
  readonly transactions = new Map<string, StoredTransaction>();
  readonly decisions = new Map<string, FraudDecisionRecord>();
  readonly feedback: FeedbackItem[] = [];
  readonly liveFeed: LiveFeedEvent[] = [];
  readonly authEvents: AuthEvent[] = [];
  readonly pipelineWarnings: PipelineWarningEvent[] = [];
  readonly events = new EventEmitter();

  constructor() {
    this.loadInstitutions();
    this.loadTransactions();
    this.loadDecisions();
    this.loadFeedback();
    this.loadLiveFeed();
    this.loadAuthEvents();
    this.loadPipelineWarnings();
  }

  // ---- startup load (+ first-run seed) ----

  private loadInstitutions() {
    const rows = db.prepare("SELECT * FROM institutions").all() as unknown as Array<{
      id: string; name: string; apiKey: string; status: Institution["status"];
      connectedSince: string; kind: Institution["kind"]; region: string; fabricOrgId: string;
    }>;
    if (rows.length === 0) {
      this.seedInstitutions();
      return;
    }
    for (const r of rows) {
      const inst: Institution = { id: r.id, name: r.name, apiKey: r.apiKey, status: r.status, connectedSince: r.connectedSince, kind: r.kind, region: r.region, fabricOrgId: r.fabricOrgId };
      this.institutions.set(inst.id, inst);
      this.apiKeyIndex.set(inst.apiKey, inst.id);
    }
  }

  // Same sandbox roster the in-memory version always seeded (README:
  // "Sandbox API keys (seeded in store/inMemoryStore.ts, one per
  // institution)") - only runs the first time the DB file is created, so
  // both dashboards' fixed-institution assumptions (inst-2 / Nova Fintech)
  // keep working unchanged.
  private seedInstitutions() {
    const seed: Array<Omit<Institution, "connectedSince">> = [
      { id: "inst-1", name: "First Meridian Bank", apiKey: "qbads_sandbox_banka", status: "healthy", kind: "bank", region: "US", fabricOrgId: "org-a" },
      { id: "inst-2", name: "Nova Fintech", apiKey: "qbads_sandbox_novafintech", status: "healthy", kind: "fintech", region: "SG", fabricOrgId: "org-c" },
      { id: "inst-3", name: "VaultPay Wallet", apiKey: "qbads_sandbox_vaultpay", status: "degraded", kind: "digital_wallet", region: "EU", fabricOrgId: "org-c" },
      { id: "inst-4", name: "Orbit Insurance", apiKey: "qbads_sandbox_orbit", status: "healthy", kind: "insurance", region: "UK", fabricOrgId: "org-c" },
      { id: "inst-5", name: "Zenith Mobile Money", apiKey: "qbads_sandbox_zenith", status: "offline", kind: "mobile_money", region: "KE", fabricOrgId: "org-c" },
      { id: "inst-6", name: "Atlas Exchange", apiKey: "qbads_sandbox_atlas", status: "healthy", kind: "crypto_exchange", region: "US", fabricOrgId: "org-b" },
      { id: "inst-7", name: "Helios Gateway", apiKey: "qbads_sandbox_helios", status: "healthy", kind: "payment_processor", region: "US", fabricOrgId: "org-b" },
    ];
    const insert = db.prepare(
      "INSERT INTO institutions (id, name, apiKey, status, connectedSince, kind, region, fabricOrgId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const inst of seed) {
      const full: Institution = { ...inst, connectedSince: new Date().toISOString() };
      insert.run(full.id, full.name, full.apiKey, full.status, full.connectedSince, full.kind, full.region, full.fabricOrgId);
      this.institutions.set(full.id, full);
      this.apiKeyIndex.set(full.apiKey, full.id);
    }
  }

  private loadTransactions() {
    const rows = db.prepare("SELECT data FROM transactions").all() as unknown as Array<{ data: string }>;
    for (const r of rows) {
      const tx = JSON.parse(r.data) as StoredTransaction;
      this.transactions.set(tx.txId, tx);
    }
  }

  private loadDecisions() {
    const rows = db.prepare("SELECT data FROM decisions").all() as unknown as Array<{ data: string }>;
    for (const r of rows) {
      const decision = JSON.parse(r.data) as FraudDecisionRecord;
      this.decisions.set(decision.txId, decision);
    }
  }

  private loadFeedback() {
    const rows = db.prepare("SELECT id, txId, institutionId, institutionVerdict, note, submittedAt FROM feedback ORDER BY rowid ASC").all() as unknown as FeedbackItem[];
    for (const r of rows) this.feedback.push({ ...r, note: r.note ?? undefined });
  }

  private loadLiveFeed() {
    const rows = db.prepare("SELECT id, transactionId, institutionName, chainStatus, riskLevel, riskScore, occurredAt FROM live_feed ORDER BY rowOrder DESC LIMIT 50").all() as unknown as LiveFeedEvent[];
    this.liveFeed.push(...rows);
  }

  private loadAuthEvents() {
    const rows = db.prepare("SELECT id, type, keyPrefix, path, occurredAt FROM auth_events ORDER BY rowOrder DESC LIMIT 50").all() as unknown as AuthEvent[];
    this.authEvents.push(...rows.map((r) => ({ ...r, keyPrefix: r.keyPrefix ?? null })));
  }

  private loadPipelineWarnings() {
    const rows = db.prepare("SELECT id, txId, institutionId, warnings, occurredAt FROM pipeline_warnings ORDER BY rowOrder DESC LIMIT 50").all() as unknown as Array<Omit<PipelineWarningEvent, "warnings"> & { warnings: string }>;
    this.pipelineWarnings.push(...rows.map((r) => ({ ...r, warnings: JSON.parse(r.warnings) as string[] })));
  }

  // ---- reads (unchanged interface) ----

  institutionByApiKey(apiKey: string): Institution | undefined {
    const id = this.apiKeyIndex.get(apiKey);
    return id ? this.institutions.get(id) : undefined;
  }

  decisionsToday(): FraudDecisionRecord[] {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    return [...this.decisions.values()].filter((d) => new Date(d.decidedAt) >= startOfDay);
  }

  // ---- writes (same signatures as the old in-memory store; now also persist) ----

  addTransaction(tx: StoredTransaction) {
    this.transactions.set(tx.txId, tx);
    db.prepare(
      "INSERT OR REPLACE INTO transactions (txId, institutionId, submittedAt, amount, currency, chainConfirmed, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(tx.txId, tx.institutionId, tx.submittedAt, tx.amount, tx.currency, tx.chainConfirmed ? 1 : 0, JSON.stringify(tx));
  }

  // Blockchain write-back (pipeline/transactionIngestion.ts) flips this
  // asynchronously, after addTransaction already returned - a dedicated
  // method (rather than callers mutating the StoredTransaction object
  // directly, which the in-memory Map would have silently tolerated) keeps
  // the database row in sync too.
  markTransactionChainConfirmed(txId: string) {
    const tx = this.transactions.get(txId);
    if (!tx) return;
    tx.chainConfirmed = true;
    db.prepare("UPDATE transactions SET chainConfirmed = 1, data = ? WHERE txId = ?").run(JSON.stringify(tx), txId);
  }

  addDecision(decision: FraudDecisionRecord) {
    this.decisions.set(decision.txId, decision);
    db.prepare(
      "INSERT OR REPLACE INTO decisions (txId, institutionId, riskScore, riskLevel, decision, confidence, modelVersion, source, decidedAt, pipelineLatencyMs, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      decision.txId, decision.institutionId, decision.riskScore, decision.riskLevel, decision.decision,
      decision.confidence, decision.modelVersion, decision.source, decision.decidedAt, decision.pipelineLatencyMs,
      JSON.stringify(decision),
    );
  }

  addFeedback(item: Omit<FeedbackItem, "id">): FeedbackItem {
    const full: FeedbackItem = { ...item, id: randomUUID() };
    this.feedback.push(full);
    db.prepare(
      "INSERT INTO feedback (id, txId, institutionId, institutionVerdict, note, submittedAt) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(full.id, full.txId, full.institutionId, full.institutionVerdict, full.note ?? null, full.submittedAt);
    return full;
  }

  pushLiveFeedEvent(event: LiveFeedEvent) {
    this.liveFeed.unshift(event);
    if (this.liveFeed.length > 50) this.liveFeed.length = 50;
    db.prepare(
      "INSERT INTO live_feed (id, transactionId, institutionName, chainStatus, riskLevel, riskScore, occurredAt, rowOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(event.id, event.transactionId, event.institutionName, event.chainStatus, event.riskLevel, event.riskScore, event.occurredAt, Date.now());
    this.trimTable("live_feed", 200);
    this.events.emit("liveFeed", event);
  }

  pushAuthEvent(event: Omit<AuthEvent, "id">) {
    const full: AuthEvent = { ...event, id: randomUUID() };
    this.authEvents.unshift(full);
    if (this.authEvents.length > 50) this.authEvents.length = 50;
    db.prepare(
      "INSERT INTO auth_events (id, type, keyPrefix, path, occurredAt, rowOrder) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(full.id, full.type, full.keyPrefix, full.path, full.occurredAt, Date.now());
    this.trimTable("auth_events", 200);
  }

  pushPipelineWarning(event: Omit<PipelineWarningEvent, "id">) {
    const full: PipelineWarningEvent = { ...event, id: randomUUID() };
    this.pipelineWarnings.unshift(full);
    if (this.pipelineWarnings.length > 50) this.pipelineWarnings.length = 50;
    db.prepare(
      "INSERT INTO pipeline_warnings (id, txId, institutionId, warnings, occurredAt, rowOrder) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(full.id, full.txId, full.institutionId, JSON.stringify(full.warnings), full.occurredAt, Date.now());
    this.trimTable("pipeline_warnings", 200);
  }

  // Keep these append-only log tables from growing unboundedly - only the
  // most recent `keep` rows (by insertion order) are retained, well above
  // the 50 kept in memory so a burst doesn't lose history between reads.
  private trimTable(table: "live_feed" | "auth_events" | "pipeline_warnings", keep: number) {
    db.exec(
      `DELETE FROM ${table} WHERE rowOrder NOT IN (SELECT rowOrder FROM ${table} ORDER BY rowOrder DESC LIMIT ${keep})`,
    );
  }
}

export const store = new PersistentStore();
