import { randomUUID } from "node:crypto";
import type { FraudDecisionRecord, RawTransactionInput } from "../domainTypes";
import { config } from "../config";
import { quantumClient, orchestrateInference } from "./quantumOrchestrationClient";
import { interpretQuantumResponse } from "./responseInterpretation";
import { runClassicalFallback } from "./classicalRuleEngine";
import { computeEnsembleScore } from "./ensembleEngine";
import { runStage1 } from "./featureEngineering";
import { runStage2 } from "./vectorStandardization";

/**
 * "Decision engine: Risk thresholds - institution policies -> SAFE / REVIEW
 * / FRAUD" (QBADS_Middleware_Flow_Structure.pdf, Section 2), fed either by
 * a successful quantum response - response-interpretation-calibrated, then
 * blended with the classical ML model into a genuine ensemble score
 * (ensembleEngine.ts) - or, on quantum failure, by the classical rule
 * engine fallback directly (Section 3). Those two classical components are
 * not the same thing: classicalMlModel.ts (via ensembleEngine.ts) is a
 * fraud-scoring model that blends into the ensemble alongside quantum on
 * the success path; classicalRuleEngine.ts is the deterministic outage
 * fallback used only when quantum is unreachable. Both coexist below,
 * never conflated.
 *
 * This function is the full pipeline from raw input through to a decision:
 * Stage 1 + Stage 2 (Quantum_Ready_Feature_Pipeline doc) -> quantum
 * orchestration -> response interpretation + classical ML ensemble, or
 * classical rule engine fallback -> thresholding.
 */
export interface PipelineOutcome {
  decision: FraudDecisionRecord;
  warnings: string[];
  qubitCost: number;
  dimensionalityReduced: boolean;
  /** Stage 1's cleaned/imputed record - every one of the 30 fields has a concrete value. */
  record: RawTransactionInput;
}

function scoreToDecision(score: number): "SAFE" | "REVIEW" | "FRAUD" {
  if (score >= config.fraudThreshold) return "FRAUD";
  if (score >= config.reviewThreshold) return "REVIEW";
  return "SAFE";
}

export async function runFraudDetectionPipeline(
  txId: string,
  rawBody: Record<string, unknown>,
): Promise<PipelineOutcome> {
  const start = Date.now();
  const stage1 = runStage1(rawBody);
  const stage2 = runStage2(txId, stage1.normalized);
  const record = stage1.record as RawTransactionInput;

  try {
    const quantumResult = await orchestrateInference(quantumClient, stage2);
    const interpreted = interpretQuantumResponse(record, quantumResult);

    // Real ensemble (per the architecture spec's "AI & quantum detection
    // engine" diagram): blend the quantum model's (rule-calibrated) score
    // with the classical ML model's score, rather than passing the quantum
    // score through untouched. Stage 1's normalized features (pre-PCA,
    // fixed shape) feed the classical model, same as at training time.
    const ensemble = computeEnsembleScore(interpreted.riskScore, interpreted.confidence, stage1.normalized);

    const decision: FraudDecisionRecord = {
      txId,
      institutionId: record.institutionId,
      riskScore: ensemble.riskScore,
      riskLevel: ensemble.riskLevel,
      decision: scoreToDecision(ensemble.riskScore),
      confidence: ensemble.confidence,
      modelVersion: quantumResult.modelVersion,
      source: "quantum_model",
      decidedAt: new Date().toISOString(),
      decisionHash: randomUUID(),
      pipelineLatencyMs: Date.now() - start,
      quantumComponentScore: ensemble.quantumComponentScore,
      classicalMlComponentScore: ensemble.classicalComponentScore,
      classicalMlConfidence: ensemble.classicalConfidence,
      ensembleWeights: ensemble.weights,
    };

    return {
      decision,
      warnings: stage1.warnings,
      qubitCost: stage2.qubitCost,
      dimensionalityReduced: stage2.dimensionalityReduced,
      record,
    };
  } catch (err) {
    // Quantum Model API timed out or is unavailable - never block the
    // transaction, fall through to the deterministic classical path.
    const fallback = runClassicalFallback(record);
    const decision: FraudDecisionRecord = {
      txId,
      institutionId: record.institutionId,
      riskScore: fallback.riskScore,
      riskLevel: fallback.riskLevel,
      decision: fallback.decision,
      confidence: 0.5,
      modelVersion: "classical-fallback-v1",
      source: "classical_fallback",
      decidedAt: new Date().toISOString(),
      decisionHash: randomUUID(),
      pipelineLatencyMs: Date.now() - start,
    };

    return {
      decision,
      warnings: [...stage1.warnings, `quantum model unavailable (${(err as Error).message}), used classical fallback`],
      qubitCost: stage2.qubitCost,
      dimensionalityReduced: stage2.dimensionalityReduced,
      record,
    };
  }
}
