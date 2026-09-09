# QBADS — Quantum Blockchain Anomaly Detection System

Fraud detection platform for banks and fintechs: transactions submitted by a
node are turned into a quantum-ready feature vector, scored by a quantum ML
model, recorded on a permissioned blockchain, and surfaced on two
dashboards — one per connected institution, one for QBADS internally.

See the architecture sketch and `services/*/README.md` for how the pieces
fit together; each pillar below links to its source document.

## Status

| Pillar | Status | Doc |
|---|---|---|
| Company Dash (`apps/company-dashboard`) | All 18 pages built and wired to live, session-authenticated Middleware data — no stubs left | source: existing HTML mockup |
| Node Dash (`apps/node-dashboard`) | All 7 pages built and wired, including a real interactive feedback form | none existed; built from the architecture sketch |
| Middleware (`services/middleware`) | Built and running (:4000): full 30-field schema, batch ingestion, real PCA, a Kafka-compatible streaming ingestion stage, a real classical+quantum ensemble decision engine, session-authenticated Dashboard API, SQLite-backed persistence | `QBADS_Middleware_Flow_Structure.pdf` |
| Blockchain (`services/blockchain`) | Code complete, not deployed — dedicated Middleware identity, 3-of-4 majority endorsement across 2 peers/org. Live network still blocked: this environment's Docker daemon cannot pull any container image (registry blob downloads return 403 through the sandbox's network proxy) | `QBADS_Hyperledger_Fabric_Architecture.pdf` |
| Quantum Engine — QSVM/QNN/VQC (`services/quantum-pipeline`) | Built and running (:4002), wired into Middleware | `Quantum_Engine_Base_Architecture.pdf` |
| Training Intelligence Layer (`services/training-pipeline`) | Built and verified — trained, gated, and deployed a real model into the live engine; all 10 spec dataset categories, real shadow-mirror traffic comparison, a scheduler daemon, and a real Trigger E (quantum drift) | `QBADS_Training_Learning_Architecture.pdf` |
| Recalibration Layer (`services/training-pipeline/training/recalibration`) | Built and verified — fit real calibration maps against a live champion; gates correctly rejected both this run; monotonicity is now a hard pre-filter before the Supervisor, and a `recalibrate-rollback` CLI command exists for instant reversion | `QBADS_Recalibration_Architecture.pdf` |

`Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf` isn't its own pillar —
its Stage 1/2 (validation, normalization, dimensionality reduction, quantum
encoding assignment) live inside Middleware
(`services/middleware/src/pipeline/featureEngineering.ts` and
`vectorStandardization.ts`), since that doc's own final step is "handoff to
classical middleware."

Both dashboards are wired to live Middleware data now - `mockApi.ts` is gone
from each app, replaced by `lib/apiClient.ts` (`fetch`) + `lib/useApi.ts`
(a polling hook + an `EventSource` hook for the live feed). Verified with a
headless-browser check: submitted a real transaction while a dashboard was
open and watched it land in the live feed via SSE with zero page reload, no
console errors, no failed requests. Node Dash is fixed to one seeded sandbox
institution (`inst-2`, Nova Fintech) rather than a login flow - see
`services/middleware/README.md`, the Dashboard API has no session auth yet.

Wiring this up surfaced a real bug worth knowing about: Middleware's actual
JSON wire format uses `txId` on transactions/decisions/feedback, but
`packages/types` had them as `id` / `transactionId` - harmless while nothing
talked to the real backend, silently broken the moment something did. Fixed
by renaming the frontend types to match the wire format exactly, not by
adding a translation layer.

A few fields the original mockup showed had no honest live source
(`accuracyPct`, `quantumBackendUtilizationPct`, active/queued "quantum
jobs," host CPU/RAM/storage - none of these map to anything the system
actually tracks, a synchronous inference API has no job queue). Rather than
fill them with fabricated numbers, `packages/types/src/platform.ts` and
Middleware's new `GET /api/dashboard/platform-health` were changed to
report what's real instead: engine/blockchain reachability, the live
champion model's type and version, a real fallback rate, real request
metrics, and the Middleware process's own memory usage. Delta/percentage
fields with no historical baseline (`connectedInstitutionsDeltaToday`,
`transactionsTodayDeltaPct`, etc.) were dropped the same way rather than
faked from an in-memory store that resets on restart.

Every sidebar destination in both apps (25 pages total) is now built
against real data — not just the Overview landing page. That needed seven
new Middleware endpoints: `/transactions` (filterable, all institutions),
`/quantum-info` (full model roster from `services/quantum-pipeline`),
`/blockchain-info`, `/security` (real rejected-auth-attempt log - see
`auth.ts` - plus masked API keys per institution), `/config` (non-secret
runtime thresholds), `/feature-pipeline` (Stage 1's actual field
classification config + real recent pipeline warnings). Verified all 25
pages with a headless-browser pass (zero console errors, zero failed
requests) and spot-checked several by screenshot, including submitting
Node Dash's feedback form for real and confirming it POSTs, persists, and
reappears in the UI on the next poll cycle.

## Gap-closure pass (post-audit)

A prior full-system audit against all seven spec docs found ~10 real or
documented gaps. This pass closed every one that doesn't require external
infrastructure this sandbox cannot provide:

- **30-field transaction schema** — `domainTypes.ts` / `packages/types` now
  carry the full spec-required 30 attributes across transaction details,
  customer behavior, device signals, location signals, authentication
  signals, and merchant/risk indicators, each correctly classified and
  normalized in Stage 1.
- **Batch ingestion** — `POST /api/node/transactions/batch` (partial-failure
  reporting, cap 100).
- **Real PCA** — `pipeline/pca.ts` implements actual covariance/Jacobi
  eigendecomposition-based dimensionality reduction over a rolling sample
  buffer, replacing the earlier placeholder collapse, with a documented
  cold-start fallback.
- **Kafka-compatible streaming ingestion** — `streaming/`: real `kafkajs`
  wiring for a production broker (`KAFKA_BROKERS`), with an in-process
  fallback broker (same interface) used here since no external broker can
  be reached in this sandbox.
- **Classical + quantum ensemble** — `pipeline/ensembleEngine.ts` blends a
  real, hand-trained logistic-regression classical model
  (`classicalMlModel.ts`, trained via `scripts/trainClassicalModel.ts`) with
  the quantum score (0.75/0.25 weighted, configurable) whenever the quantum
  engine is reachable. The separate deterministic classical *rule* engine is
  unchanged and still the outage-only fallback.
- **Blockchain hardening** — a dedicated Middleware Fabric identity (not a
  shared bank identity), 3-of-4 majority chaincode endorsement, 2 peers per
  org. Still not deployable here: this environment's Docker daemon runs but
  cannot pull any container image (confirmed 403s from the registry through
  the sandbox network proxy), so a live Fabric network remains out of reach
  regardless of code readiness.
- **All 10 training dataset categories** — added distinct generators for
  new-fraud-pattern, cross-institution, and temporal-behaviour records.
- **Real shadow-mirror traffic** — `training/shadow_mirror.py` scores real
  submitted Middleware transactions (when available) with both the frozen
  champion and a challenger, falling back to the validation split when no
  live traffic exists yet.
- **Retraining/recalibration scheduler** — `training.cli daemon` runs the
  documented cadence (continuous/weekly/monthly/quarterly checks) and
  auto-invokes a training run when a trigger fires.
- **Trigger E (quantum drift)** — now a real comparison against a rolling
  registry baseline of quantum-specific metrics, not a no-op.
- **Recalibration ordering + rollback** — the monotonicity check is now a
  hard pre-filter before the Supervisor ever sees a candidate map (verified
  with an injected non-monotonic candidate); `training.cli
  recalibrate-rollback` reverts a model version to its previous champion
  map, a specific historical map, or an identity map, instantly.
- **Dashboard session auth + persistence** — `POST /api/dashboard/auth/login`
  issues a JWT (seeded `exec-admin` / institution accounts); every other
  Dashboard route requires it. Middleware's store is now SQLite-backed and
  survives a restart.

## Structure

```
apps/
  company-dashboard/   Internal QBADS view: platform-wide KPIs, live tx
                        stream, institution health, fraud gauge, system health
  node-dashboard/       Per-institution view: own transactions, fraud/review
                        queue, API credentials & usage, connection status,
                        feedback into the federated learning loop
packages/
  types/                 Shared TypeScript contracts (institutions, transactions,
                          fraud decisions, platform health) - not an installable
                          package, imported by path alias @qbads/types
  ui/                     Shared design tokens + React components (Panel, KpiCard,
                          Chip, Sidebar, etc.) so both dashboards read as one
                          product - imported by path alias @qbads/ui
services/
  middleware/             Node/Dashboard APIs, the full pipeline (feature engineering,
                          vector standardization, quantum orchestration + classical
                          fallback, decision engine, federated learning) - built, running on :4000
  blockchain/             Hyperledger Fabric network (4 orgs, RAFT ordering), fraud-ledger
                          chaincode, and the gateway service - code complete, not deployed
  quantum-pipeline/       Python + Qiskit: real QSVM/QNN/VQC circuits (FastAPI, :4002),
                          trained on a synthetic bootstrap dataset at startup - built, running,
                          wired into Middleware as its live Quantum Model API
  training-pipeline/      Python + Qiskit CLI: the offline collect-label-train-gate-promote
                          lifecycle - trains real QSVM/QNN/VQC candidates, benchmarks and
                          gates them, and deploys the winner into quantum-pipeline over HTTP.
                          Built and verified end to end (a real training cycle promoted a
                          QNN candidate and the live engine served inferences from it)
    training/recalibration/  Companion pillar in the same package: fits Platt/temperature/
                          isotonic calibration maps against a frozen champion (weights never
                          touched) and deploys them via quantum-pipeline's /models/recalibrate.
                          Built and verified - a real run's gates correctly rejected two
                          candidates that would've shifted the risk-threshold population too far
```

## Tech stack

- **React 19 + TypeScript + Vite** for both dashboards
- **Tailwind CSS v4** for layout utilities, layered on top of a shared
  hand-authored design system (`packages/ui`) that reproduces the approved
  dashboard mockup's exact color/spacing language
- **Recharts** for charts (volume area chart, risk gauge)
- **React Router v7** for in-app navigation
- **npm workspaces** for the monorepo (`apps/*`); `packages/*` are shared
  source imported via Vite/TS path aliases rather than published packages,
  since nothing outside this repo consumes them
- **Python + Qiskit** for `services/quantum-pipeline` (FastAPI) and
  `services/training-pipeline` (CLI) - the one polyglot exception, because
  Qiskit is the only serious option for actually running QSVM/QNN/VQC circuits

## Running

```bash
npm install              # from repo root, installs both apps
npm run dev:company      # Company Dash → http://localhost:5173
npm run dev:node         # Node Dash    → http://localhost:5174
npm run build             # production build of both apps
```

Middleware is a separate package (not an npm workspace member — see its
README for why): `cd services/middleware && npm install && npm run build && npm start` → `http://localhost:4000`.

Quantum Engine (Python — see its README for venv setup): `cd services/quantum-pipeline && ./.venv/Scripts/python -m uvicorn app.main:app --port 4002`
→ `http://localhost:4002`. Takes ~45-90s to report healthy (trains QSVM/QNN/VQC on startup). Middleware
falls back to its classical rule engine automatically if this isn't running — start it if you want to
see real quantum-backed decisions instead of fallback ones.

Training Intelligence Layer (Python CLI, not a server — see its README): `cd services/training-pipeline && ./.venv/Scripts/python -m training.cli run`
runs one full training cycle (~2-3 min) and, if a challenger clears every gate, deploys it straight into
the running Quantum Engine above. Then `./.venv/Scripts/python -m training.cli recalibrate` fits and
(if it clears both recalibration gates) deploys a calibration map for whichever model that cycle promoted.

## Notes for whoever picks this up next

- Every page in both dashboards is wired to live Middleware data now
  (polling for most panels, SSE for the transaction feeds) - no "coming
  soon" placeholders left. `packages/ui`'s new `TransactionTable` component
  is shared across six of the new pages (Transaction centre, Fraud
  detection, Case management, Live monitoring, and Node Dash's Transaction
  history / Fraud & risk) rather than reimplemented per page.
- `packages/types` is the contract boundary for the frontend; `services/middleware/src/domainTypes.ts`
  is the backend's own (deliberately not cross-imported — see that
  README) — the two are kept field-aligned by hand where they cross the
  Dashboard API. This got tested for real this pass (see the `txId` bug
  above) — worth re-checking by hand after any Middleware response shape
  changes, since nothing catches this drift automatically.
- The remaining genuinely-open item is a live Fabric CA (still using static
  `cryptogen` material) — called out in `services/blockchain/README.md`.
  The 30-field Node API schema is done; see below.
- Middleware's transaction/decision/feedback data is now persisted to
  SQLite (`services/middleware/data/middleware.sqlite3`, gitignored) and
  survives a restart — confirmed by killing and restarting the process and
  re-querying a previously-submitted transaction. The PCA rolling sample
  buffer and SSE connections remain legitimately in-memory/transient.
  `services/quantum-pipeline`'s startup bootstrap is still a tiny 26-sample
  synthetic set; `services/training-pipeline` generates a richer synthetic
  dataset (1000+ records, temporal spread, all 10 spec-listed categories)
  but it's still synthetic. Whichever pillar eventually owns real data
  ingestion should replace both.
- `services/training-pipeline`'s registry (`registry/index.json`,
  `registry/champion.json`, `registry/artifacts/`, plus recalibration's
  `registry/calibration_index.json` / `calibration_champions.json`) is
  local, gitignored state, not checked in — running `training.cli run` /
  `recalibrate` builds it fresh.
- `POST /infer` on the Quantum Engine now returns both `rawScore` (model
  output) and `anomalyScore` (post-calibration — identical to `rawScore`
  until a calibration map has actually cleared both recalibration gates for
  the current model version). Anything reading this response for the raw
  model signal specifically should use `rawScore`, not assume the two match.
- `QUBIT_BUDGET` (Middleware) / `FEATURE_DIMENSION` (Quantum Engine) are
  pinned to 8, not the doc's full 8-16 range — benchmarked, and 16 qubits
  pushed single-inference latency to 8-25s on a local simulator. Revisit if
  this ever runs against real QPU hardware instead of a simulator.
