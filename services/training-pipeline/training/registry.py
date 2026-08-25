"""
"8. Model Registry: version + lineage" (QBADS_Training_Learning_Architecture.pdf,
Section 02). Persisted to services/training-pipeline/registry/ - a JSON
index (one entry per trained candidate, win or lose) plus artifacts:
QNN/VQC store their weight vector directly (.npy - portable, small);
QSVM has no fixed-size weight vector (it's a kernel method), so its
"artifact" is the fitted classifier itself (.joblib).

One champion at a time across all three model types, matching Section 08's
own framing ("CHAMPION (production) e.g. VQC-v3.1" - a single incumbent,
not one champion per model family).
"""

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np

from .ai_training_supervisor import SupervisorVerdict
from .benchmarking import BenchmarkResult
from .config import settings
from .gates import GateOutcome
from .models import TrainedCandidate

ARTIFACTS_DIR = settings.registry_dir / "artifacts"
INDEX_PATH = settings.registry_dir / "index.json"
CHAMPION_PATH = settings.registry_dir / "champion.json"


def _ensure_dirs() -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


def _load_json(path: Path, default):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: Path, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


def next_cycle_number() -> int:
    index = _load_json(INDEX_PATH, [])
    return (max((e["cycle"] for e in index), default=0)) + 1


def _artifact_path(model_type: str, cycle: int) -> Path:
    ext = "joblib" if model_type == "QSVM" else "npy"
    return ARTIFACTS_DIR / f"{model_type}-cycle{cycle}.{ext}"


def save_candidate(
    cycle: int,
    candidate: TrainedCandidate,
    benchmark: BenchmarkResult,
    supervisor: SupervisorVerdict,
    gates: GateOutcome,
    promoted: bool,
) -> dict:
    _ensure_dirs()
    artifact_path = _artifact_path(candidate.model_type, cycle)

    if candidate.model_type == "QSVM":
        # No portable weight vector - persist the fitted classifier plus the
        # support data it was trained on (both needed to reconstruct it).
        from qiskit.circuit.library import zz_feature_map
        from qiskit_machine_learning.algorithms import QSVC
        from qiskit_machine_learning.kernels import FidelityStatevectorKernel

        feature_map = zz_feature_map(feature_dimension=settings.feature_dimension, reps=1)
        kernel = FidelityStatevectorKernel(feature_map=feature_map)
        qsvc = QSVC(quantum_kernel=kernel)
        x, y = candidate.support_data
        qsvc.fit(x, y)  # re-fit for a clean, serializable object (mirrors what predict_proba_fn already wraps)
        joblib.dump({"qsvc": qsvc, "support_x": x, "support_y": y}, artifact_path)
    else:
        np.save(artifact_path, candidate.weights)

    entry = {
        "cycle": cycle,
        "modelType": candidate.model_type,
        "version": f"{candidate.model_type}-c{cycle}",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "artifactPath": str(artifact_path.relative_to(settings.registry_dir)),
        "benchmark": asdict(benchmark),
        "supervisor": asdict(supervisor),
        "gates": {
            "data": asdict(gates.data_gate),
            "model": asdict(gates.model_gate),
            "deployment": asdict(gates.deployment_gate),
            "promotable": gates.promotable,
        },
        "promoted": promoted,
    }

    index = _load_json(INDEX_PATH, [])
    index.append(entry)
    _save_json(INDEX_PATH, index)
    return entry


def get_champion() -> dict | None:
    champion = _load_json(CHAMPION_PATH, None)
    if champion is None:
        return None
    index = _load_json(INDEX_PATH, [])
    matches = [e for e in index if e["version"] == champion["version"]]
    return matches[-1] if matches else None


def set_champion(entry: dict) -> None:
    _ensure_dirs()
    _save_json(CHAMPION_PATH, {"version": entry["version"], "modelType": entry["modelType"], "promotedAt": datetime.now(timezone.utc).isoformat()})


def load_index() -> list[dict]:
    return _load_json(INDEX_PATH, [])
