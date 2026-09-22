/**
 * A node in the QBADS network: a bank, fintech, wallet, or other institution
 * connected via the Middleware Node API (see QBADS_Middleware_Flow_Structure).
 */
export type InstitutionKind =
  | "bank"
  | "fintech"
  | "digital_wallet"
  | "insurance"
  | "mobile_money"
  | "crypto_exchange"
  | "payment_processor"
  | "regulator";

export type HealthStatus = "healthy" | "degraded" | "offline";

/** Onboarding lifecycle - deliberately separate from HealthStatus above,
 * which is live connectivity health, not application/approval progress. */
export type OnboardingStatus = "pending" | "active" | "rejected" | "revoked";

export interface Institution {
  id: string;
  name: string;
  kind: InstitutionKind;
  region: string;
  /** Fabric organization this institution maps to (see Hyperledger Fabric doc, Section 2). */
  fabricOrgId: string;
  status: HealthStatus;
  onboardingStatus: OnboardingStatus;
  /** Rolling uptime / sync health percentage, 0-100. */
  syncHealthPct: number;
  connectedSince: string;
  lastEventAt: string;
  transactionCount?: number;
  contactName?: string;
  contactEmail?: string;
  appliedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
}

export interface NodeConnectionStatus {
  institutionId: string;
  apiLatencyMs: number;
  lastHeartbeatAt: string;
  status: HealthStatus;
}
