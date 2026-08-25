import type { RawTransactionInput } from "../domainTypes";

/**
 * "Classical rule engine: Deterministic, rule-based fallback logic" ->
 * "SAFE / REVIEW / HOLD - Always returns a decision, never a silent
 * failure" (QBADS_Middleware_Flow_Structure.pdf, Section 3). Runs only when
 * the Quantum Model API times out or is unavailable
 * (quantumOrchestrationClient.ts exhausts its retries).
 */
export interface ClassicalFallbackResult {
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  decision: "SAFE" | "REVIEW" | "HOLD";
}

const LARGE_AMOUNT_THRESHOLD = 5_000;

export function runClassicalFallback(record: RawTransactionInput): ClassicalFallbackResult {
  let score = 10;

  if (record.amount > LARGE_AMOUNT_THRESHOLD) score += 25;
  if (record.crossBorderFlag) score += 15;
  if (record.newDeviceFlag) score += 20;
  if (!record.mfaUsed) score += 15;
  if (record.accountAgeDays < 7) score += 20;

  score = Math.min(100, score);
  const riskLevel = score > 60 ? "high" : score > 30 ? "medium" : "low";

  // The fallback never claims FRAUD outright - without the quantum model's
  // confidence it can only flag for human review or hold the transaction.
  const decision = score > 60 ? "HOLD" : score > 30 ? "REVIEW" : "SAFE";

  return { riskScore: score, riskLevel, decision };
}
