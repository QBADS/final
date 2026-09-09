/**
 * Decision outcomes as produced by the Middleware decision engine.
 * SAFE / REVIEW / FRAUD come from the primary (quantum-backed) path;
 * HOLD is reserved for the classical fallback path (see Middleware doc, Section 3).
 */
export type RiskDecision = "SAFE" | "REVIEW" | "FRAUD" | "HOLD";

export type RiskLevel = "low" | "medium" | "high";

export type DecisionSource = "quantum_model" | "classical_fallback";

/**
 * The 30 core attributes from Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf,
 * across its six attribute categories. Field names here are byte-identical
 * to services/middleware/src/domainTypes.ts's RawTransactionInput /
 * StoredTransaction - this is the wire format crossing the Dashboard API
 * boundary, and name drift between the two is a real bug class (see the
 * old `txId` note this comment replaces): keep both files in lockstep.
 */
export interface TransactionDetails {
  // -- Transaction details --
  amount: number;
  currency: string;
  paymentChannel: "card" | "bank_transfer" | "wallet" | "crypto";
  merchantCategory: string;
  submittedAt: string;

  // -- Customer behavior --
  accountAgeDays: number;
  sessionDurationSec: number;
  avgTransactionAmount30d: number;
  transactionVelocity1h: number;
  daysSinceLastTransaction: number;

  // -- Device signals --
  deviceType: "mobile" | "desktop" | "tablet";
  newDeviceFlag: boolean;
  deviceId: string;
  browserFingerprint: string;
  deviceTrustScore: number;

  // -- Location signals --
  ipAddress: string;
  crossBorderFlag: boolean;
  country: string;
  distanceFromHomeKm: number;
  vpnOrProxyFlag: boolean;

  // -- Authentication signals --
  loginMethod: "password" | "biometric" | "otp" | "sso";
  mfaUsed: boolean;
  authFailureCount24h: number;
  passwordAgeDays: number;
  biometricMatchScore: number;

  // -- Merchant / risk indicators --
  merchantId: string;
  merchantRiskScore: number;
  chargebackHistory: number;
  isHighRiskMerchantCategory: boolean;
  cardPresentFlag: boolean;
}

export interface Transaction extends TransactionDetails {
  txId: string;
  institutionId: string;
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
