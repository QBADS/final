"""
Config for the Quantum Engine service (Quantum_Engine_Base_Architecture.pdf).

FEATURE_DIMENSION must match services/middleware's QUBIT_BUDGET env var
(default 8, see services/middleware/src/config.ts) - Middleware's Stage 2
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

    # --- Ad-hoc IBM Quantum job-management feature (exec-admin dashboard
    # capability: submit/monitor/cancel a real IBM Quantum job, browse
    # backends). Deliberately INDEPENDENT of backend_mode above, which keeps
    # governing only the QSVM/QNN/VQC fraud models' simulator execution,
    # unchanged. Wiring real IBM Quantum into that per-transaction path would
    # mean every /infer call blocks on a real job queue (seconds-hours
    # instead of <200ms) and every startup re-training submits 100+ billed
    # jobs - out of scope; see the implementation plan for this feature.
    quantum_job_provider: str = os.environ.get("QUANTUM_JOB_PROVIDER", "mock")  # "mock" | "simulator" | "ibm"

    # Required only when quantum_job_provider="ibm". No default value on
    # purpose (fail closed, not a fake sandbox secret) - see
    # app/providers/factory.py.
    ibm_quantum_api_key: str | None = os.environ.get("IBM_QUANTUM_API_KEY")
    ibm_quantum_crn: str | None = os.environ.get("IBM_QUANTUM_CRN")
    ibm_quantum_api_base_url: str = os.environ.get("IBM_QUANTUM_API_BASE_URL", "https://quantum.cloud.ibm.com/api")
    ibm_quantum_api_version: str = os.environ.get("IBM_QUANTUM_API_VERSION", "2025-01-01")  # pinned, not "latest"
    ibm_quantum_iam_url: str = os.environ.get("IBM_QUANTUM_IAM_URL", "https://iam.cloud.ibm.com/identity/token")
    ibm_quantum_timeout_seconds: float = float(os.environ.get("IBM_QUANTUM_TIMEOUT_SECONDS", 30))
    ibm_quantum_max_retries: int = int(os.environ.get("IBM_QUANTUM_MAX_RETRIES", 3))
    ibm_quantum_token_refresh_margin_seconds: int = int(os.environ.get("IBM_QUANTUM_TOKEN_REFRESH_MARGIN_SECONDS", 300))


settings = Settings()
