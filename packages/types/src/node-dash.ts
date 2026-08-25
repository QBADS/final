/**
 * Types specific to the Node Dash (fintech client view) - the bullets under
 * "Node Dash / FinTech" in the architecture sketch: fraud stats, API & data
 * details, node connection, feedback.
 */
export interface ApiCredential {
  keyId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  scope: "submit_transactions" | "read_only";
}

export interface ApiUsageStats {
  requestsToday: number;
  /** A configured sandbox limit, not a measured value - there's no rate limiter in Middleware yet. */
  requestsQuotaDaily: number;
  /** Share of this institution's decisions served by the classical fallback rather than the quantum model. */
  fallbackRatePct: number;
  /** Real average pipeline latency across this institution's decisions today. */
  avgLatencyMs: number;
}

export interface FeedbackItem {
  id: string;
  txId: string;
  /** Institution's confirmation/dispute of a QBADS decision, fed back into the
   * federated learning loop (see Middleware doc, Section 4). */
  institutionVerdict: "confirmed_fraud" | "confirmed_legitimate" | "unresolved";
  note?: string;
  submittedAt: string;
}

export interface NodeProfile {
  institutionId: string;
  name: string;
  fabricOrgId: string;
  onboardedAt: string;
  environment: "sandbox" | "production";
}
