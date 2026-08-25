import { randomUUID } from "node:crypto";
import type { FraudDecisionRecord, RawTransactionInput } from "../domainTypes";
import { config } from "../config";
import { quantumClient, orchestrateInference } from "./quantumOrchestrationClient";
import { interpretQuantumResponse } from "./responseInterpretation";
import { runClassicalFallback } from "./classicalRuleEngine";
import { runStage1 } from "./featureEngineering";
import { runStage2 } from "./vectorStandardization";

/**
 * "Decision engine: Risk thresholds - institution policies -> SAFE / REVIEW
 * / FRAUD" (QBADS_Middleware_Flow_Structure.pdf, Section 2), fed either by
 * a successful quantum response (via responseInterpretation.ts) or, on
 * quantum failure, by the classical fallback directly (Section 3).
 *
 * This function is the full pipeline from raw input through to a decision:
 * Stage 1 + Stage 2 (Quantum_Ready_Feature_Pipeline doc) -> quantum
 * orchestration -> response interpretation or fallback -> thresholding.
 */
export interface PipelineOutcome {
  decision: FraudDecisionRecord;
  warnings: string[];
  qubitCost: number;
  dimensionalityReduced: boolean;
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

    const decision: FraudDecisionRecord = {
      txId,
      institutionId: record.institutionId,
      riskScore: interpreted.riskScore,
      riskLevel: interpreted.riskLevel,
      decision: scoreToDecision(interpreted.riskScore),
      confidence: interpreted.confidence,
      modelVersion: quantumResult.modelVersion,
      source: "quantum_model",
      decidedAt: new Date().toISOString(),
      decisionHash: randomUUID(),
      pipelineLatencyMs: Date.now() - start,
    };

    return { decision, warnings: stage1.warnings, qubitCost: stage2.qubitCost, dimensionalityReduced: stage2.dimensionalityReduced };
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
    };
  }
}
