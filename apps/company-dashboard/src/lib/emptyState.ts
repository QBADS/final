import type { FraudStats, PlatformHealth, PlatformKpis } from "@qbads/types";

/** Placeholder values shown for one poll cycle before the first real response arrives. */
export const EMPTY_KPIS: PlatformKpis = { connectedInstitutions: 0, liveTransactionsPerSecond: 0, transactionsToday: 0 };

export const EMPTY_FRAUD_STATS: FraudStats = {
  detectedToday: 0,
  estimatedSavingsUsd: 0,
  avgDetectionTimeMs: 0,
  compositeRiskScore: 0,
  riskThreshold: 75,
  quantumDecisionsToday: 0,
  fallbackDecisionsToday: 0,
};

export const EMPTY_HEALTH: PlatformHealth = {
  model: { reachable: false, modelVersion: null, activeModelFamily: null, trainedOn: null, fallbackRatePct: 0 },
  blockchain: { reachable: false, channel: null, chaincode: null },
  apiGateway: { uptimePct: 0, requestsPerSecond: 0, p99LatencyMs: 0 },
  resources: { heapUsedMb: 0, heapTotalMb: 0, rssMb: 0 },
};
