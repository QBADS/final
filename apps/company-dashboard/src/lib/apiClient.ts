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

/**
 * Dashboard API session auth (services/middleware/src/auth/dashboardAuth.ts
 * - README's former "Not done here: Session auth in front of the Dashboard
 * API" is now implemented). Company Dash is QBADS staff's internal tool
 * (the architecture mockup's "role: exec-admin" footer), so rather than
 * building a standalone login page/route here, this client transparently
 * logs in with the seeded exec-admin sandbox account on first use and
 * attaches the resulting bearer token to every Dashboard API call,
 * re-logging in once on a 401 (e.g. an expired token). The token is cached
 * in localStorage only, per-browser, same trust level as this whole
 * reference app.
 */
const TOKEN_STORAGE_KEY = "qbads.companyDashboard.dashboardToken";
const DASHBOARD_USERNAME = import.meta.env.VITE_DASHBOARD_USERNAME ?? "exec-admin";
const DASHBOARD_PASSWORD = import.meta.env.VITE_DASHBOARD_PASSWORD ?? "qbads-exec-admin-2026";

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage unavailable (private browsing, etc.) - fall back to an
    // in-memory token for the life of this page load.
  }
}

let inMemoryToken: string | null = null;
let loginPromise: Promise<string> | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/dashboard/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: DASHBOARD_USERNAME, password: DASHBOARD_PASSWORD }),
  });
  if (!res.ok) throw new Error(`dashboard login failed -> ${res.status}`);
  const body = (await res.json()) as { token: string };
  inMemoryToken = body.token;
  setStoredToken(body.token);
  return body.token;
}

async function ensureToken(): Promise<string> {
  const cached = inMemoryToken ?? getStoredToken();
  if (cached) {
    inMemoryToken = cached;
    return cached;
  }
  loginPromise ??= login().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

async function getJson<T>(path: string): Promise<T> {
  const token = await ensureToken();
  let res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    // Token expired/invalid - log in once more and retry a single time.
    inMemoryToken = null;
    const fresh = await login();
    res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${fresh}` } });
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Same auth as getJson, plus a `token=` query param for EventSource (SSE),
 * which cannot set custom request headers - see dashboardAuth.ts. */
export async function dashboardEventSourceUrl(path: string): Promise<string> {
  const token = await ensureToken();
  const sep = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
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
