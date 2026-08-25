/**
 * Platform-wide health, sourced from the Dashboard API's "platform health" /
 * "platform stats" / "model performance" payloads (see hand-drawn architecture
 * diagram and QBADS_Middleware_Flow_Structure Section 1).
 */
export interface ModelPerformance {
  /** False if services/quantum-pipeline didn't answer its own /health check. */
  reachable: boolean;
  modelVersion: string | null;
  /** QSVM / QNN / VQC - whichever family is currently the live champion. */
  activeModelFamily: "QSVM" | "QNN" | "VQC" | null;
  /** "synthetic-bootstrap" (startup default) or "training-pipeline" (a promoted, gated model). */
  trainedOn: string | null;
  /** Share of today's decisions served by the classical fallback rather than the quantum model. */
  fallbackRatePct: number;
}

export interface BlockchainHealth {
  /** False if services/blockchain/gateway didn't answer its own /health check
   * (e.g. the Fabric network hasn't been deployed - see that service's README). */
  reachable: boolean;
  channel: string | null;
  chaincode: string | null;
}

export interface ApiGatewayHealth {
  /** 100 by construction - this process hasn't restarted since it started serving. */
  uptimePct: number;
  requestsPerSecond: number;
  p99LatencyMs: number;
}

/** Middleware's own Node.js process memory - not host/platform-wide resource
 * usage (there's no infrastructure-monitoring agent anywhere in this repo). */
export interface ProcessResourceUsage {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
}

export interface PlatformHealth {
  model: ModelPerformance;
  blockchain: BlockchainHealth;
  apiGateway: ApiGatewayHealth;
  resources: ProcessResourceUsage;
}

export interface PlatformKpis {
  connectedInstitutions: number;
  /** Transactions submitted in the last 10s, averaged - a real rolling rate, not a modeled figure. */
  liveTransactionsPerSecond: number;
  transactionsToday: number;
}

export interface LiveFeedEvent {
  id: string;
  transactionId: string;
  institutionName: string;
  chainStatus: "confirmed" | "pending";
  riskLevel: import("./fraud").RiskLevel;
  riskScore: number;
  occurredAt: string;
}

export type TickerSeverity = "ok" | "warn" | "bad";

export interface TickerItem {
  id: string;
  severity: TickerSeverity;
  message: string;
}
