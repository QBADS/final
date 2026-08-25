import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { store } from "../store/inMemoryStore";
import { requireNodeAuth } from "../auth";
import { runFraudDetectionPipeline } from "../pipeline/decisionEngine";
import { recordDecisionOnChain, recordTransactionOnChain } from "../integrations/blockchainClient";
import type { StoredTransaction } from "../domainTypes";

/**
 * Node API (QBADS_Middleware_Flow_Structure.pdf, Section 1): "Signed
 * transactions from banks / fintechs / wallets (nodes N1-N4) - Ingest raw
 * transaction submissions; return acknowledgment and query access."
 */
export const nodeApiRouter = Router();

nodeApiRouter.use(requireNodeAuth);

nodeApiRouter.post("/transactions", async (req, res, next) => {
  try {
    const institution = req.institution!;
    const txId = typeof req.body.txId === "string" && req.body.txId ? req.body.txId : `TX-${randomUUID().slice(0, 8)}`;

    if (store.transactions.has(txId)) {
      res.status(409).json({ error: `transaction ${txId} already submitted` });
      return;
    }

    const body = { ...req.body, txId, institutionId: institution.id };
    const outcome = await runFraudDetectionPipeline(txId, body);

    const storedTx: StoredTransaction = {
      txId,
      institutionId: institution.id,
      amount: Number(body.amount ?? 0),
      currency: String(body.currency ?? "USD"),
      submittedAt: String(body.submittedAt ?? new Date().toISOString()),
      chainConfirmed: false,
    };
    store.addTransaction(storedTx);
    store.addDecision(outcome.decision);
    if (outcome.warnings.length > 0) {
      store.pushPipelineWarning({
        txId,
        institutionId: institution.id,
        warnings: outcome.warnings,
        occurredAt: new Date().toISOString(),
      });
    }
    store.pushLiveFeedEvent({
      id: randomUUID(),
      transactionId: txId,
      institutionName: institution.name,
      chainStatus: "pending",
      riskLevel: outcome.decision.riskLevel,
      riskScore: outcome.decision.riskScore,
      occurredAt: outcome.decision.decidedAt,
    });

    // Fire-and-forget: a slow or unreachable blockchain gateway must never
    // add latency to the node's response (see blockchainClient.ts).
    const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    void recordTransactionOnChain(storedTx, payloadHash)
      .then((ok) => ok && recordDecisionOnChain(outcome.decision))
      .then((ok) => {
        if (ok) storedTx.chainConfirmed = true;
      });

    res.status(201).json({
      txId,
      decision: outcome.decision.decision,
      riskScore: outcome.decision.riskScore,
      riskLevel: outcome.decision.riskLevel,
      confidence: outcome.decision.confidence,
      source: outcome.decision.source,
      warnings: outcome.warnings,
      qubitCost: outcome.qubitCost,
      dimensionalityReduced: outcome.dimensionalityReduced,
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
