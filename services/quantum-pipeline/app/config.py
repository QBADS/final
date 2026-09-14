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

    # Execution Manager (base architecture doc, Section 03): "simulator"
    # (default, local qiskit primitives) or "ibm_qpu" (IBM Quantum Platform
    # via qiskit-ibm-runtime - see execution_manager.py for the real/fake
    # backend split below). Structured so this was a change in one module,
    # not in every model.
    backend_mode: str = os.environ.get("BACKEND_MODE", "simulator")
    shots: int = int(os.environ.get("SHOTS", 1024))

    # --- IBM Quantum Platform (only read when backend_mode == "ibm_qpu") ---
    # Real account credentials from https://quantum.cloud.ibm.com (Instance
    # -> CRN, and an API key under your account). "channel" is the IBM
    # Quantum Platform SDK's own term for which cloud auth surface to use;
    # "ibm_cloud" is current, "ibm_quantum_platform" covers newer SDK
    # versions' renamed default - qiskit-ibm-runtime accepts either name.
    ibm_channel: str = os.environ.get("IBM_QUANTUM_CHANNEL", "ibm_cloud")
    ibm_token: str | None = os.environ.get("IBM_QUANTUM_TOKEN")
    ibm_instance: str | None = os.environ.get("IBM_QUANTUM_INSTANCE")
    # Pin to a specific named backend (e.g. "ibm_torino"); leave unset to
    # let QiskitRuntimeService.least_busy() pick automatically.
    ibm_backend_name: str | None = os.environ.get("IBM_QUANTUM_BACKEND")
    # Dev/test override: a qiskit_ibm_runtime.fake_provider class name (e.g.
    # "FakeSherbrooke"), used INSTEAD of a real QiskitRuntimeService
    # connection. Fake backends carry a real IBM device's exact coupling
    # map/basis gates and run entirely locally (no network, no account) -
    # this is how the ibm_qpu code path is verified in an environment with
    # no route to IBM's cloud API, and it's a legitimate way to
    # smoke-test/develop this integration without burning real QPU time.
    # Never set this in a real deployment - it silently makes "ibm_qpu"
    # mode not actually touch hardware.
    ibm_fake_backend: str | None = os.environ.get("IBM_QUANTUM_FAKE_BACKEND")

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
