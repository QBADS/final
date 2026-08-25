import type { FraudDecisionRecord, StoredTransaction } from "../domainTypes";
import { config } from "../config";

/**
 * Client for the Blockchain API (QBADS_Middleware_Flow_Structure.pdf,
 * Section 1: "Fabric chaincode events in; decision hash, risk class, model
 * version out - Consume trusted transaction events; write auditable fraud
 * decisions back on-chain"). Talks to services/blockchain/gateway, which is
 * the Fabric network's own documented gateway boundary.
 *
 * Writes are best-effort: the network may not be deployed (see
 * services/blockchain/README.md), and per the Middleware doc's
 * "deterministic under failure" principle, a chain write failing should
 * never block the transaction response back to the submitting node.
 */

async function post(path: string, body: unknown): Promise<boolean> {
  if (!config.blockchainWriteEnabled) return false;
  try {
    const res = await fetch(`${config.blockchainGatewayUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`[blockchainClient] ${path} responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[blockchainClient] ${path} unreachable: ${(err as Error).message}`);
    return false;
  }
}

export async function recordTransactionOnChain(tx: StoredTransaction, payloadHash: string): Promise<boolean> {
  return post("/api/transactions", {
    txId: tx.txId,
    institutionId: tx.institutionId,
    amount: tx.amount,
    currency: tx.currency,
    payloadHash,
    submittedAt: tx.submittedAt,
  });
}

export async function recordDecisionOnChain(decision: FraudDecisionRecord): Promise<boolean> {
  return post(`/api/transactions/${decision.txId}/decision`, {
    riskScore: decision.riskScore,
    riskLevel: decision.riskLevel,
    decision: decision.decision,
    confidence: decision.confidence,
    modelVersion: decision.modelVersion,
    decisionHash: decision.decisionHash,
    decidedAt: decision.decidedAt,
  });
}
