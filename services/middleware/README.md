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
  streaming/
    types.ts, inProcessBroker.ts, kafkaBroker.ts, index.ts   Kafka-compatible pub/sub (real kafkajs
                                                              when KAFKA_BROKERS is set, in-process
                                                              fallback otherwise - same interface)
    pendingResults.ts           correlates a published message with its subscriber's result
    transactionConsumer.ts    subscriber: consumes qbads.transactions.raw, runs the full pipeline
  pipeline/
    featureEngineering.ts        Stage 1: validate, classify, clean/impute, normalize
    vectorStandardization.ts   Stage 2: dimensionality reduction, quantum encoding, assembly
    pca.ts, pcaReducer.ts        real PCA (Jacobi eigen-decomposition) + rolling sample buffer for 2.1
    quantumOrchestrationClient.ts    retries/timeout + mock QSVM/QNN/VQC client
    responseInterpretation.ts   calibrates a successful quantum response against classical rules
    classicalRuleEngine.ts        deterministic fallback (SAFE/REVIEW/HOLD)
    decisionEngine.ts               ties Stage 1 -> Stage 2 -> quantum-or-fallback -> thresholds
    transactionIngestion.ts   output-routing: persist tx/decision, live feed, blockchain write-back
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
# any of the other 24 fields (merchantId, deviceTrustScore, country, ...) are optional -
# Stage 1 imputes sane defaults for whatever's missing.

curl -X POST localhost:4000/api/node/transactions/batch \
  -H "x-api-key: qbads_sandbox_novafintech" -H "content-type: application/json" \
  -d '{"transactions":[{"amount":120,"currency":"USD","paymentChannel":"card"},{"amount":9000,"currency":"USD","paymentChannel":"crypto","crossBorderFlag":true}]}'

TOKEN=$(curl -s -X POST localhost:4000/api/dashboard/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"exec-admin","password":"qbads-exec-admin-2026"}' | jq -r .token)

curl -H "authorization: Bearer $TOKEN" localhost:4000/api/dashboard/kpis
curl -H "authorization: Bearer $TOKEN" localhost:4000/api/dashboard/institutions
curl -H "authorization: Bearer $TOKEN" localhost:4000/api/dashboard/platform-health
curl "localhost:4000/api/dashboard/live-feed?token=$TOKEN"   # SSE - EventSource can't set headers, so token is a query param here
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
`/ticker`, `/volume-series`, `/model-performance`, `/live-feed` (SSE), plus
`/auth/login` and `/auth/logout`. All require a session bearer token except
`/auth/login` - see "Persistence and Dashboard session auth" below.

## What's real vs. mocked

| Piece | Status |
|---|---|
| Node API auth, ingest, query, feedback | Real |
| Stage 1 feature engineering (validate/classify/impute/normalize) | Real, per the doc's 1.2-1.5 |
| Stage 2 vector standardization (encoding, assembly) | Real, per the doc's 2.2-2.3 |
| Stage 2 dimensionality reduction (2.1) | Real PCA (`pipeline/pca.ts`: covariance matrix + Jacobi eigen-decomposition + top-K projection) once a rolling sample buffer has >=30 observations (`pipeline/pcaReducer.ts`); applied selectively to the non-core fields only (core risk fields - amount, crossBorderFlag, newDeviceFlag, mfaUsed, merchantCategory - are never PCA'd). Cold start (fewer than 30 samples) falls back to a documented chunked-average placeholder so the system still works from the first transaction. `GET /api/dashboard/pca-status` reports sample-buffer fill and whether real PCA is currently active. |
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

## Persistence and Dashboard session auth

Both former "Not done here" gaps are now implemented:

- **Persistent storage**: `store/inMemoryStore.ts` is now a write-through
  cache backed by SQLite (`store/db.ts`, Node's built-in `node:sqlite` -
  no new dependency; this Node version, `node -v`, ships it natively).
  Institutions, transactions, decisions, feedback, auth-failure events, and
  pipeline warnings all survive a restart; the DB file (default
  `services/middleware/data/middleware.sqlite3`, overridable via
  `MIDDLEWARE_DB_PATH`, gitignored as runtime state) is created and seeded
  with the same sandbox institutions/API keys on first run. The PCA rolling
  sample buffer and SSE subscriber connections stay in-memory-only
  deliberately - transient warm-up/runtime state, not records of anything
  that happened.
- **Dashboard API session auth**: `auth/dashboardAuth.ts` adds
  `POST /api/dashboard/auth/login` (username/password, scrypt-hashed
  seeded accounts - `exec-admin` for Company Dash, `novafintech`/
  `institution` role scoped to `inst-2` for Node Dash) and
  `POST /api/dashboard/auth/logout`, issuing/revoking short-lived signed
  JWTs (`jsonwebtoken`). Every other Dashboard API route requires a valid
  `Authorization: Bearer <token>` (or `?token=` for the SSE `/live-feed`
  route, since `EventSource` can't set custom headers); the `institution`
  role is scoped server-side to its own institution's data. The Node API's
  per-institution `x-api-key` auth (`auth.ts`) is unchanged.

