/**
 * Decision outcomes as produced by the Middleware decision engine.
 * SAFE / REVIEW / FRAUD come from the primary (quantum-backed) path;
 * HOLD is reserved for the classical fallback path (see Middleware doc, Section 3).
 */
export type RiskDecision = "SAFE" | "REVIEW" | "FRAUD" | "HOLD";

export type RiskLevel = "low" | "medium" | "high";

export type DecisionSource = "quantum_model" | "classical_fallback";

export interface Transaction {
  txId: string;
  institutionId: string;
  amount: number;
  currency: string;
  submittedAt: string;
  /** True once the Blockchain API has returned a receipt for this tx. */
  chainConfirmed: boolean;
}

export interface FraudDecision {
  txId: string;
  institutionId: string;
  riskScore: number; // 0-100 composite score
  riskLevel: RiskLevel;
  decision: RiskDecision;
  confidence: number; // 0-1, from Quantum Model API response
  modelVersion: string;
  source: DecisionSource;
  decidedAt: string;
  /** Set once the Blockchain API has written the decision back on-chain. */
  decisionHash?: string;
  /** Real pipeline latency (Stage 1/2 + quantum/fallback + decision), measured by Middleware. */
  pipelineLatencyMs: number;
}

export interface FraudStats {
  detectedToday: number;
  /** Sum of the amounts on today's FRAUD/HOLD transactions - what got caught, not a modeled estimate. */
  estimatedSavingsUsd: number;
  /** Real average pipeline latency (Stage 1/2 + quantum/fallback + decision) across today's decisions. */
  avgDetectionTimeMs: number;
  compositeRiskScore: number; // current window gauge value
  riskThreshold: number;
  quantumDecisionsToday: number;
  fallbackDecisionsToday: number;
}
