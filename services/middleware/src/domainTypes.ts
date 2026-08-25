/**
 * Middleware's own domain model. Field names are kept aligned with
 * packages/types (used by the two dashboards) where they cross the
 * Dashboard API boundary, but this file is not a cross-package import -
 * a backend service should stay independently buildable/deployable rather
 * than reaching into a frontend-monorepo-only package.
 */

// ---- Raw input (Node API) ----
// Representative schema covering the six attribute categories described in
// Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf (transaction details,
// customer behavior, device signals, location signals, authentication
// signals, merchant/risk indicators). The doc references "the 30 core
// attributes defined earlier" without listing them, so this is a
// representative subset spanning every documented data type, not the
// literal 30 fields.
export interface RawTransactionInput {
  txId?: string;
  institutionId: string;
  amount: number;
  currency: string;
  accountAgeDays: number;
  sessionDurationSec: number;
  paymentChannel: "card" | "bank_transfer" | "wallet" | "crypto";
  loginMethod: "password" | "biometric" | "otp" | "sso";
  deviceType: "mobile" | "desktop" | "tablet";
  merchantCategory: string; // high-cardinality categorical
  crossBorderFlag: boolean;
  newDeviceFlag: boolean;
  mfaUsed: boolean;
  deviceId: string; // hashed identifier
  ipAddress: string; // hashed identifier
  submittedAt: string; // ISO timestamp
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

export interface StoredTransaction {
  txId: string;
  institutionId: string;
  amount: number;
  currency: string;
  submittedAt: string;
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
