"""
Config for the Quantum Engine service (Quantum_Engine_Base_Architecture.pdf).

FEATURE_DIMENSION must match services/middleware's QUBIT_BUDGET env var
(default 16, see services/middleware/src/config.ts) - Middleware's Stage 2
(vectorStandardization.ts) pads/truncates every feature vector to exactly
that length before calling this engine, because the circuits below are
built once for a fixed number of qubits, not reconstructed per request.
"""

import os


class Settings:
    port: int = int(os.environ.get("PORT", 4002))
    # Must match services/middleware's QUBIT_BUDGET (see config.ts there for
    # why 8, not the doc's full 8-16 range: benchmarked - a real quantum
    # kernel (QSVM) and variational circuits (QNN/VQC) at 16 qubits took
    # 8-25s per single inference on a local simulator; at 8 qubits, well
    # under 200ms. 8 is still squarely inside the documented range.
    feature_dimension: int = int(os.environ.get("FEATURE_DIMENSION", 8))

    # Execution Manager (base architecture doc, Section 03): simulator today,
    # structured so a noise-aware simulator or real QPU backend can be added
    # later without changing the model layer above it.
    backend_mode: str = os.environ.get("BACKEND_MODE", "simulator")
    shots: int = int(os.environ.get("SHOTS", 1024))

    # Confidence & Thresholding (base architecture doc, Section 05, step 7).
    fraud_threshold: float = float(os.environ.get("FRAUD_THRESHOLD", 0.5))

    # Bootstrap training (see app/bootstrap_data.py) - there is no real
    # historical dataset yet (that's services/training-pipeline's job once
    # it exists), so models are fit once at startup on a small synthetic
    # dataset just so they produce structurally sensible, non-random output.
    bootstrap_samples: int = int(os.environ.get("BOOTSTRAP_SAMPLES", 26))
    bootstrap_seed: int = int(os.environ.get("BOOTSTRAP_SEED", 42))

    model_version: str = os.environ.get("MODEL_VERSION", "bootstrap-v0")


settings = Settings()
