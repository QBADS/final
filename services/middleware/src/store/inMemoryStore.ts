import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
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
 * Stand-in for what would be a real database behind Middleware. Single
 * process, in memory, reset on restart - fine for a reference
 * implementation, not for production.
 */
class InMemoryStore {
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
    this.seedInstitutions();
  }

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
    for (const inst of seed) {
      const full: Institution = { ...inst, connectedSince: new Date().toISOString() };
      this.institutions.set(full.id, full);
      this.apiKeyIndex.set(full.apiKey, full.id);
    }
  }

  institutionByApiKey(apiKey: string): Institution | undefined {
    const id = this.apiKeyIndex.get(apiKey);
    return id ? this.institutions.get(id) : undefined;
  }

  addTransaction(tx: StoredTransaction) {
    this.transactions.set(tx.txId, tx);
  }

  addDecision(decision: FraudDecisionRecord) {
    this.decisions.set(decision.txId, decision);
  }

  addFeedback(item: Omit<FeedbackItem, "id">): FeedbackItem {
    const full: FeedbackItem = { ...item, id: randomUUID() };
    this.feedback.push(full);
    return full;
  }

  pushLiveFeedEvent(event: LiveFeedEvent) {
    this.liveFeed.unshift(event);
    if (this.liveFeed.length > 50) this.liveFeed.length = 50;
    this.events.emit("liveFeed", event);
  }

  pushAuthEvent(event: Omit<AuthEvent, "id">) {
    this.authEvents.unshift({ ...event, id: randomUUID() });
    if (this.authEvents.length > 50) this.authEvents.length = 50;
  }

  pushPipelineWarning(event: Omit<PipelineWarningEvent, "id">) {
    this.pipelineWarnings.unshift({ ...event, id: randomUUID() });
    if (this.pipelineWarnings.length > 50) this.pipelineWarnings.length = 50;
  }

  decisionsToday(): FraudDecisionRecord[] {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    return [...this.decisions.values()].filter((d) => new Date(d.decidedAt) >= startOfDay);
  }
}

export const store = new InMemoryStore();
