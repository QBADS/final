/**
 * Everything the Node Dash panels show that isn't a direct field on an API
 * response - computed here, from real fetched data, rather than requested
 * as bespoke Middleware endpoints (fraud/summary math this small doesn't
 * need its own route).
 */
import type { ApiUsageStats, FraudDecision, NodeConnectionStatus, Transaction } from "@qbads/types";
import type { NodeStatus } from "./apiClient";

const SANDBOX_DAILY_QUOTA = 500_000;

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate();
}

export function recentTransactions(
  transactions: Transaction[],
  decisions: FraudDecision[],
  max = 8,
): { tx: Transaction; decision: FraudDecision }[] {
  const decisionByTxId = new Map(decisions.map((d) => [d.txId, d]));
  return [...transactions]
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, max)
    .map((tx) => ({ tx, decision: decisionByTxId.get(tx.txId) }))
    .filter((row): row is { tx: Transaction; decision: FraudDecision } => Boolean(row.decision));
}

export function fraudSummary(decisions: FraudDecision[]) {
  const today = decisions.filter((d) => isToday(d.decidedAt));
  const flagged = today.filter((d) => d.decision === "FRAUD" || d.decision === "HOLD");
  const reviewQueue = today.filter((d) => d.decision === "REVIEW").length;
  const compositeRiskScore = today.length ? today.reduce((s, d) => s + d.riskScore, 0) / today.length : 0;

  return {
    flaggedToday: flagged.length,
    reviewQueue,
    confirmedFraudRate: today.length ? Number(((flagged.length / today.length) * 100).toFixed(1)) : 0,
    compositeRiskScore: Number(compositeRiskScore.toFixed(1)),
    transactionsToday: today.length,
  };
}

export function decisionSourceSummary(decisions: FraudDecision[]) {
  const quantum = decisions.filter((d) => d.source === "quantum_model").length;
  const fallbackPct = decisions.length ? Number((((decisions.length - quantum) / decisions.length) * 100).toFixed(1)) : 0;
  const latestModelVersion = decisions.at(-1)?.modelVersion ?? "—";
  return { fallbackPct, latestModelVersion };
}

export function connectionStatus(status: NodeStatus, decisions: FraudDecision[]): NodeConnectionStatus {
  const avgLatency = decisions.length ? decisions.reduce((s, d) => s + d.pipelineLatencyMs, 0) / decisions.length : 0;
  return {
    institutionId: status.institution.id,
    apiLatencyMs: Math.round(avgLatency),
    lastHeartbeatAt: status.lastEventAt ?? status.institution.connectedSince,
    status: status.institution.status,
  };
}

export function apiUsage(status: NodeStatus, decisions: FraudDecision[]): ApiUsageStats {
  const avgLatency = decisions.length ? decisions.reduce((s, d) => s + d.pipelineLatencyMs, 0) / decisions.length : 0;
  const { fallbackPct } = decisionSourceSummary(decisions);
  return {
    requestsToday: status.requestsToday,
    requestsQuotaDaily: SANDBOX_DAILY_QUOTA,
    fallbackRatePct: fallbackPct,
    avgLatencyMs: Math.round(avgLatency),
  };
}
