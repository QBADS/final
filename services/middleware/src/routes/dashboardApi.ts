import { Router } from "express";
import { store } from "../store/inMemoryStore";
import { federatedLearningSnapshot } from "../pipeline/federatedLearning";
import { getBlockchainHealth, getQuantumEngineHealth, getQuantumEngineModels } from "../integrations/platformHealthClient";
import { requestMetricsSnapshot } from "../metrics";
import { config } from "../config";
import { FIELD_CONFIG } from "../pipeline/featureEngineering";
import { pcaStatus } from "../pipeline/pcaReducer";
import type { FraudDecisionRecord, Institution, StoredTransaction } from "../domainTypes";

// The Dashboard API is unauthenticated (see note below) - never leak the
// Node API credential alongside institution metadata.
function publicInstitution(inst: Institution) {
  const { apiKey: _apiKey, ...rest } = inst;
  return rest;
}

// There's no real heartbeat/uptime tracking per institution (see
// domainTypes.ts's Institution) - this is a representative value derived
// from status, not a live measurement, same honesty note as
// platformHealth's resource stats below.
const SYNC_HEALTH_BY_STATUS: Record<Institution["status"], number> = {
  healthy: 99.5,
  degraded: 91.0,
  offline: 0,
};

function institutionSummary(inst: Institution) {
  const instTransactions = [...store.transactions.values()].filter((t) => t.institutionId === inst.id);
  const lastEventAt = instTransactions.at(-1)?.submittedAt ?? inst.connectedSince;
  return {
    ...publicInstitution(inst),
    syncHealthPct: SYNC_HEALTH_BY_STATUS[inst.status],
    lastEventAt,
    transactionCount: instTransactions.length,
  };
}

/**
 * Dashboard API (QBADS_Middleware_Flow_Structure.pdf, Section 1):
 * "Outbound - Risk events, fraud stats, node connection status, model
 * performance - Serve Node Dash (fintech) and Company Dash (QBADS) with
 * real-time visibility." Unauthenticated here (reference implementation);
 * a real deployment would put session auth in front of it, scoping Node
 * Dash calls to the caller's own institution.
 */
export const dashboardApiRouter = Router();

const LIVE_RATE_WINDOW_MS = 10_000;

function liveTransactionsPerSecond(): number {
  const cutoff = Date.now() - LIVE_RATE_WINDOW_MS;
  const recent = [...store.transactions.values()].filter((t) => new Date(t.submittedAt).getTime() >= cutoff);
  return Number((recent.length / (LIVE_RATE_WINDOW_MS / 1000)).toFixed(2));
}

dashboardApiRouter.get("/kpis", (_req, res) => {
  res.json({
    connectedInstitutions: store.institutions.size,
    transactionsToday: store.transactions.size,
    liveTransactionsPerSecond: liveTransactionsPerSecond(),
  });
});

dashboardApiRouter.get("/fraud-stats", (_req, res) => {
  const decisionsToday = store.decisionsToday();
  const flagged = decisionsToday.filter((d) => d.decision === "FRAUD" || d.decision === "HOLD");
  const avgScore = decisionsToday.length
    ? decisionsToday.reduce((sum, d) => sum + d.riskScore, 0) / decisionsToday.length
    : 0;
  const avgLatency = decisionsToday.length
    ? decisionsToday.reduce((sum, d) => sum + d.pipelineLatencyMs, 0) / decisionsToday.length
    : 0;
  const estimatedSavingsUsd = flagged.reduce((sum, d) => sum + (store.transactions.get(d.txId)?.amount ?? 0), 0);

  res.json({
    detectedToday: flagged.length,
    compositeRiskScore: Number(avgScore.toFixed(1)),
    avgDetectionTimeMs: Math.round(avgLatency),
    estimatedSavingsUsd: Math.round(estimatedSavingsUsd),
    riskThreshold: config.fraudThreshold,
    quantumDecisionsToday: decisionsToday.filter((d) => d.source === "quantum_model").length,
    fallbackDecisionsToday: decisionsToday.filter((d) => d.source === "classical_fallback").length,
  });
});

dashboardApiRouter.get("/institutions", (_req, res) => {
  res.json([...store.institutions.values()].map(institutionSummary));
});

dashboardApiRouter.get("/institutions/:id", (req, res) => {
  const institution = store.institutions.get(req.params.id);
  if (!institution) {
    res.status(404).json({ error: "institution not found" });
    return;
  }
  const transactions = [...store.transactions.values()].filter((t) => t.institutionId === institution.id);
  const decisions = transactions
    .map((t) => store.decisions.get(t.txId))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));
  const feedback = store.feedback.filter((f) => f.institutionId === institution.id);

  res.json({ institution: institutionSummary(institution), transactions, decisions, feedback });
});

// Real hourly transaction counts for today (0-23) - not a smoothed/modeled
// curve. Since Middleware is in-memory and this demo session is typically
// short-lived, most hours will legitimately read 0; that's an honest
// reflection of how little history actually exists, not a bug.
dashboardApiRouter.get("/volume-series", (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const hours = new Array(24).fill(0);
  for (const tx of store.transactions.values()) {
    const ts = new Date(tx.submittedAt);
    if (ts >= startOfDay) hours[ts.getUTCHours()] += 1;
  }
  res.json(hours.map((count, hour) => ({ t: `${String(hour).padStart(2, "0")}:00`, count })));
});

dashboardApiRouter.get("/model-performance", (_req, res) => {
  res.json(federatedLearningSnapshot());
});

// "Platform health" - every field here is either a real read from a
// downstream service's own /health endpoint, or a real stat about this
// Middleware process itself. See integrations/platformHealthClient.ts and
// metrics.ts for what's actually being measured, and packages/types/src/platform.ts
// for why fields like "accuracyPct" or host CPU/RAM were dropped rather
// than filled with numbers nothing in this system actually tracks.
dashboardApiRouter.get("/platform-health", async (_req, res) => {
  const [quantum, blockchain] = await Promise.all([getQuantumEngineHealth(), getBlockchainHealth()]);
  const decisionsToday = store.decisionsToday();
  const fallbackRatePct = decisionsToday.length
    ? (decisionsToday.filter((d) => d.source === "classical_fallback").length / decisionsToday.length) * 100
    : 0;
  const mem = process.memoryUsage();

  res.json({
    model: {
      reachable: quantum.reachable,
      modelVersion: quantum.championModelVersion,
      activeModelFamily: quantum.championModelFamily,
      trainedOn: quantum.trainedOn,
      fallbackRatePct: Number(fallbackRatePct.toFixed(1)),
    },
    blockchain: {
      reachable: blockchain.reachable,
      channel: blockchain.channel,
      chaincode: blockchain.chaincode,
    },
    apiGateway: requestMetricsSnapshot(),
    resources: {
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
      rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
    },
  });
});

// A small set of real, recent, human-readable events - not the fixed
// illustrative list the original dashboard mockup shipped with.
dashboardApiRouter.get("/ticker", (_req, res) => {
  const items = store.liveFeed.slice(0, 6).map((event) => ({
    id: event.id,
    severity: event.riskLevel === "high" ? "bad" : event.riskLevel === "medium" ? "warn" : "ok",
    message: `${event.transactionId} · ${event.institutionName} · risk ${event.riskScore.toFixed(0)} (${event.chainStatus})`,
  }));

  const offlineInstitutions = [...store.institutions.values()].filter((i) => i.status === "offline");
  for (const inst of offlineInstitutions) {
    items.push({ id: `offline-${inst.id}`, severity: "bad", message: `${inst.name} is offline` });
  }

  res.json(items);
});

// Full transaction+decision list across all institutions, for the
// "Transaction centre" / "Fraud detection" / "Case management" pages -
// optionally filtered by institution, decision outcome, or risk level.
// Fraud detection = decision in (FRAUD, HOLD); Case management = REVIEW.
dashboardApiRouter.get("/transactions", (req, res) => {
  const { institutionId, decision, riskLevel } = req.query;

  type Row = { tx: StoredTransaction; decision: FraudDecisionRecord };
  let rows: Row[] = [...store.transactions.values()]
    .map((tx) => ({ tx, decision: store.decisions.get(tx.txId) }))
    .filter((row): row is Row => Boolean(row.decision));

  if (typeof institutionId === "string") rows = rows.filter((r) => r.tx.institutionId === institutionId);
  if (typeof decision === "string") rows = rows.filter((r) => r.decision.decision === decision);
  if (typeof riskLevel === "string") rows = rows.filter((r) => r.decision.riskLevel === riskLevel);

  rows.sort((a, b) => new Date(b.tx.submittedAt).getTime() - new Date(a.tx.submittedAt).getTime());

  const institutionNames = new Map([...store.institutions.values()].map((i) => [i.id, i.name]));
  res.json(
    rows.slice(0, 200).map((r) => ({
      ...r,
      institutionName: institutionNames.get(r.tx.institutionId) ?? r.tx.institutionId,
    })),
  );
});

// Real model roster from services/quantum-pipeline - for the "Quantum
// computing" page. null/unreachable fields are honest, not fabricated.
dashboardApiRouter.get("/quantum-info", async (_req, res) => {
  const [health, models] = await Promise.all([getQuantumEngineHealth(), getQuantumEngineModels()]);
  res.json({
    reachable: health.reachable,
    champion: health.championModelFamily,
    featureDimension: config.qubitBudget,
    models: models ?? [],
  });
});

// Real Fabric gateway status - for the "Blockchain" page. Deliberately
// thin: services/blockchain isn't deployed by default (see its README), so
// this mostly demonstrates the reachability check reporting that honestly.
dashboardApiRouter.get("/blockchain-info", async (_req, res) => {
  const health = await getBlockchainHealth();
  res.json({
    ...health,
    gatewayUrl: config.blockchainGatewayUrl,
    writeEnabled: config.blockchainWriteEnabled,
  });
});

// Every sandbox key shares the "qbads_sandbox_" prefix, so a plain
// slice(0, N) shows the same string for every institution - mask the
// middle instead so each one is still visually distinct.
function maskKey(key: string): string {
  return key.length <= 18 ? key : `${key.slice(0, 14)}…${key.slice(-4)}`;
}

// Recent authentication failures (never successes - see auth.ts, that
// would be most of the request volume) plus each institution's key status
// - for the "Security operations" page.
dashboardApiRouter.get("/security", (_req, res) => {
  res.json({
    authEvents: store.authEvents,
    institutions: [...store.institutions.values()].map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      apiKeyMasked: maskKey(i.apiKey),
    })),
  });
});

// Non-secret runtime config - for the "Administration" page.
dashboardApiRouter.get("/config", (_req, res) => {
  res.json({
    quantumClientMode: config.quantumClientMode,
    quantumTimeoutMs: config.quantumTimeoutMs,
    quantumMaxRetries: config.quantumMaxRetries,
    qubitBudget: config.qubitBudget,
    reviewThreshold: config.reviewThreshold,
    fraudThreshold: config.fraudThreshold,
    blockchainWriteEnabled: config.blockchainWriteEnabled,
    institutionCount: store.institutions.size,
  });
});

// Stage 1 field classification (featureEngineering.ts's actual config, not
// a description of it) + recent real pipeline warnings - for the "Feature
// engineering" page.
dashboardApiRouter.get("/feature-pipeline", (_req, res) => {
  res.json({
    fields: Object.entries(FIELD_CONFIG).map(([name, cfg]) => ({ name, ...cfg })),
    recentWarnings: store.pipelineWarnings,
  });
});

// Stage 2.1's real-PCA state - sample buffer fill level and whether the
// dimensionality-reduction path currently uses a fitted PCA model or is
// still in cold-start fallback (pipeline/pcaReducer.ts). Lightweight and
// genuinely useful for observability, so it stays rather than being
// scaffolding-only.
dashboardApiRouter.get("/pca-status", (_req, res) => {
  res.json(pcaStatus());
});

// Risk events / live feed, streamed to the dashboards as SSE.
dashboardApiRouter.get("/live-feed", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const event of store.liveFeed.slice(0, 10).reverse()) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const onEvent = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  store.events.on("liveFeed", onEvent);
  req.on("close", () => store.events.off("liveFeed", onEvent));
});
