/**
 * Real client for Middleware's Node API + Dashboard API, scoped to a single
 * institution - this app represents one fintech's own view (see the
 * "Node Dash / FinTech" box in the architecture sketch). Replaces the mock
 * module of the same shape this file used to be.
 *
 * Which institution this dashboard represents is still fixed to one of
 * Middleware's seeded sandbox institutions rather than selected at
 * runtime - the Node API calls below keep using its unchanged x-api-key
 * auth (auth.ts). The Dashboard API calls now require a session token
 * (auth/dashboardAuth.ts, README's former "Not done here: Session auth in
 * front of the Dashboard API"): this client transparently logs in with the
 * seeded `institution`-role account matching NODE_INSTITUTION_ID and
 * attaches the resulting bearer token, re-logging in once on a 401.
 */
import type { FeedbackItem, FraudDecision, Institution, Transaction } from "@qbads/types";

export const API_BASE = import.meta.env.VITE_MIDDLEWARE_URL ?? "http://localhost:4000";
export const NODE_INSTITUTION_ID = import.meta.env.VITE_NODE_INSTITUTION_ID ?? "inst-2";
export const NODE_API_KEY = import.meta.env.VITE_NODE_API_KEY ?? "qbads_sandbox_novafintech";

const DASHBOARD_TOKEN_STORAGE_KEY = "qbads.nodeDashboard.dashboardToken";
const DASHBOARD_USERNAME = import.meta.env.VITE_DASHBOARD_USERNAME ?? "novafintech";
const DASHBOARD_PASSWORD = import.meta.env.VITE_DASHBOARD_PASSWORD ?? "qbads-novafintech-2026";

function getStoredDashboardToken(): string | null {
  try {
    return localStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredDashboardToken(token: string): void {
  try {
    localStorage.setItem(DASHBOARD_TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage unavailable - fall back to the in-memory token below.
  }
}

let inMemoryDashboardToken: string | null = null;
let dashboardLoginPromise: Promise<string> | null = null;

async function dashboardLogin(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/dashboard/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: DASHBOARD_USERNAME, password: DASHBOARD_PASSWORD }),
  });
  if (!res.ok) throw new Error(`dashboard login failed -> ${res.status}`);
  const body = (await res.json()) as { token: string };
  inMemoryDashboardToken = body.token;
  setStoredDashboardToken(body.token);
  return body.token;
}

async function ensureDashboardToken(): Promise<string> {
  const cached = inMemoryDashboardToken ?? getStoredDashboardToken();
  if (cached) {
    inMemoryDashboardToken = cached;
    return cached;
  }
  dashboardLoginPromise ??= dashboardLogin().finally(() => {
    dashboardLoginPromise = null;
  });
  return dashboardLoginPromise;
}

/** Fetch helper for Dashboard API routes: attaches/refreshes the session bearer token. */
async function getDashboardJson<T>(path: string): Promise<T> {
  const token = await ensureDashboardToken();
  let res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    inMemoryDashboardToken = null;
    const fresh = await dashboardLogin();
    res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${fresh}` } });
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** Same auth as getDashboardJson, plus a `token=` query param for EventSource
 * (SSE), which cannot set custom request headers - see dashboardAuth.ts. */
export async function dashboardEventSourceUrl(path: string): Promise<string> {
  const token = await ensureDashboardToken();
  const sep = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
}

/** Fetch helper for Node API routes: unchanged x-api-key auth. */
async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

function withAuth(init?: RequestInit): RequestInit {
  return { ...init, headers: { ...init?.headers, "x-api-key": NODE_API_KEY } };
}

export interface InstitutionDetail {
  institution: Institution;
  transactions: Transaction[];
  decisions: FraudDecision[];
  feedback: FeedbackItem[];
}

export const fetchInstitutionDetail = () =>
  getDashboardJson<InstitutionDetail>(`/api/dashboard/institutions/${NODE_INSTITUTION_ID}`);

export interface NodeStatus {
  institution: Institution;
  requestsToday: number;
  lastEventAt: string | null;
}

export const fetchNodeStatus = () => getJson<NodeStatus>("/api/node/status", withAuth());

export interface FeedbackSubmission {
  txId: string;
  institutionVerdict: "confirmed_fraud" | "confirmed_legitimate" | "unresolved";
  note?: string;
}

export async function submitFeedback(payload: FeedbackSubmission): Promise<FeedbackItem> {
  return getJson<FeedbackItem>(
    "/api/node/feedback",
    withAuth({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
  );
}
