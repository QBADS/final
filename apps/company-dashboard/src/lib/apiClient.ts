/**
 * Real client for Middleware's Dashboard API
 * (services/middleware/src/routes/dashboardApi.ts) - QBADS_Middleware_Flow_Structure
 * Section 1: "Dashboard API - Outbound - Risk events, fraud stats, node
 * connection status, model performance". Replaces the mock module of the
 * same shape this file used to be; every function below is typed against
 * @qbads/types, unchanged from the mock, so no consuming component needed
 * to change when this swapped over.
 */
import type { FraudDecision, FraudStats, Institution, PlatformHealth, PlatformKpis, RiskDecision, RiskLevel, TickerItem, Transaction } from "@qbads/types";

export const API_BASE = import.meta.env.VITE_MIDDLEWARE_URL ?? "http://localhost:4000";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export const kindLabel: Record<Institution["kind"], string> = {
  bank: "Bank",
  fintech: "Fintech",
  digital_wallet: "Digital wallet",
  insurance: "Insurance",
  mobile_money: "Mobile money",
  crypto_exchange: "Crypto exchange",
  payment_processor: "Payment processor",
  regulator: "Regulator",
};

export function institutionSubtitle(inst: Institution): string {
  return `${kindLabel[inst.kind]} · ${inst.region}`;
}

export const fetchKpis = () => getJson<PlatformKpis>("/api/dashboard/kpis");
export const fetchFraudStats = () => getJson<FraudStats>("/api/dashboard/fraud-stats");
export const fetchInstitutions = () => getJson<Institution[]>("/api/dashboard/institutions");
export const fetchPlatformHealth = () => getJson<PlatformHealth>("/api/dashboard/platform-health");
export const fetchTicker = () => getJson<TickerItem[]>("/api/dashboard/ticker");

export interface VolumePoint {
  t: string;
  count: number;
}
export const fetchVolumeSeries = () => getJson<VolumePoint[]>("/api/dashboard/volume-series");

export interface TransactionRow {
  tx: Transaction;
  decision: FraudDecision;
  institutionName: string;
}
export interface TransactionFilter {
  institutionId?: string;
  decision?: RiskDecision;
  riskLevel?: RiskLevel;
}
export function fetchTransactions(filter: TransactionFilter = {}): Promise<TransactionRow[]> {
  const params = new URLSearchParams(filter as Record<string, string>);
  const qs = params.toString();
  return getJson<TransactionRow[]>(`/api/dashboard/transactions${qs ? `?${qs}` : ""}`);
}

export interface QuantumModelInfo {
  modelType: "QSVM" | "QNN" | "VQC";
  modelVersion: string;
  featureDimension: number;
  trainedOn: string;
  bootstrapSamples: number;
}
export interface QuantumInfo {
  reachable: boolean;
  champion: "QSVM" | "QNN" | "VQC" | null;
  featureDimension: number;
  models: QuantumModelInfo[];
}
export const fetchQuantumInfo = () => getJson<QuantumInfo>("/api/dashboard/quantum-info");

export interface BlockchainInfo {
  reachable: boolean;
  channel: string | null;
  chaincode: string | null;
  gatewayUrl: string;
  writeEnabled: boolean;
}
export const fetchBlockchainInfo = () => getJson<BlockchainInfo>("/api/dashboard/blockchain-info");

export interface AuthEvent {
  id: string;
  type: "missing_key" | "invalid_key";
  keyPrefix: string | null;
  path: string;
  occurredAt: string;
}
export interface SecurityInfo {
  authEvents: AuthEvent[];
  institutions: { id: string; name: string; status: Institution["status"]; apiKeyMasked: string }[];
}
export const fetchSecurity = () => getJson<SecurityInfo>("/api/dashboard/security");

export interface RuntimeConfig {
  quantumClientMode: string;
  quantumTimeoutMs: number;
  quantumMaxRetries: number;
  qubitBudget: number;
  reviewThreshold: number;
  fraudThreshold: number;
  blockchainWriteEnabled: boolean;
  institutionCount: number;
}
export const fetchConfig = () => getJson<RuntimeConfig>("/api/dashboard/config");

export interface FeatureFieldConfig {
  name: string;
  type: "continuous" | "categorical_low" | "categorical_high" | "binary" | "hashed" | "timestamp";
  required: boolean;
  min?: number;
  max?: number;
  imputeDefault?: number;
  vocab?: string[];
}
export interface PipelineWarningEvent {
  id: string;
  txId: string;
  institutionId: string;
  warnings: string[];
  occurredAt: string;
}
export interface FeaturePipelineInfo {
  fields: FeatureFieldConfig[];
  recentWarnings: PipelineWarningEvent[];
}
export const fetchFeaturePipeline = () => getJson<FeaturePipelineInfo>("/api/dashboard/feature-pipeline");

export interface ModelPerformanceSnapshot {
  totalFeedback: number;
  confirmedFraud: number;
  confirmedLegitimate: number;
  unresolved: number;
  agreementRatePct: number | null;
  readyForAggregation: boolean;
}
export const fetchModelPerformance = () => getJson<ModelPerformanceSnapshot>("/api/dashboard/model-performance");
