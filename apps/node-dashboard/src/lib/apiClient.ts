/**
 * Real client for Middleware's Node API + Dashboard API, scoped to a single
 * institution - this app represents one fintech's own view (see the
 * "Node Dash / FinTech" box in the architecture sketch). Replaces the mock
 * module of the same shape this file used to be.
 *
 * There's no login flow (see services/middleware/README.md - the Dashboard
 * API is unauthenticated in this reference implementation), so which
 * institution this dashboard represents is fixed to one of Middleware's
 * seeded sandbox institutions rather than selected at runtime.
 */
import type { FeedbackItem, FraudDecision, Institution, Transaction } from "@qbads/types";

export const API_BASE = import.meta.env.VITE_MIDDLEWARE_URL ?? "http://localhost:4000";
export const NODE_INSTITUTION_ID = import.meta.env.VITE_NODE_INSTITUTION_ID ?? "inst-2";
export const NODE_API_KEY = import.meta.env.VITE_NODE_API_KEY ?? "qbads_sandbox_novafintech";

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
  getJson<InstitutionDetail>(`/api/dashboard/institutions/${NODE_INSTITUTION_ID}`);

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
