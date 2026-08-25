"""
"7. Calibration Registry: version + lineage to the exact model version" +
Section 08: "A calibration map is versioned 1:1 against the model version
it was fit for - never carried over, even between two versions of the same
model family" (QBADS_Recalibration_Architecture.pdf).

Registers "alongside the model registry" (Section 10) - lives in the same
services/training-pipeline/registry/ directory as ../registry.py's model
index, in its own files so a calibration map's lineage is unambiguous: it
never gets confused with a model registry entry, but sits right next to it.
"""

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from .gates import RecalibrationGateOutcome
from .methods import CalibrationMap
from .supervisor import SupervisorVerdict

CALIBRATION_INDEX_PATH = settings.registry_dir / "calibration_index.json"
# Keyed by "{modelType}-{version}" (e.g. "QNN-c1") - a map's champion status
# is per model version, not global, per Section 08's 1:1 rule.
CALIBRATION_CHAMPIONS_PATH = settings.registry_dir / "calibration_champions.json"


def _model_key(model_type: str, model_version: str) -> str:
    return f"{model_type}-{model_version}"


def _load_json(path: Path, default):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: Path, data) -> None:
    settings.registry_dir.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


def next_calibration_version() -> int:
    index = _load_json(CALIBRATION_INDEX_PATH, [])
    return (max((e["calibrationCycle"] for e in index), default=0)) + 1


def save_candidate(
    cycle: int,
    model_type: str,
    model_version: str,
    cal_map: CalibrationMap,
    verdict: SupervisorVerdict,
    gates: RecalibrationGateOutcome,
    promoted: bool,
) -> dict:
    entry = {
        "calibrationCycle": cycle,
        "calibrationVersion": f"cal-c{cycle}",
        "modelType": model_type,
        "modelVersion": model_version,
        "fittedAt": datetime.now(timezone.utc).isoformat(),
        "method": cal_map.method,
        "params": cal_map.params,
        "supervisor": asdict(verdict),
        "gates": {
            "fidelity": asdict(gates.fidelity_gate),
            "deployment": asdict(gates.deployment_gate),
            "promotable": gates.promotable,
        },
        "promoted": promoted,
    }
    index = _load_json(CALIBRATION_INDEX_PATH, [])
    index.append(entry)
    _save_json(CALIBRATION_INDEX_PATH, index)
    return entry


def get_calibration_champion(model_type: str, model_version: str) -> dict | None:
    champions = _load_json(CALIBRATION_CHAMPIONS_PATH, {})
    return champions.get(_model_key(model_type, model_version))


def set_calibration_champion(entry: dict) -> None:
    champions = _load_json(CALIBRATION_CHAMPIONS_PATH, {})
    key = _model_key(entry["modelType"], entry["modelVersion"])
    champions[key] = {
        "calibrationVersion": entry["calibrationVersion"],
        "method": entry["method"],
        "params": entry["params"],
        "promotedAt": datetime.now(timezone.utc).isoformat(),
    }
    _save_json(CALIBRATION_CHAMPIONS_PATH, champions)


def load_calibration_index() -> list[dict]:
    return _load_json(CALIBRATION_INDEX_PATH, [])
