# Recalibration Layer

Status: **built and verified end to end**, including a real deploy into the
live Quantum Engine and a real gate rejection. Reference:
`QBADS_Recalibration_Architecture.pdf`.

Lives inside `services/training-pipeline` rather than as its own top-level
service - it needs the exact same champion-model reconstruction, synthetic
holdout generation, and registry directory that pillar already owns (see
`model_loader.py`'s docstring), and the doc itself frames this as
"extend[ing] the existing architecture," not a standalone system. Same
venv, same CLI (`python -m training.cli recalibrate`).

## What it does

1. **`model_loader.py`** - reconstructs the current model champion's
   `predict_proba` **read-only** from its registry artifact (weights `.npy`
   or the fitted QSVC `.joblib`) - never calls `.fit()`. "Frozen Champion
   Model... untouched throughout" (Section 03) isn't just a comment, it's
   why this file exists as a separate loader from `../models.py`, which
   trains.
2. **`score_collection.py`** - runs the frozen model over
   `dataset_builder.py`'s temporal test split (the "rolling holdout" - see
   its docstring for why that split is the honest stand-in here, same
   caveat as everywhere else in this repo: no live traffic exists to
   actually roll forward).
3. **`reliability.py`** - Brier score, Expected Calibration Error, and
   10-bin reliability-diagram data.
4. **`methods.py`** - Platt scaling, temperature scaling, isotonic
   regression, each fit on the holdout and returning a portable
   `{method, params}` spec - the same shape `services/quantum-pipeline/app/calibration.py`
   applies on the serving side, so nothing about "how to interpret a Platt
   map" is duplicated, only re-expressed per language.
5. **`supervisor.py`** - AI Recalibration Supervisor: reliability (did
   Brier/ECE actually improve?), rank safety (recall/precision at the
   engine's fixed 0.65/0.3 thresholds, before vs. after — a **hard,
   deterministic floor**, not just an opinion), operational (holdout size,
   latency).
6. **`gates.py`** - Gate 1 (Fidelity) then Gate 2 (Deployment), sequential.
7. **`registry.py`** - `registry/calibration_index.json` (every candidate,
   win or lose) + `registry/calibration_champions.json`, keyed
   `"{modelType}-{modelVersion}"` - a map's champion status is scoped to the
   *exact* model version it was fit for, never inherited (Section 08).
8. **Deploy** - `POST /models/recalibrate` on `services/quantum-pipeline`,
   analogous to its existing `/models/deploy`. Swaps only the post-processing
   score mapping; the model's weights are never touched.

## Verified, not just written

Ran a real cycle against a live engine after a real model promotion (VQC
`VQC-c2`). Both candidate methods (temperature, isotonic) genuinely
improved Brier score - and **both were correctly rejected**: this VQC's raw
scores on the holdout never exceeded ~0.61, so *zero* samples crossed the
engine's fixed 0.65 "high risk" threshold before calibration; any map that
pushed even a few scores past it registered as a 100%+ relative recall
jump, and isotonic's fit shifted 42% of the holdout across risk bands
outright. Gate 1 caught both, correctly. That's the whole point of this
layer's rank-safety check, not a bug — "the incumbent map stays live"
worked exactly as specified.

Separately verified the deploy mechanics themselves work when a map *does*
clear: manually fit and pushed a temperature map, and `POST /infer`
immediately reflected it — `rawScore: 0.4697` vs. calibrated
`anomalyScore: 0.4121`, `calibrationMethod: "temperature"` — then reset the
engine back to `identity` afterward so the live system matches what the
real (gate-checked) cycle actually decided: no promotion.

## What's real vs. simplified vs. not done

| Piece | Status |
|---|---|
| Score collection, reliability analysis, all three calibration methods | Real |
| Monotonicity check | Real - and has real teeth (a degenerate temperature fit with T <= 0 would flip the curve from increasing to decreasing; this catches it) |
| AI Recalibration Supervisor, two gates | Real, verified both the reject path and (via isolated check) the accept/deploy path |
| Calibration registry (versioned 1:1 to model version) | Real |
| `POST /models/recalibrate`, confidence-from-steepness | Real - see `services/quantum-pipeline/app/calibration.py`'s `local_slope` for the direction convention chosen (flatter curve = higher confidence) where the doc itself doesn't specify one |
| "Rolling holdout" | **Synthetic** - reuses the same temporal test split `../dataset_builder.py` already builds; there's no live confirmed-outcome stream anywhere in this repo |
| Cadence / triggers (`triggers.py`) | Real, pure evaluation functions, same shape as `../retrain_triggers.py`. No scheduler daemon, same reasoning |
| Trigger B (disagreement spike) | Stubbed at 0% - nothing here samples Middleware's actual `calibratedConfidence` disagreement rate; that data exists in Middleware, not here |
| Trigger C (backend/shot change) | Stubbed `False` - `services/quantum-pipeline`'s Execution Manager only ever runs `backend_mode=simulator`, so there's nothing to detect a change from yet |
| `Middleware calibratedConfidence` | **Correctly out of scope** per the doc (Section 04) - stays a Middleware business rule operating on the engine's already-recalibrated confidence, untouched here |
