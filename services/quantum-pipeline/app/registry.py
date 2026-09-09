"""
On startup, fits all three model families on the synthetic bootstrap
dataset (bootstrap_data.py) so the engine has something non-degenerate to
serve immediately. services/training-pipeline now exists and owns the real
"8. Model Registry: version + lineage" (QBADS_Training_Learning_Architecture.pdf,
Section 02) - versioned artifacts, lineage, gate results all live there.
`deploy()` below is this engine's side of that integration: it's what gets
called when training-pipeline promotes a challenger (Section 11: "Global
Model Update -> Quantum Engine, receives updated weights, does not train
live") - it swaps a model's live parameters in-place, no retraining here.
"""

import logging
import time
from pathlib import Path

import joblib
import numpy as np

from .bootstrap_data import generate_bootstrap_dataset
from .calibration import CalibrationMap, identity_map
from .config import settings
from .models.base import QuantumFraudModel
from .models.qnn import QNNModel
from .models.qsvm import QSVMModel
from .models.vqc import VQCModel

logger = logging.getLogger("quantum-engine.registry")

DEFAULT_CHAMPION = "VQC"

# Both services live in the same repo checkout - see this engine's own
# feature_dimension/QUBIT_BUDGET coupling note in config.py for the same
# kind of cross-service assumption. A real multi-host deployment would
# fetch the artifact from object storage instead of a shared filesystem path.
TRAINING_PIPELINE_REGISTRY_DIR = Path(__file__).resolve().parents[3] / "services" / "training-pipeline" / "registry"


class ModelRegistry:
    def __init__(self) -> None:
        self._models: dict[str, QuantumFraudModel] = {}
        self._champion = DEFAULT_CHAMPION
        self._ready = False
        self._deployed_from_training_pipeline: set[str] = set()
        # QBADS_Recalibration_Architecture.pdf Section 08: a calibration map
        # is versioned 1:1 against the exact model version it was fit for -
        # keyed here the same way, never carried across a version bump.
        self._calibration: dict[str, CalibrationMap] = {}

    def train_all(self) -> None:
        x, y = generate_bootstrap_dataset()
        for cls in (QSVMModel, QNNModel, VQCModel):
            model = cls()
            t0 = time.time()
            model.fit(x, y)
            logger.info("trained %s in %.2fs on %d bootstrap samples", model.model_type, time.time() - t0, len(x))
            self._models[model.model_type] = model
        self._ready = True

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def champion(self) -> str:
        return self._champion

    def get(self, model_type: str | None) -> QuantumFraudModel:
        if not self._ready:
            raise RuntimeError("models are still training - see /health")
        key = model_type or self._champion
        if key not in self._models:
            raise KeyError(f"unknown model type {key!r}")
        return self._models[key]

    def deploy(self, model_type: str, version: str, artifact_relative_path: str) -> None:
        if model_type not in self._models:
            raise KeyError(f"unknown model type {model_type!r}")

        artifact_path = (TRAINING_PIPELINE_REGISTRY_DIR / artifact_relative_path).resolve()
        registry_root = TRAINING_PIPELINE_REGISTRY_DIR.resolve()
        if registry_root not in artifact_path.parents and artifact_path != registry_root:
            raise FileNotFoundError(f"artifact path escapes registry directory: {artifact_relative_path!r}")
        if not artifact_path.exists():
            raise FileNotFoundError(f"artifact not found: {artifact_path}")

        model = self._models[model_type]
        if model_type == "QSVM":
            bundle = joblib.load(artifact_path)
            model.load_qsvc(bundle["qsvc"], version)
        else:
            weights = np.load(artifact_path)
            model.load_weights(weights, version)

        self._champion = model_type
        self._deployed_from_training_pipeline.add(model_type)
        # A new model version invalidates any inherited calibration map
        # immediately (Recalibration doc, Section 08) - it goes back to
        # serving raw scores until a fresh map is fit and clears both gates.
        self._calibration.pop(model_type, None)
        logger.info("deployed %s %s from %s, now champion", model_type, version, artifact_path)

    def get_calibration(self, model_type: str) -> CalibrationMap:
        return self._calibration.get(model_type, identity_map())

    def set_calibration(self, model_type: str, model_version: str, cal_map: CalibrationMap) -> None:
        if model_type not in self._models:
            raise KeyError(f"unknown model type {model_type!r}")
        current_version = self._models[model_type].model_version
        if current_version != model_version:
            raise ValueError(
                f"calibration map was fit for {model_type} {model_version}, "
                f"but the live model is now {current_version} - refit against the current champion"
            )
        self._calibration[model_type] = cal_map

    def all_model_info(self) -> list[dict]:
        return [
            {
                "modelType": m.model_type,
                "modelVersion": m.model_version,
                "featureDimension": settings.feature_dimension,
                "trainedOn": "training-pipeline" if m.model_type in self._deployed_from_training_pipeline else "synthetic-bootstrap",
                "bootstrapSamples": settings.bootstrap_samples,
            }
            for m in self._models.values()
        ]


registry = ModelRegistry()
