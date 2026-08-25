# Middleware ("Midway")

Status: **built and running, wired to a real Quantum Engine and to both
dashboards.** Node API, Dashboard API, the full internal pipeline, the
classical fallback, and a best-effort Blockchain API client are all
implemented and verified end to end (see below). `services/quantum-pipeline`
is real now too (Qiskit QSVM/QNN/VQC) - `QUANTUM_CLIENT_MODE=mock` still
switches back to an in-process heuristic client for local dev without
Python running.

Reference: `QBADS_Middleware_Flow_Structure.pdf`, `Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf`.

## Structure

```
src/
  config.ts                          thresholds, timeouts, qubit budget, blockchain gateway URL
  domainTypes.ts                    middleware's own domain model
  auth.ts                              Node API key auth
  server.ts                           API Gateway: mounts Node API + Dashboard API
  store/inMemoryStore.ts       institutions, transactions, decisions, feedback, live feed, auth/pipeline events
  pipeline/
    featureEngineering.ts        Stage 1: validate, classify, clean/impute, normalize
    vectorStandardization.ts   Stage 2: dimensionality reduction, quantum encoding, assembly
    quantumOrchestrationClient.ts    retries/timeout + mock QSVM/QNN/VQC client
    responseInterpretation.ts   calibrates a successful quantum response against classical rules
    classicalRuleEngine.ts        deterministic fallback (SAFE/REVIEW/HOLD)
    decisionEngine.ts               ties Stage 1 -> Stage 2 -> quantum-or-fallback -> thresholds
    federatedLearning.ts            feedback aggregation
  integrations/
    blockchainClient.ts             best-effort calls to services/blockchain/gateway
    platformHealthClient.ts     best-effort reads of the Quantum Engine's and Blockchain gateway's own /health
  metrics.ts                          real request-count/latency tracking for the Dashboard API's platform-health
  routes/
    nodeApi.ts, dashboardApi.ts
```

## Running

```bash
npm install
npm run build && npm start   # :4000
```

```bash
curl -X POST localhost:4000/api/node/transactions \
  -H "x-api-key: qbads_sandbox_novafintech" -H "content-type: application/json" \
  -d '{"amount":42000,"currency":"USD","accountAgeDays":2,"paymentChannel":"crypto","crossBorderFlag":true,"newDeviceFlag":true,"mfaUsed":false}'

curl localhost:4000/api/dashboard/kpis
curl localhost:4000/api/dashboard/institutions
curl localhost:4000/api/dashboard/platform-health
curl localhost:4000/api/dashboard/live-feed   # SSE
```

Sandbox API keys (seeded in `store/inMemoryStore.ts`, one per institution):
`qbads_sandbox_banka` (First Meridian Bank), `qbads_sandbox_novafintech`
(Nova Fintech - what `apps/node-dashboard` uses by default),
`qbads_sandbox_vaultpay` (VaultPay Wallet), `qbads_sandbox_orbit` (Orbit
Insurance), `qbads_sandbox_zenith` (Zenith Mobile Money, seeded `offline`),
`qbads_sandbox_atlas` (Atlas Exchange), `qbads_sandbox_helios` (Helios
Gateway, a payment processor).

Dashboard API routes in full: `/kpis`, `/fraud-stats`, `/institutions`,
`/institutions/:id`, `/transactions` (filterable by `institutionId`,
`decision`, `riskLevel` - powers Company Dash's Transaction centre / Fraud
detection / Case management), `/platform-health`, `/quantum-info` (full
model roster), `/blockchain-info`, `/security` (real auth-failure log +
masked keys), `/config` (non-secret runtime thresholds),
`/feature-pipeline` (Stage 1's field classification + recent warnings),
`/ticker`, `/volume-series`, `/model-performance`, `/live-feed` (SSE). All
unauthenticated - see "Not done here."

## What's real vs. mocked

| Piece | Status |
|---|---|
| Node API auth, ingest, query, feedback | Real |
| Stage 1 feature engineering (validate/classify/impute/normalize) | Real, per the doc's 1.2-1.5 |
| Stage 2 vector standardization (encoding, assembly) | Real, per the doc's 2.2-2.3 |
| Stage 2 dimensionality reduction (2.1) | Placeholder - collapses low-priority feature groups when over the qubit budget; **not real PCA**, which needs a covariance matrix fitted on historical data that doesn't exist yet |
| Quantum orchestration (retries, timeout) | Real |
| Quantum inference itself | Real by default (`HttpQuantumModelClient` calls `services/quantum-pipeline`) - `MockQuantumModelClient` (heuristic scorer, same interface) is still there behind `QUANTUM_CLIENT_MODE=mock` for local dev without Python running |
| Response interpretation, classical fallback, decision engine | Real |
| Blockchain write-back | Real client, calls `services/blockchain/gateway` - but that network isn't deployed yet (see its README), so writes currently log a warning and no-op rather than blocking the transaction |
| Dashboard API | Real, backed by actual in-memory state from submitted transactions - not random mock data. Both dashboards (`apps/company-dashboard`, `apps/node-dashboard`) are wired to it now, not their own mocks |
| `platform-health` reachability/model/blockchain fields | Real reads of downstream services' own `/health` - honestly reports "unreachable" rather than a fabricated number when one is down |
| `platform-health` resource fields | Real, but scoped to this Node process (heap/RSS) - not host-wide CPU/RAM, which nothing in this repo actually monitors |
| Federated learning | Aggregation is real (computed from actual feedback); there's no model to push parameters back to yet |
| `/security` auth-failure log | Real - `auth.ts` records every rejected Node API request (missing/invalid key), not a simulated feed |
| `/feature-pipeline` field config + warnings | Real - it's `featureEngineering.ts`'s actual `FIELD_CONFIG` and genuine Stage 1 imputation/quarantine warnings from live submissions |
| `/quantum-info`, `/blockchain-info` | Real passthrough of each service's own state - honestly reports unreachable/empty rather than fabricating a roster |

## Not done here

- A proper 30-field transaction schema - the feature-pipeline doc references
  "the 30 core attributes defined earlier" without listing them, so
  `RawTransactionInput` is a representative schema spanning every documented
  data type (continuous, categorical low/high-cardinality, binary, hashed,
  timestamp), not the literal 30 fields.
- Persistent storage (everything resets on restart - including the request
  metrics `metrics.ts` reports and the transactions `platform-health`/`kpis`
  are computed from).
- Session auth in front of the Dashboard API (currently open - both
  dashboards call it directly with no login flow; Node Dash is instead
  fixed to reading one seeded institution's data, see its own README).

