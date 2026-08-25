# Quantum Engine

Status: **built and running (:4002), wired into Middleware as its live
Quantum Model API.** Real Qiskit circuits, not a math-only simulation of
"quantum-like" behavior - QSVM uses an actual quantum kernel, QNN/VQC are
real parameterized circuits trained via a classical optimizer.

Reference: `Quantum_Engine_Base_Architecture.pdf`. `services/training-pipeline`
(`QBADS_Training_Learning_Architecture.pdf`) is now built too and deploys
real trained models into this engine via `POST /models/deploy` - see "Not
done here" below for what's still bootstrap-only.

Python + Qiskit, not Node/TypeScript like the rest of the repo - the doc's
own vocabulary (ZZFeatureMap, COBYLA/SPSA/L-BFGS, quantum kernels, shot-based
measurement) is Qiskit-specific, and there's no serious alternative for
actually running these circuits.

## Structure

```
app/
  config.py                    feature dimension, backend mode, thresholds
  execution_manager.py    "simulator vs noise-aware vs QPU" seam (only simulator implemented)
  bootstrap_data.py        synthetic dataset stand-in for real training data (none exists yet)
  postprocessing.py         anomaly score -> risk level
  calibration.py                applies a fitted Platt/temperature/isotonic map - see "Recalibration" below
  registry.py                    trains + holds all three models + their calibration maps, tracks the champion
  schemas.py                   Pydantic request/response models
  main.py                          FastAPI app: /infer, /feedback, /models, /models/deploy, /models/recalibrate, /health
  models/
    base.py                       common QuantumFraudModel interface
    qsvm.py, qnn.py, vqc.py    the three swappable model families
```

## Running

```bash
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt      # (.venv/bin/pip on macOS/Linux)
./.venv/Scripts/python -m uvicorn app.main:app --port 4002
```

Startup trains all three models on the bootstrap dataset before the service
reports healthy - takes **~45-90s**. `GET /health` returns `{"status":"training"}`
until that finishes.

```bash
curl localhost:4002/health
curl localhost:4002/models
curl -X POST localhost:4002/infer -H "content-type: application/json" \
  -d '{"recordId":"TX-1","vector":[2.1,0.3,1.8,2.9,0.1,1.2,0.4,2.7]}'
```

Middleware calls this automatically (`QUANTUM_CLIENT_MODE=http`, the
default - see `services/middleware/src/pipeline/quantumOrchestrationClient.ts`).
Set `QUANTUM_CLIENT_MODE=mock` on Middleware to skip standing this service up.

## The 8-qubit call

The doc's own range is "8 to 16 for a practical circuit." Benchmarked both
ends before picking: at 16 qubits, a single QSVM inference (kernel
comparison against the bootstrap support set) took **8-25 seconds** on a
local simulator - unusable for a live per-transaction API. At 8 qubits, the
same call is **~150-200ms**, and QNN/VQC inference drops to **10-50ms**.
`FEATURE_DIMENSION` here and `QUBIT_BUDGET` in `services/middleware/src/config.ts`
must be kept in sync - Middleware's Stage 2 pads/truncates every feature
vector to exactly this length before sending it, because these circuits are
built once for a fixed qubit count, not reconstructed per request.

## What's real vs. mocked

| Piece | Status |
|---|---|
| Input validation (dimension/range/finiteness check) | Real |
| Quantum encoding + feature map (`zz_feature_map`) | Real Qiskit circuits |
| QSVM (`FidelityStatevectorKernel` + `QSVC`) | Real quantum kernel |
| QNN (`EstimatorQNN` + `NeuralNetworkClassifier`) | Real parameterized circuit, trained via COBYLA |
| VQC (qiskit-machine-learning's `VQC`) | Real variational circuit, trained via COBYLA |
| Measurement -> anomaly score -> risk level | Real |
| Model training data at startup | **Synthetic bootstrap** (`bootstrap_data.py`) - every model starts here on boot, just so there's a non-degenerate decision boundary immediately. `POST /models/deploy` (below) replaces a given model's parameters with ones `services/training-pipeline` actually trained and gated on a (still synthetic, but far more elaborate) dataset |
| Model Registry, champion/challenger promotion, gates | **Lives in `services/training-pipeline`**, not here - this engine's `registry.py` just holds live model instances and a champion pointer; the versioned index with lineage/benchmarks/gate results is `services/training-pipeline/registry/index.json` |
| `POST /models/deploy` | Real - verified end to end: a training-pipeline cycle promoted a QNN candidate, deployed it here, and `GET /models` + `POST /infer` confirmed the new weights serving real inferences afterward |
| Response signing | Placeholder - a SHA-256 hash, not a real cryptographic signature (no PKI/HSM infra) |
| Continuous learning feedback (`/feedback`) | Stores ground truth only - per the doc, the engine "does not train live". `services/training-pipeline` exists now but generates its own synthetic labels rather than consuming this queue - see its README |
| Execution Manager | Only `backend_mode=simulator` implemented; noise-aware simulator and real QPU are unimplemented seams |

## Recalibration

`POST /infer`'s `anomalyScore` and `confidence` are no longer raw model
output by default - `QBADS_Recalibration_Architecture.pdf` points out that
a QSVM margin pushed through a fixed logistic, or `|score - 0.5| * 2` as
"confidence," were never fit to data. `services/training-pipeline/training/recalibration`
fits a real Platt/temperature/isotonic map on a holdout and pushes it here
via `POST /models/recalibrate`; this engine applies it as a pure
post-processing step (`app/calibration.py`) - **weights are never touched**.
Every `/infer` response now includes both `rawScore` (unmodified model
output) and `anomalyScore` (post-calibration), plus `calibrationMethod` /
`calibrationVersion` so callers can tell which is which. Defaults to
`identity` (raw score passed through unchanged) until a map actually clears
both of that layer's gates for the current model version - see its README
for a real run where the gates correctly rejected two candidates rather
than shipping a mis-calibrated one.

## What `services/training-pipeline` adds on top

Real dataset quality checks, temporal train/validation/test splits, all
three models actually competing on the same data, the AI Training
Supervisor's three quality gates, champion-vs-challenger promotion, a
persisted registry with full lineage, federated averaging across simulated
institutions, and retraining-trigger evaluation - see that service's
README for what's real vs. simplified there (shadow/canary is a
simplified stand-in; there's still no real transaction history anywhere in
this repo, so its dataset is synthetic too, just far richer than
`bootstrap_data.py`).
