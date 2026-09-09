import type { NormalizedFeature } from "../domainTypes";
import { config } from "../config";
import { scoreClassical } from "./classicalMlModel";

/**
 * The real ensemble the architecture spec's "AI & quantum detection engine"
 * diagram calls for: on the quantum-success path, the final anomaly score is
 * a genuine weighted blend of the quantum model's score and a classical ML
 * model's score (classicalMlModel.ts - logistic regression), not a
 * pass-through of the quantum score alone. This runs only when the quantum
 * engine answered - it has nothing to do with classicalRuleEngine.ts, which
 * stays exactly as it was: the deterministic fallback used only when the
 * quantum engine times out/is unreachable (decisionEngine.ts calls that
 * directly, in its catch branch, never through here).
 */
export interface EnsembleResult {
  /** Final 0-100 blended score - what thresholding (decisionEngine.ts's scoreToDecision) actually runs on. */
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  /** Weighted blend of the quantum and classical confidences. */
  confidence: number;
  /** The quantum model's own (already response-interpretation-calibrated) 0-100 score, for transparency. */
  quantumComponentScore: number;
  /** The classical ML model's own 0-100 score, for transparency. */
  classicalComponentScore: number;
  classicalConfidence: number;
  weights: { quantum: number; classicalMl: number };
}

/**
 * Quantum is weighted higher (config.ensembleQuantumWeight, default 0.75)
 * than the classical ML component (config.ensembleClassicalWeight, default
 * 0.25) because quantum inference is this system's primary signal per the
 * architecture spec - the classical model acts as a corroborating,
 * fast-to-compute sanity check that pulls the score when it disagrees
 * strongly with quantum, rather than as a coequal vote. Both weights are
 * configurable via src/config.ts / env vars for tuning without a redeploy.
 */
export function computeEnsembleScore(
  quantumScore: number,
  quantumConfidence: number,
  normalized: NormalizedFeature[],
): EnsembleResult {
  const qWeight = config.ensembleQuantumWeight;
  const cWeight = config.ensembleClassicalWeight;

  let classical: { score: number; confidence: number };
  try {
    classical = scoreClassical(normalized);
  } catch (err) {
    // Never let the classical ML component's failure take down the
    // quantum-success path - fall back to the quantum score alone (full
    // weight) rather than propagate.
    console.warn(`[ensembleEngine] classical model scoring failed (${(err as Error).message}), using quantum score alone`);
    classical = { score: quantumScore, confidence: quantumConfidence };
  }

  const riskScore = Math.min(100, Math.max(0, qWeight * quantumScore + cWeight * classical.score));
  const confidence = Math.min(1, Math.max(0, qWeight * quantumConfidence + cWeight * classical.confidence));
  const riskLevel = riskScore > 65 ? "high" : riskScore > 30 ? "medium" : "low";

  return {
    riskScore,
    riskLevel,
    confidence,
    quantumComponentScore: quantumScore,
    classicalComponentScore: classical.score,
    classicalConfidence: classical.confidence,
    weights: { quantum: qWeight, classicalMl: cWeight },
  };
}
