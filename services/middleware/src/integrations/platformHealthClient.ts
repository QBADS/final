import { config } from "../config";

/**
 * Best-effort reads of the two downstream services' own health endpoints,
 * for the Dashboard API's platform-health response
 * (routes/dashboardApi.ts). Neither call blocks or fails the dashboard
 * request if a service is down - it just reports that honestly instead of
 * fabricating numbers, same "deterministic under failure" principle as
 * pipeline/quantumOrchestrationClient.ts and integrations/blockchainClient.ts.
 */

async function safeGetJson(url: string, timeoutMs = 2500): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface QuantumEngineHealth {
  reachable: boolean;
  championModelFamily: "QSVM" | "QNN" | "VQC" | null;
  championModelVersion: string | null;
  trainedOn: string | null;
}

export async function getQuantumEngineHealth(): Promise<QuantumEngineHealth> {
  const health = await safeGetJson(`${config.quantumEngineUrl}/health`);
  if (!health || health.status !== "ok") {
    return { reachable: false, championModelFamily: null, championModelVersion: null, trainedOn: null };
  }

  const champion = health.champion as string | null;
  const models = await safeGetJson(`${config.quantumEngineUrl}/models`);
  const modelList = Array.isArray(models) ? (models as Array<Record<string, unknown>>) : [];
  const championEntry = modelList.find((m) => m.modelType === champion);

  return {
    reachable: true,
    championModelFamily: (champion as QuantumEngineHealth["championModelFamily"]) ?? null,
    championModelVersion: (championEntry?.modelVersion as string) ?? null,
    trainedOn: (championEntry?.trainedOn as string) ?? null,
  };
}

export interface QuantumEngineModel {
  modelType: "QSVM" | "QNN" | "VQC";
  modelVersion: string;
  featureDimension: number;
  trainedOn: string;
  bootstrapSamples: number;
}

/** Full model roster (all three families, not just the champion) - for a dedicated "Quantum computing" detail view. */
export async function getQuantumEngineModels(): Promise<QuantumEngineModel[] | null> {
  const models = await safeGetJson(`${config.quantumEngineUrl}/models`);
  return Array.isArray(models) ? (models as unknown as QuantumEngineModel[]) : null;
}

export interface BlockchainHealth {
  reachable: boolean;
  channel: string | null;
  chaincode: string | null;
}

export async function getBlockchainHealth(): Promise<BlockchainHealth> {
  const health = await safeGetJson(`${config.blockchainGatewayUrl}/health`);
  if (!health || health.status !== "ok") {
    return { reachable: false, channel: null, chaincode: null };
  }
  return {
    reachable: true,
    channel: (health.channel as string) ?? null,
    chaincode: (health.chaincode as string) ?? null,
  };
}
