import { Router } from "express";
import { randomUUID } from "node:crypto";
import { store } from "../store/inMemoryStore";
import { requireNodeAuth } from "../auth";
import { broker, TOPICS } from "../streaming";
import { registerPendingResult } from "../streaming/pendingResults";
import { config } from "../config";
import type { PipelineOutcome } from "../pipeline/decisionEngine";
import type { Institution } from "../domainTypes";

/**
 * Node API (QBADS_Middleware_Flow_Structure.pdf, Section 1): "Signed
 * transactions from banks / fintechs / wallets (nodes N1-N4) - Ingest raw
 * transaction submissions; return acknowledgment and query access."
 *
 * Ingestion now goes through the streaming boundary (system architecture
 * doc: API gateway -> Streaming platform -> Validation & cleaning ->
 * Feature engineering) instead of calling the pipeline in-process: this
 * layer publishes onto qbads.transactions.raw and awaits the correlated
 * result from the subscriber (streaming/transactionConsumer.ts), which
 * runs the actual pipeline and output-routing
 * (pipeline/transactionIngestion.ts). The HTTP contract is unchanged - both
 * dashboards still get a synchronous decision back from POST
 * /transactions.
 */
export const nodeApiRouter = Router();

nodeApiRouter.use(requireNodeAuth);

const BATCH_LIMIT = 100;

interface SubmitResult {
  txId: string;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Shared single-record submission path - used directly by POST
 * /transactions, and once per record (in parallel) by POST
 * /transactions/batch. A validation failure on one record surfaces as a
 * non-2xx `status` here; it never throws past this function, so one bad
 * record in a batch can't abort the others.
 */
async function submitTransaction(institution: Institution, rawBody: Record<string, unknown>): Promise<SubmitResult> {
  const txId = typeof rawBody.txId === "string" && rawBody.txId ? rawBody.txId : `TX-${randomUUID().slice(0, 8)}`;

  if (store.transactions.has(txId)) {
    return { txId, status: 409, body: { error: `transaction ${txId} already submitted` } };
  }

  const body = { ...rawBody, txId, institutionId: institution.id };
  const messageId = randomUUID();

  try {
    // Register the correlation slot *before* publishing so the subscriber
    // can never resolve it before we start waiting (registerPendingResult's
    // promise executor runs synchronously).
    const resultPromise = registerPendingResult<PipelineOutcome>(messageId, config.streamingResponseTimeoutMs);
    await broker.publish(TOPICS.TRANSACTIONS_RAW, { messageId, txId, body });
    const outcome = await resultPromise;

    return {
      txId,
      status: 201,
      body: {
        txId,
        decision: outcome.decision.decision,
        riskScore: outcome.decision.riskScore,
        riskLevel: outcome.decision.riskLevel,
        confidence: outcome.decision.confidence,
        source: outcome.decision.source,
        warnings: outcome.warnings,
        qubitCost: outcome.qubitCost,
        dimensionalityReduced: outcome.dimensionalityReduced,
      },
    };
  } catch (err) {
    const status = (err as Error).name === "QuarantineError" ? 422 : 500;
    return { txId, status, body: { error: (err as Error).message } };
  }
}

nodeApiRouter.post("/transactions", async (req, res, next) => {
  try {
    const institution = req.institution!;
    const result = await submitTransaction(institution, req.body ?? {});
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

/**
 * Batch ingestion (Middleware doc: the Node API "accepts a single record or
 * a small batch per call"). Body: { transactions: RawTransactionInput[] },
 * capped at BATCH_LIMIT. Every record runs through the same
 * validation/pipeline/decision path as the single-record endpoint
 * (submitTransaction above) independently, in parallel; the response is a
 * 207 Multi-Status with one success-or-failure result per record, in
 * submission order.
 */
nodeApiRouter.post("/transactions/batch", async (req, res, next) => {
  try {
    const institution = req.institution!;
    const records: unknown = req.body?.transactions;

    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ error: "body must be { transactions: RawTransactionInput[] } with at least one record" });
      return;
    }
    if (records.length > BATCH_LIMIT) {
      res.status(400).json({ error: `batch too large: ${records.length} records, max ${BATCH_LIMIT} per call` });
      return;
    }

    const results = await Promise.all(
      records.map((record): Promise<SubmitResult> => {
        if (typeof record !== "object" || record === null || Array.isArray(record)) {
          return Promise.resolve({ txId: "", status: 422, body: { error: "each batch record must be an object" } });
        }
        return submitTransaction(institution, record as Record<string, unknown>);
      }),
    );

    res.status(207).json({
      total: results.length,
      succeeded: results.filter((r) => r.status < 400).length,
      failed: results.filter((r) => r.status >= 400).length,
      results: results.map((r) => ({ success: r.status < 400, status: r.status, txId: r.txId || undefined, ...r.body })),
    });
  } catch (err) {
    next(err);
  }
});

nodeApiRouter.get("/transactions/:txId", (req, res) => {
  const institution = req.institution!;
  const tx = store.transactions.get(req.params.txId);
  if (!tx || tx.institutionId !== institution.id) {
    res.status(404).json({ error: "transaction not found" });
    return;
  }
  const decision = store.decisions.get(req.params.txId);
  res.json({ transaction: tx, decision: decision ?? null });
});

nodeApiRouter.post("/feedback", (req, res) => {
  const institution = req.institution!;
  const { txId, institutionVerdict, note } = req.body;
  if (!txId || !["confirmed_fraud", "confirmed_legitimate", "unresolved"].includes(institutionVerdict)) {
    res.status(400).json({ error: "txId and a valid institutionVerdict are required" });
    return;
  }
  const item = store.addFeedback({
    txId,
    institutionId: institution.id,
    institutionVerdict,
    note,
    submittedAt: new Date().toISOString(),
  });
  res.status(201).json(item);
});

nodeApiRouter.get("/status", (req, res) => {
  const institution = req.institution!;
  const myTransactions = [...store.transactions.values()].filter((t) => t.institutionId === institution.id);
  res.json({
    institution,
    requestsToday: myTransactions.length,
    lastEventAt: myTransactions.at(-1)?.submittedAt ?? null,
  });
});
