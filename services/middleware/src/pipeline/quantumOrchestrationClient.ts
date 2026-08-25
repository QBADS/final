import type { QuantumInferenceResult, QuantumReadyVector } from "../domainTypes";
import { config } from "../config";

/**
 * "Quantum orchestration client: Build payload - select model version -
 * retries/timeouts" + "-> Quantum Model API (Input)" from
 * QBADS_Middleware_Flow_Structure.pdf Section 2.
 *
 * services/quantum-pipeline is now a real service (Qiskit QSVM/QNN/VQC) -
 * HttpQuantumModelClient below talks to it. MockQuantumModelClient stays
 * available (QUANTUM_CLIENT_MODE=mock) for local dev without Python/Qiskit
 * running.
 */
export interface QuantumModelClient {
  infer(vector: QuantumReadyVector): Promise<QuantumInferenceResult>;
}

interface EngineInferenceResponse {
  quantumInferenceId: string;
  anomalyScore: number; // 0.0-1.0, per Quantum_Engine_Base_Architecture.pdf's post-processing step
  riskLevel: "low" | "medium" | "high";
  modelType: "QSVM" | "QNN" | "VQC";
  modelVersion: string;
  confidence: number;
  latencyMs: number;
}

/** Calls the real services/quantum-pipeline engine over HTTP. */
export class HttpQuantumModelClient implements QuantumModelClient {
  async infer(vector: QuantumReadyVector): Promise<QuantumInferenceResult> {
    const res = await fetch(`${config.quantumEngineUrl}/infer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recordId: vector.recordId, vector: vector.flat }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`quantum engine responded ${res.status}: ${body}`);
    }
    const data = (await res.json()) as EngineInferenceResponse;
    return {
      // The engine reports 0.0-1.0; the rest of the pipeline (decisionEngine.ts,
      // classicalRuleEngine.ts) works in 0-100 to line up with config.fraudThreshold etc.
      anomalyScore: data.anomalyScore * 100,
      riskLevel: data.riskLevel,
      confidence: data.confidence,
      modelVersion: data.modelVersion,
      modelFamily: data.modelType,
      latencyMs: data.latencyMs,
    };
  }
}

// Fields whose normalized value scales risk up; mfaUsed scales it down
// (presence of MFA is protective) so it's weighted separately below.
const RISK_WEIGHTED_FIELDS = new Set(["amount", "crossBorderFlag", "newDeviceFlag", "merchantCategory"]);
const PROTECTIVE_FIELDS = new Set(["mfaUsed"]);

export class MockQuantumModelClient implements QuantumModelClient {
  async infer(vector: QuantumReadyVector): Promise<QuantumInferenceResult> {
    const start = Date.now();
    const latency = 60 + Math.random() * 180;
    await new Promise((resolve) => setTimeout(resolve, latency));

    if (Math.random() < config.quantumFailureRate) {
      throw new Error("mock quantum backend unavailable");
    }

    let weightedSum = 0;
    let weightTotal = 0;
    for (const feature of vector.features) {
      const avg = feature.values.reduce((a, b) => a + b, 0) / Math.max(feature.values.length, 1);
      const normalized = feature.encoding === "angle" ? avg / Math.PI : avg;

      if (PROTECTIVE_FIELDS.has(feature.name)) {
        const weight = 1.5;
        weightedSum += (1 - normalized) * weight;
        weightTotal += weight;
      } else {
        const weight = RISK_WEIGHTED_FIELDS.has(feature.name) ? 2 : 0.4;
        weightedSum += normalized * weight;
        weightTotal += weight;
      }
    }

    const anomalyScore = Math.min(100, Math.max(0, (weightedSum / Math.max(weightTotal, 1)) * 100));
    const riskLevel = anomalyScore > 65 ? "high" : anomalyScore > 30 ? "medium" : "low";

    return {
      anomalyScore,
      riskLevel,
      confidence: 0.72 + Math.random() * 0.25,
      modelVersion: "mock-v0.1",
      modelFamily: "VQC",
      latencyMs: Date.now() - start,
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`quantum inference timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function orchestrateInference(
  client: QuantumModelClient,
  vector: QuantumReadyVector,
): Promise<QuantumInferenceResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.quantumMaxRetries; attempt++) {
    try {
      return await withTimeout(client.infer(vector), config.quantumTimeoutMs);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("quantum inference failed");
}

export const quantumClient: QuantumModelClient =
  config.quantumClientMode === "mock" ? new MockQuantumModelClient() : new HttpQuantumModelClient();
