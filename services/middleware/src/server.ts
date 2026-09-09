import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { nodeApiRouter } from "./routes/nodeApi";
import { dashboardApiRouter } from "./routes/dashboardApi";
import { requestMetricsMiddleware } from "./metrics";
import { startTransactionConsumer } from "./streaming/transactionConsumer";

/**
 * "API Gateway (entry layer): AuthN/AuthZ - routes all four APIs"
 * (QBADS_Middleware_Flow_Structure.pdf, Section 2). The Blockchain API and
 * Quantum Model API are outbound-only from Middleware's side (see
 * integrations/blockchainClient.ts and pipeline/quantumOrchestrationClient.ts)
 * so they have no inbound routes here - only Node API and Dashboard API do.
 */
const app = express();
app.use(cors());
app.use(express.json());
app.use(requestMetricsMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "qbads-middleware" });
});

app.use("/api/node", nodeApiRouter);
app.use("/api/dashboard", dashboardApiRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = err.name === "QuarantineError" ? 422 : 500;
  res.status(status).json({ error: err.message });
});

async function main() {
  // Start the streaming subscriber before accepting HTTP traffic - the Node
  // API's ingest handlers publish onto qbads.transactions.raw and await
  // this consumer's result, so it must already be subscribed by the time
  // the first request can arrive.
  await startTransactionConsumer();

  app.listen(config.port, () => {
    console.log(`QBADS middleware listening on :${config.port}`);
    console.log(`  quantum timeout=${config.quantumTimeoutMs}ms retries=${config.quantumMaxRetries} failureRate=${config.quantumFailureRate}`);
    console.log(`  thresholds review>=${config.reviewThreshold} fraud>=${config.fraudThreshold}`);
    console.log(`  blockchain gateway=${config.blockchainGatewayUrl} writesEnabled=${config.blockchainWriteEnabled}`);
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error", err);
  process.exit(1);
});
