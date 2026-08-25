import type { QuantumInferenceResult, RawTransactionInput } from "../domainTypes";
import { runClassicalFallback } from "./classicalRuleEngine";

/**
 * "Response interpretation: Validate - combine with classical rules -
 * calibrate confidence" (QBADS_Middleware_Flow_Structure.pdf, Section 2).
 * Runs only on a successful quantum response - it's a sanity check on the
 * quantum model, not the failure-path fallback (that's
 * classicalRuleEngine.ts invoked directly when the quantum call fails).
 */
export interface InterpretedResult {
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  confidence: number;
}

const DISAGREEMENT_THRESHOLD = 40;
const CLASSICAL_BLEND_WEIGHT = 0.2;

export function interpretQuantumResponse(record: RawTransactionInput, quantum: QuantumInferenceResult): InterpretedResult {
  const classical = runClassicalFallback(record);
  const disagreement = Math.abs(quantum.anomalyScore - classical.riskScore);

  const blendedScore = quantum.anomalyScore * (1 - CLASSICAL_BLEND_WEIGHT) + classical.riskScore * CLASSICAL_BLEND_WEIGHT;
  const calibratedConfidence = disagreement > DISAGREEMENT_THRESHOLD ? Math.max(0.3, quantum.confidence - 0.15) : quantum.confidence;

  const riskScore = Math.min(100, Math.max(0, blendedScore));
  const riskLevel = riskScore > 65 ? "high" : riskScore > 30 ? "medium" : "low";

  return { riskScore, riskLevel, confidence: calibratedConfidence };
}
