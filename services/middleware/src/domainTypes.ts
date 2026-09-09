/**
 * Middleware's own domain model. Field names are kept aligned with
 * packages/types (used by the two dashboards) where they cross the
 * Dashboard API boundary, but this file is not a cross-package import -
 * a backend service should stay independently buildable/deployable rather
 * than reaching into a frontend-monorepo-only package.
 */

// ---- Raw input (Node API) ----
// The full 30 core attributes from Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf,
// across its six attribute categories. Field names here are byte-identical
// to packages/types/src/fraud.ts's TransactionDetails - the wire format
// crossing the Dashboard API boundary - specifically to avoid the kind of
// txId-style name drift between the backend and frontend contracts that has
// been a real bug class in this codebase before.
export interface RawTransactionInput {
  txId?: string;
  institutionId: string;

  // -- Transaction details --
  amount: number;
  currency: string;
  paymentChannel: "card" | "bank_transfer" | "wallet" | "crypto";
  merchantCategory: string; // high-cardinality categorical
  submittedAt: string; // ISO timestamp

  // -- Customer behavior --
  accountAgeDays: number;
  sessionDurationSec: number;
  avgTransactionAmount30d: number;
  transactionVelocity1h: number; // count of transactions by this customer in the last hour
  daysSinceLastTransaction: number;

  // -- Device signals --
  deviceType: "mobile" | "desktop" | "tablet";
  newDeviceFlag: boolean;
  deviceId: string; // hashed identifier
  browserFingerprint: string; // hashed identifier
  deviceTrustScore: number; // 0-100, higher = more trusted device history

  // -- Location signals --
  ipAddress: string; // hashed identifier
  crossBorderFlag: boolean;
  country: string; // high-cardinality categorical (ISO country code)
  distanceFromHomeKm: number;
  vpnOrProxyFlag: boolean;

  // -- Authentication signals --
  loginMethod: "password" | "biometric" | "otp" | "sso";
  mfaUsed: boolean;
  authFailureCount24h: number;
  passwordAgeDays: number;
  biometricMatchScore: number; // 0-100

  // -- Merchant / risk indicators --
  merchantId: string; // hashed identifier
  merchantRiskScore: number; // 0-100, precomputed merchant risk from prior history
  chargebackHistory: number; // count of prior chargebacks on this merchant/customer pair
  isHighRiskMerchantCategory: boolean;
  cardPresentFlag: boolean;
}

export type FeatureType = "continuous" | "categorical_low" | "categorical_high" | "binary" | "hashed" | "timestamp";

export interface ClassifiedField {
  name: string;
  type: FeatureType;
  rawValue: unknown;
}

export interface NormalizedFeature {
  name: string;
  type: FeatureType;
  values: number[]; // one value normally; one-hot/embedding fields produce several
}

export interface QuantumEncodedFeature extends NormalizedFeature {
  encoding: "angle" | "basis" | "amplitude";
}

export interface QuantumReadyVector {
  recordId: string;
  qubitBudget: number;
  qubitCost: number;
  dimensionalityReduced: boolean;
  features: QuantumEncodedFeature[];
  flat: number[];
}

// ---- Quantum Model API (Middleware -> Quantum Engine, and back) ----
export interface QuantumInferenceResult {
  anomalyScore: number; // 0-100
  riskLevel: "low" | "medium" | "high";
  confidence: number; // 0-1
  modelVersion: string;
  modelFamily: "QSVM" | "QNN" | "VQC";
  latencyMs: number;
}

// ---- Decisioning ----
export type RiskDecision = "SAFE" | "REVIEW" | "FRAUD" | "HOLD";
export type DecisionSource = "quantum_model" | "classical_fallback";

export interface FraudDecisionRecord {
  txId: string;
  institutionId: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  decision: RiskDecision;
  confidence: number;
  modelVersion: string;
  source: DecisionSource;
  decidedAt: string;
  decisionHash?: string;
  /** Wall-clock time for Stage 1/2 + quantum-or-fallback + decisioning, measured in nodeApi.ts. */
  pipelineLatencyMs: number;
}

// Post-Stage1 (validated/imputed) transaction, as actually persisted and
// served back over the Dashboard API. Same 30 attributes as
// RawTransactionInput - every field has a concrete value by this point,
// missing ones having gone through Stage 1's imputation/defaulting.
export interface StoredTransaction extends Omit<RawTransactionInput, "txId"> {
  txId: string;
  chainConfirmed: boolean;
}

// ---- Federated learning feedback ----
export interface FeedbackItem {
  id: string;
  txId: string;
  institutionId: string;
  institutionVerdict: "confirmed_fraud" | "confirmed_legitimate" | "unresolved";
  note?: string;
  submittedAt: string;
}

// ---- Institutions / nodes ----
export type InstitutionKind =
  | "bank"
  | "fintech"
  | "digital_wallet"
  | "insurance"
  | "mobile_money"
  | "crypto_exchange"
  | "payment_processor"
  | "regulator";

export interface Institution {
  id: string;
  name: string;
  apiKey: string;
  status: "healthy" | "degraded" | "offline";
  connectedSince: string;
  kind: InstitutionKind;
  region: string;
  fabricOrgId: string;
}

export interface LiveFeedEvent {
  id: string;
  transactionId: string;
  institutionName: string;
  chainStatus: "confirmed" | "pending";
  riskLevel: "low" | "medium" | "high";
  riskScore: number;
  occurredAt: string;
}

// ---- Security / ops observability ----
export interface AuthEvent {
  id: string;
  type: "missing_key" | "invalid_key";
  keyPrefix: string | null; // first 12 chars of whatever was presented, for correlation without logging the full secret
  path: string;
  occurredAt: string;
}

export interface PipelineWarningEvent {
  id: string;
  txId: string;
  institutionId: string;
  warnings: string[];
  occurredAt: string;
}
