import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { requireDashboardSession, requireExecAdmin } from "./auth/dashboardAuth";
import { nodeApiRouter } from "./routes/nodeApi";
import { dashboardApiRouter } from "./routes/dashboardApi";
import { quantumJobsRouter } from "./routes/quantumJobsApi";
import { requestMetricsMiddleware } from "./metrics";
import { requestIdMiddleware } from "./middleware/requestId";
import { startTransactionConsumer } from "./streaming/transactionConsumer";

/**
 * "API Gateway (entry layer): AuthN/AuthZ - routes all four APIs"
 * (QBADS_Middleware_Flow_Structure.pdf, Section 2). The Blockchain API and
 * Quantum Model API are outbound-only from Middleware's side (see
 * integrations/blockchainClient.ts and pipeline/quantumOrchestrationClient.ts)
 * so they have no inbound routes here - only Node API and Dashboard API do.
 */
export const app = express();
app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(requestMetricsMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "qbads-middleware" });
});

app.use("/api/node", nodeApiRouter);
app.use("/api/dashboard", dashboardApiRouter);
// First versioned API prefix in this repo - deliberate, for the IBM
// Quantum job-management feature only (see routes/quantumJobsApi.ts).
app.use("/api/v1/quantum", requireDashboardSession, requireExecAdmin, quantumJobsRouter);

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[${req.requestId}]`, err);
  const status = err.name === "QuarantineError" ? 422 : err.name === "QuantumProviderUnavailableError" ? 503 : 500;
  res.status(status).json({ error: err.message, requestId: req.requestId });
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

// Guarded so importing `app` for route tests never starts a real Kafka
// consumer or opens a real port. Vitest sets process.env.VITEST for every
// test run (documented behavior) - checking that, rather than
// require.main === module, works whether the test file is transformed to
// CJS or ESM, unlike the require.main idiom.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("[server] fatal startup error", err);
    process.exit(1);
  });
}
