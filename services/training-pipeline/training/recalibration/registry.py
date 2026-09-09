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


def get_calibration_history(model_type: str, model_version: str) -> list[dict]:
    """Every calibration_index entry ever fitted for this exact model
    version (win or lose), in fitted order - Section 08's 1:1 versioning."""
    key = _model_key(model_type, model_version)
    return [e for e in load_calibration_index() if _model_key(e["modelType"], e["modelVersion"]) == key]


def get_calibration_by_version(model_type: str, model_version: str, calibration_version: str) -> dict | None:
    """Look up one specific historical map by its calibrationVersion id
    (e.g. "cal-c3") within this model version's history - used by
    `recalibrate-rollback --to` to redeploy exactly those previously-fitted
    params rather than refitting (Section 10: instant, zero model risk)."""
    for entry in get_calibration_history(model_type, model_version):
        if entry["calibrationVersion"] == calibration_version:
            return entry
    return None


def get_previous_champion(model_type: str, model_version: str) -> dict | None:
    """The map demoted by whichever entry is currently champion for this
    model version - the next most recent promoted=True entry before it, if
    one exists. Rollback default target for Section 10's "revert to the
    previous champion map"."""
    current = get_calibration_champion(model_type, model_version)
    promoted = [e for e in get_calibration_history(model_type, model_version) if e.get("promoted")]
    promoted.sort(key=lambda e: e.get("calibrationCycle", 0))
    if current is not None:
        promoted = [e for e in promoted if e["calibrationVersion"] != current["calibrationVersion"]]
    return promoted[-1] if promoted else None


def record_rollback(
    model_type: str,
    model_version: str,
    *,
    calibration_version: str,
    method: str,
    params: dict,
    rolled_back_to: str,
    reliability_findings: dict | None = None,
    holdout_samples: int | None = None,
) -> dict:
    """Records a `recalibrate-rollback` deploy in the calibration index and
    moves the champion pointer to match - Section 10: "instant and carry
    zero model risk," so this is a redeploy of an already-registered
    (or identity) map, never a refit. Keeps the registry's own state
    consistent with what was actually just pushed to the engine.

    Carries the same "supervisor.findings" shape a normal fitted entry has
    (reliability + operational) whenever the caller can supply it - e.g.
    copied straight from the historical entry being restored, or freshly
    measured for an identity rollback - so entries this produces stay
    readable by existing consumers (`check-recalibration-triggers`,
    `status`) without special-casing "rollback" entries."""
    entry = {
        "calibrationCycle": next_calibration_version(),
        "calibrationVersion": calibration_version,
        "modelType": model_type,
        "modelVersion": model_version,
        "fittedAt": datetime.now(timezone.utc).isoformat(),
        "method": method,
        "params": params,
        "rollback": True,
        "rolledBackTo": rolled_back_to,
        "promoted": True,
        "supervisor": {
            "findings": {
                "reliability": reliability_findings or {"brierBefore": None, "brierAfter": None, "eceBefore": None, "eceAfter": None},
                "operational": {"holdoutSamples": holdout_samples, "sampleAdequate": None, "latencyMs": None},
            }
        },
    }
    index = _load_json(CALIBRATION_INDEX_PATH, [])
    index.append(entry)
    _save_json(CALIBRATION_INDEX_PATH, index)
    set_calibration_champion(entry)
    return entry
