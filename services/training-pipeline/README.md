# Training Intelligence Layer

Status: **built and verified end to end**, including a real deploy into the
live Quantum Engine. Reference: `QBADS_Training_Learning_Architecture.pdf`.

Python + Qiskit, same reasoning as `services/quantum-pipeline` (real QSVM
kernel + QNN/VQC circuits are what's being trained - there's no serious
non-Qiskit option). Separate venv, separate service - see that project's
README for why polyglot-but-scoped is the right call here.

```bash
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt
./.venv/Scripts/python -m training.cli run                                     # one full training cycle
./.venv/Scripts/python -m training.cli federated                                # one FedAvg round
./.venv/Scripts/python -m training.cli check-triggers                            # Section 10 triggers vs current champion
./.venv/Scripts/python -m training.cli recalibrate                                  # recalibrate the current champion - see training/recalibration/README.md
./.venv/Scripts/python -m training.cli check-recalibration-triggers      # recalibration triggers
./.venv/Scripts/python -m training.cli daemon --duration-seconds 180                # Section 10 cadence scheduler - see daemon.py
./.venv/Scripts/python -m training.cli status                                        # registry + current champion
```

`training/recalibration/` is a companion pillar living in this same
package - `QBADS_Recalibration_Architecture.pdf`, turning a champion
model's raw score into a calibrated probability without touching its
weights. See `training/recalibration/README.md` for what it does and what
it verified.

`run` takes roughly 2-3 minutes (three real quantum models trained once
each). Section 10 describes cadence
(continuous/daily/weekly/monthly/quarterly/emergency) and event triggers;
`retrain_triggers.py` has the real, testable trigger-evaluation logic, and
`training.cli daemon` (daemon.py) is the real scheduler that calls it on a
timer and auto-invokes `training.cli run` when a trigger fires - a
lightweight stdlib interval loop a deployer would wrap in
systemd/cron/a container, not a production unit itself.

## What one `run` actually does

Mirrors `QBADS_Training_Learning_Architecture.pdf` Section 02 end to end:

1. **`data_acquisition.py`** - generates a synthetic labeled dataset (there's
   no real transaction history anywhere in this repo - Middleware is
   in-memory, see its README) spread across a simulated multi-month
   timeline, across all ten of Section 03's dataset categories
   (confirmed fraud/legitimate, false-positive, false-negative,
   suspicious/reviewed, synthetic fraud, adversarial, new fraud patterns,
   cross-institution patterns, temporal behaviour).
2. **`data_quality.py`** - dedup, missing-data check, label verification,
   class-balance analysis, a PII-field scan. Feeds Gate 1.
3. **`feature_engineering.py`** - fixed (never data-fit) projection down to
   `services/quantum-pipeline`'s 8-dimensional feature space, so a promoted
   model is shape-compatible with the live engine.
4. **`dataset_builder.py`** - **temporal** train/validation/future-test
   split (Section 04: "do not train on randomly sampled transactions"),
   plus a hard-negative set (false-positives) and stress-test set
   (adversarial + synthetic fraud).
5. **`models.py`** - trains real QSVM (quantum kernel), QNN (`EstimatorQNN`),
   and VQC circuits on the same training split - Section 05's "should not
   be trained identically - they should compete."
6. **`benchmarking.py`** - recall/precision/F1/ROC-AUC/PR-AUC/calibration,
   circuit depth, a noise-sensitivity probe (predictions under small input
   perturbation), stress-set recall, inference latency.
7. **`ai_training_supervisor.py`** - scores each candidate on data/model/
   quantum quality (Section 06). Advisory only, per the doc's own rule -
   `gates.py`'s Gate 2 also checks hard, deterministic floors independently.
8. **`gates.py`** - Gate 1 (data) -> Gate 2 (model, vs the incumbent
   champion) -> Gate 3 (deployment/operational), sequential, skips 2 and 3
   if 1 fails (Section 07).
9. **`promotion.py`** - among gate-clearing challengers, promotes the one
   the supervisor scored highest; a validation-split shadow/canary recheck
   plus a real traffic-mirroring pass (`shadow_mirror.py`) against genuine
   Middleware transactions when available; if nothing clears, the incumbent
   stays champion (Section 08).
10. **`registry.py`** - persists every candidate (win or lose) to
    `registry/index.json` with full lineage (benchmark + supervisor
    findings + gate results), plus a `champion.json` pointer. QNN/VQC store
    a weight vector (`.npy`); QSVM stores the fitted classifier itself
    (`.joblib` - kernel methods have no fixed-size weight vector).
11. **Deploy** - POSTs the promotion to `services/quantum-pipeline`'s new
    `POST /models/deploy` endpoint, which loads the artifact and swaps it
    into the live model in place - no retraining on that side. This is
    Section 11's "Global Model Update -> Quantum Engine, receives updated
    weights, does not train live" made real, not diagrammed.

## Verified, not just written

Ran a full cycle against a live `services/quantum-pipeline`: QSVM came back
with recall 0.0 (not promotable - a real, unflattering result, not tuned
away), QNN and VQC both cleared all three gates, QNN's higher AI Training
Supervisor score won it the promotion, and `GET /models` on the running
engine confirmed the deployed weights (`modelVersion: "QNN-c1"`,
`trainedOn: "training-pipeline"`) actually serving real inferences
afterward. Also ran `federated` (3 synthetic institutions, real local VQC
training + sample-weighted FedAvg into one global weight vector) and
`check-triggers` (correctly fired the recall-floor trigger against that
same QNN champion's honest 0.41 recall).

## What's real vs. simplified vs. not done

| Piece | Status |
|---|---|
| Data quality checks, temporal split, feature engineering | Real |
| QSVM/QNN/VQC training | Real Qiskit circuits, same as `services/quantum-pipeline` |
| Benchmarking (detection/quantum/operational metrics) | Real, computed on held-out data |
| AI Training Supervisor scoring | Real, advisory (see gates.py) |
| Three gates | Real, deterministic |
| Champion/challenger promotion + registry + deploy | Real, verified live against the running engine |
| Federated averaging | Real FedAvg math; "institutions" are partitions of one synthetic dataset, not separate organizations |
| Retraining triggers (A-D) | Real, pure evaluation functions |
| Trigger E (quantum drift) | Real, simulator-scoped - compares the champion's noise-sensitivity/circuit-depth (benchmarking.py) against a rolling baseline pulled from the registry (`retrain_triggers.compute_quantum_drift_score`, `trigger_runner.py`), same pattern as Trigger C's data drift. Detects simulator-level circuit/backend behavior drift between training runs, not live QPU drift - there's no QPU here |
| Scheduler / cadence automation | Real - `training.cli daemon` (daemon.py): a stdlib interval loop that runs `check-triggers` on a configurable interval and auto-invokes `training.cli run` when one fires, plus the weekly/monthly/quarterly cadence on their own configurable intervals (`TRAINING_DAEMON_*_SECONDS`, config.py) |
| Shadow / canary deployment | Two independent passes now: `_shadow_canary_recheck` (promotion.py) re-evaluates on the validation split and a random subset, kept as a stress test; `shadow_mirror.py` is the real traffic-mirroring mechanism - real Middleware transactions (`GET /api/dashboard/transactions`, authenticated via its dashboard login) scored by both the frozen champion and the challenger for agreement rate/score drift, with a documented fallback to the validation split when Middleware isn't running or has no transactions yet |
| Training data | **Synthetic** - `data_acquisition.py` generates it, now across all ten of Section 03's dataset categories (`new_fraud_pattern`, `cross_institution`, `temporal_behaviour` added alongside the original seven); there's no real transaction history to collect yet |
| Consuming Quantum Engine's `/feedback` queue | **Not done** - that queue exists on the engine but nothing here reads it; this pipeline generates its own labels instead |
