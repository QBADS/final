"""
Config for the Training Intelligence Layer
(QBADS_Training_Learning_Architecture.pdf). Mirrors
services/quantum-pipeline/app/config.py's feature dimension - a promoted
model must be loadable by that engine, so the shapes have to match.
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings:
    feature_dimension: int = int(os.environ.get("FEATURE_DIMENSION", 8))

    # Data acquisition (Section 02, step 1) - no real transaction history
    # exists yet, so this generates a synthetic dataset. See
    # data_acquisition.py for why this is honestly labeled as a stand-in,
    # not real data.
    synthetic_seed: int = int(os.environ.get("SYNTHETIC_SEED", 7))
    synthetic_n_institutions: int = int(os.environ.get("SYNTHETIC_N_INSTITUTIONS", 3))
    synthetic_days: int = int(os.environ.get("SYNTHETIC_DAYS", 120))
    synthetic_records_per_day: int = int(os.environ.get("SYNTHETIC_RECORDS_PER_DAY", 3))

    # Section 03's three "new" dataset categories (new fraud patterns,
    # cross-institution patterns, temporal behaviour) - generated on top of
    # the base per-day loop above, see data_acquisition.py.
    synthetic_new_fraud_pattern_records: int = int(os.environ.get("SYNTHETIC_NEW_FRAUD_PATTERN_RECORDS", 18))
    synthetic_cross_institution_groups: int = int(os.environ.get("SYNTHETIC_CROSS_INSTITUTION_GROUPS", 10))
    synthetic_temporal_behaviour_groups: int = int(os.environ.get("SYNTHETIC_TEMPORAL_BEHAVIOUR_GROUPS", 10))

    # Dataset Builder (Section 04) - temporal holdout, not random split.
    # Expressed as day-offsets into the synthetic timeline.
    validation_holdout_days: int = int(os.environ.get("VALIDATION_HOLDOUT_DAYS", 20))
    test_holdout_days: int = int(os.environ.get("TEST_HOLDOUT_DAYS", 20))

    # Quantum Model Lab (Section 05) - training set size is capped for
    # QSVM/QNN/VQC specifically (not the full dataset used for data-quality
    # analysis) because kernel/variational training cost scales with sample
    # count and qubit count; see services/quantum-pipeline/README.md's
    # "The 8-qubit call" for the same tradeoff made there.
    max_training_samples: int = int(os.environ.get("MAX_TRAINING_SAMPLES", 60))
    optimizer_max_iter: int = int(os.environ.get("OPTIMIZER_MAX_ITER", 40))

    # AI Training Supervisor (Section 06) / Three Gates (Section 07)
    min_quality_score: float = float(os.environ.get("MIN_QUALITY_SCORE", 0.6))
    max_overfit_gap: float = float(os.environ.get("MAX_OVERFIT_GAP", 0.25))
    max_regression_vs_champion: float = float(os.environ.get("MAX_REGRESSION_VS_CHAMPION", 0.03))
    max_inference_latency_ms: float = float(os.environ.get("MAX_INFERENCE_LATENCY_MS", 500))

    # Federated Learning Layer (Section 11)
    federated_n_institutions: int = int(os.environ.get("FEDERATED_N_INSTITUTIONS", 3))
    # COBYLA needs maxfun >= num_vars + 2; real_amplitudes(reps=1) at 8
    # qubits has 16 parameters, so this must stay >= 18 or scipy silently
    # raises it and warns.
    federated_local_iter: int = int(os.environ.get("FEDERATED_LOCAL_ITER", 25))

    registry_dir: Path = REPO_ROOT / "services" / "training-pipeline" / "registry"
    quantum_engine_url: str = os.environ.get("QUANTUM_ENGINE_URL", "http://localhost:4002")

    # Shadow/canary traffic mirroring (promotion.py / shadow_mirror.py,
    # Section 08) - Middleware's dashboard API, the source of genuinely real
    # (not synthetic) submitted transactions when that service is running.
    middleware_url: str = os.environ.get("MIDDLEWARE_URL", "http://localhost:4000")
    shadow_mirror_window: int = int(os.environ.get("SHADOW_MIRROR_WINDOW_REQUESTS", 50))
    # Middleware's dashboard API requires a real bearer token (see
    # services/middleware/src/auth/dashboardAuth.ts) - these are that
    # service's own documented dev-sandbox defaults (its README/source, not
    # a training-pipeline secret), overridable via env for any other
    # deployment. read-only "exec-admin" role, same as any dashboard viewer.
    middleware_dashboard_username: str = os.environ.get("DASHBOARD_ADMIN_USERNAME", "exec-admin")
    middleware_dashboard_password: str = os.environ.get("DASHBOARD_ADMIN_PASSWORD", "qbads-exec-admin-2026")

    # Retraining daemon (Section 10 cadence - retrain_triggers.py / daemon.py).
    # Defaults are real-world cadence in seconds; overridable for short demo runs.
    daemon_trigger_check_seconds: float = float(os.environ.get("TRAINING_DAEMON_TRIGGER_CHECK_SECONDS", 300))
    daemon_weekly_seconds: float = float(os.environ.get("TRAINING_DAEMON_WEEKLY_SECONDS", 7 * 86400))
    daemon_monthly_seconds: float = float(os.environ.get("TRAINING_DAEMON_MONTHLY_SECONDS", 30 * 86400))
    daemon_quarterly_seconds: float = float(os.environ.get("TRAINING_DAEMON_QUARTERLY_SECONDS", 90 * 86400))
    daemon_tick_seconds: float = float(os.environ.get("TRAINING_DAEMON_TICK_SECONDS", 5))

    # Trigger E (quantum backend drift, retrain_triggers.py) - mirrors
    # Trigger C's data_drift_threshold pattern, applied to a rolling
    # baseline of noise-sensitivity/circuit-depth pulled from the registry.
    quantum_drift_threshold: float = float(os.environ.get("QUANTUM_DRIFT_THRESHOLD", 0.35))
    quantum_drift_baseline_window: int = int(os.environ.get("QUANTUM_DRIFT_BASELINE_WINDOW", 5))


settings = Settings()
