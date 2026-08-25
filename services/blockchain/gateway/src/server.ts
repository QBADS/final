import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { Contract } from "@hyperledger/fabric-gateway";
import { config } from "./config";
import { closeGateway, getContract, getNetwork } from "./fabricClient";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Submits a chaincode transaction and returns the same shape Table 3 of
 * QBADS_Hyperledger_Fabric_Architecture.pdf calls "Transaction status" +
 * "Transaction receipts": the Fabric transaction ID and committed/failed
 * state, not just the raw chaincode response.
 */
async function submitAndGetReceipt(contract: Contract, fn: string, args: string[]) {
  const proposal = contract.newProposal(fn, { arguments: args });
  const transaction = await proposal.endorse();
  const commit = await transaction.submit();
  const successful = await commit.getStatus();
  return {
    fabricTransactionId: commit.getTransactionId(),
    status: successful ? "committed" : "failed",
  };
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", channel: config.channelName, chaincode: config.chaincodeName, mspId: config.mspId });
});

// ---- Input gateway: transaction submission (REST API surface) ----

app.post(
  "/api/transactions",
  asyncHandler(async (req, res) => {
    const { txId, institutionId, amount, currency, payloadHash, submittedAt } = req.body;
    if (!txId || !institutionId || amount === undefined || !currency) {
      res.status(400).json({ error: "txId, institutionId, amount, currency are required" });
      return;
    }
    const receipt = await submitAndGetReceipt(getContract(), "CreateTransactionRecord", [
      txId,
      institutionId,
      String(amount),
      currency,
      payloadHash ?? "",
      submittedAt ?? new Date().toISOString(),
    ]);
    res.status(201).json(receipt);
  }),
);

app.post(
  "/api/transactions/:txId/decision",
  asyncHandler(async (req, res) => {
    const { txId } = req.params;
    const { riskScore, riskLevel, decision, confidence, modelVersion, decisionHash, decidedAt } = req.body;
    if (riskScore === undefined || !riskLevel || !decision || !modelVersion) {
      res.status(400).json({ error: "riskScore, riskLevel, decision, modelVersion are required" });
      return;
    }
    const receipt = await submitAndGetReceipt(getContract(), "RecordFraudDecision", [
      txId,
      String(riskScore),
      riskLevel,
      decision,
      String(confidence ?? 0),
      modelVersion,
      decisionHash ?? "",
      decidedAt ?? new Date().toISOString(),
    ]);
    res.status(201).json(receipt);
  }),
);

// ---- Output gateway: ledger query results ----

app.get(
  "/api/transactions/:txId",
  asyncHandler(async (req, res) => {
    const bytes = await getContract().evaluateTransaction("GetTransaction", req.params.txId);
    res.json(JSON.parse(bytes.toString()));
  }),
);

app.get(
  "/api/transactions/:txId/decision",
  asyncHandler(async (req, res) => {
    const bytes = await getContract().evaluateTransaction("GetDecision", req.params.txId);
    res.json(JSON.parse(bytes.toString()));
  }),
);

// Audit logs (Table 3: "Audit logs - Immutable trail for compliance and regulators")
app.get(
  "/api/transactions/:txId/audit-trail",
  asyncHandler(async (req, res) => {
    const bytes = await getContract().evaluateTransaction("GetTransactionAuditTrail", req.params.txId);
    res.json(JSON.parse(bytes.toString()));
  }),
);

app.get(
  "/api/institutions/:institutionId/transactions",
  asyncHandler(async (req, res) => {
    const bytes = await getContract().evaluateTransaction("QueryTransactionsByInstitution", req.params.institutionId);
    res.json(JSON.parse(bytes.toString()));
  }),
);

// Blockchain events / block notifications, streamed to Middleware as SSE.
app.get("/api/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const network = getNetwork();

  (async () => {
    const events = await network.getChaincodeEvents(config.chaincodeName);
    req.on("close", () => events.close());
    try {
      for await (const event of events) {
        res.write(
          `event: ${event.eventName}\ndata: ${JSON.stringify({
            eventName: event.eventName,
            transactionId: event.transactionId,
            blockNumber: event.blockNumber.toString(),
            payload: JSON.parse(Buffer.from(event.payload).toString()),
          })}\n\n`,
        );
      }
    } catch {
      // stream closed on client disconnect, or connection dropped
    }
  })();
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const server = app.listen(config.port, () => {
  console.log(`QBADS blockchain gateway listening on :${config.port} (channel=${config.channelName}, chaincode=${config.chaincodeName}, msp=${config.mspId})`);
});

process.on("SIGINT", () => {
  server.close();
  closeGateway();
  process.exit(0);
});
