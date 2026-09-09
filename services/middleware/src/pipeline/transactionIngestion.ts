import { randomUUID, createHash } from "node:crypto";
import { store } from "../store/inMemoryStore";
import { runFraudDetectionPipeline, type PipelineOutcome } from "./decisionEngine";
import { recordDecisionOnChain, recordTransactionOnChain } from "../integrations/blockchainClient";
import type { StoredTransaction } from "../domainTypes";

/**
 * Output-routing side of the pipeline (QBADS_Middleware_Flow_Structure.pdf
 * Section 2's final stage): runs Stage 1/2 + quantum-or-fallback + decision
 * (runFraudDetectionPipeline), then persists the result, pushes the live
 * feed, and fires the best-effort blockchain write-back.
 *
 * This is the single shared implementation for "a real record actually
 * being ingested", called from exactly one place -
 * streaming/transactionConsumer.ts, the subscriber on qbads.transactions.raw
 * - so both POST /transactions and POST /transactions/batch (which just
 * publish to that topic and await the correlated result) go through
 * identical processing, and neither duplicates this logic.
 */
export async function processIngestedTransaction(txId: string, rawBody: Record<string, unknown>): Promise<PipelineOutcome> {
  const outcome = await runFraudDetectionPipeline(txId, rawBody);
  const record = outcome.record;

  const storedTx: StoredTransaction = {
    ...record,
    txId,
    chainConfirmed: false,
  };
  store.addTransaction(storedTx);
  store.addDecision(outcome.decision);

  if (outcome.warnings.length > 0) {
    store.pushPipelineWarning({
      txId,
      institutionId: record.institutionId,
      warnings: outcome.warnings,
      occurredAt: new Date().toISOString(),
    });
  }

  const institution = store.institutions.get(record.institutionId);
  store.pushLiveFeedEvent({
    id: randomUUID(),
    transactionId: txId,
    institutionName: institution?.name ?? record.institutionId,
    chainStatus: "pending",
    riskLevel: outcome.decision.riskLevel,
    riskScore: outcome.decision.riskScore,
    occurredAt: outcome.decision.decidedAt,
  });

  // Fire-and-forget: a slow or unreachable blockchain gateway must never
  // add latency to the pipeline result the Node API is waiting on (see
  // blockchainClient.ts).
  const payloadHash = createHash("sha256").update(JSON.stringify(rawBody)).digest("hex");
  void recordTransactionOnChain(storedTx, payloadHash)
    .then((ok) => ok && recordDecisionOnChain(outcome.decision))
    .then((ok) => {
      if (ok) storedTx.chainConfirmed = true;
    });

  return outcome;
}
