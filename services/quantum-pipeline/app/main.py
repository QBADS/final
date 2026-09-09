import hashlib
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, HTTPException

from .calibration import CalibrationMap
from .config import settings
from .postprocessing import score_to_risk_level
from .registry import registry
from .schemas import DeployRequest, FeedbackRequest, InferenceRequest, InferenceResponse, ModelInfo, RecalibrateRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("quantum-engine")

feedback_log: list[FeedbackRequest] = []


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("training bootstrap models (feature_dimension=%d)...", settings.feature_dimension)
    t0 = time.time()
    registry.train_all()
    logger.info("all models ready in %.2fs, champion=%s", time.time() - t0, registry.champion)
    yield


app = FastAPI(title="QBADS Quantum Engine", lifespan=lifespan)


def _sign(payload: str) -> str:
    # Placeholder for real response signing (no PKI/HSM infra for this
    # engine yet) - a deterministic hash so callers can at least detect
    # tampering in transit, not a cryptographic signature.
    return hashlib.sha256(payload.encode()).hexdigest()


@app.get("/health")
def health():
    return {"status": "ok" if registry.ready else "training", "champion": registry.champion if registry.ready else None}


@app.get("/models", response_model=list[ModelInfo])
def list_models():
    if not registry.ready:
        raise HTTPException(status_code=503, detail="models are still training")
    return registry.all_model_info()


@app.post("/infer", response_model=InferenceResponse)
def infer(request: InferenceRequest):
    # "1. Input Receiver & Validation": schema validation, dimension check,
    # range check, missing value check.
    if len(request.vector) != settings.feature_dimension:
        raise HTTPException(
            status_code=422,
            detail=f"vector must have length {settings.feature_dimension}, got {len(request.vector)}",
        )
    if any(v is None or not np.isfinite(v) for v in request.vector):
        raise HTTPException(status_code=422, detail="vector contains missing or non-finite values")

    try:
        model = registry.get(request.modelType)
    except (RuntimeError, KeyError) as err:
        raise HTTPException(status_code=503, detail=str(err)) from err

    start = time.time()
    # "2. Quantum Encoding (Amplitude Encoding)" + "3. Feature Map (Hilbert
    # Space)" happen inside the model's own circuit (feature map + ansatz /
    # kernel) - the vector arriving here is already the classical x this
    # step maps into |phi(x)>, per the doc's own input-side diagram.
    x = np.array(request.vector, dtype=float)
    raw_score = model.predict_proba(x)  # "5. Measurement" + "6. Post-processing" folded into predict_proba

    # "8. Live Quantum Engine: post-processing swap only - weights
    # untouched" (Recalibration doc, Section 03) - the model itself never
    # knows a calibration map exists; this is purely a response-shaping step.
    cal_map = registry.get_calibration(model.model_type)
    anomaly_score = cal_map.apply(raw_score)
    latency_ms = (time.time() - start) * 1000

    if cal_map.method == "identity":
        confidence = abs(anomaly_score - 0.5) * 2  # boundary-distance heuristic - no fitted curve to read steepness from
    else:
        # "Confidence... Derived from the recalibrated curve's own
        # steepness at that score" (Recalibration doc, Section 04) - see
        # CalibrationMap.local_slope for which direction "steeper" maps to.
        confidence = 1.0 - min(cal_map.local_slope(raw_score) * 2, 1.0)

    quantum_inference_id = str(uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()
    signature = _sign(f"{quantum_inference_id}|{request.recordId}|{anomaly_score}|{model.model_version}")

    return InferenceResponse(
        quantumInferenceId=quantum_inference_id,
        anomalyScore=round(anomaly_score, 6),
        rawScore=round(raw_score, 6),
        riskLevel=score_to_risk_level(anomaly_score),
        modelType=model.model_type,
        modelVersion=model.model_version,
        confidence=round(confidence, 4),
        calibrationMethod=cal_map.method,
        calibrationVersion=cal_map.version,
        timestamp=timestamp,
        latencyMs=round(latency_ms, 3),
        circuitDepth=model.circuit_depth(),
        shots=settings.shots,
        signature=signature,
    )


@app.post("/models/deploy")
def deploy(request: DeployRequest):
    artifact_path = request.registryEntry.get("artifactPath")
    if not artifact_path:
        raise HTTPException(status_code=422, detail="registryEntry.artifactPath is required")
    try:
        registry.deploy(request.modelType, request.version, artifact_path)
    except (KeyError, FileNotFoundError) as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    logger.info("champion updated to %s %s via /models/deploy", request.modelType, request.version)
    return {"deployed": True, "modelType": request.modelType, "version": request.version, "champion": registry.champion}


@app.post("/models/recalibrate")
def recalibrate(request: RecalibrateRequest):
    cal_map = CalibrationMap(method=request.method, version=request.calibrationVersion, params=request.params)
    try:
        cal_map.apply(0.5)  # dry-run: fail fast on malformed/missing params instead of on a later /infer call
    except (KeyError, ValueError, TypeError) as err:
        raise HTTPException(status_code=422, detail=f"invalid calibration params for method {request.method!r}: {err}") from err
    try:
        registry.set_calibration(request.modelType, request.version, cal_map)
    except (KeyError, ValueError) as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    logger.info(
        "calibration map updated for %s %s -> %s (%s) via /models/recalibrate",
        request.modelType, request.version, request.calibrationVersion, request.method,
    )
    return {
        "recalibrated": True,
        "modelType": request.modelType,
        "version": request.version,
        "calibrationVersion": request.calibrationVersion,
        "method": request.method,
    }


@app.post("/feedback", status_code=202)
def feedback(request: FeedbackRequest):
    # "9. Continuous Learning Feedback": the engine only stores ground
    # truth here - see schemas.FeedbackRequest for why it doesn't retrain
    # live.
    feedback_log.append(request)
    return {"stored": True, "totalFeedback": len(feedback_log)}
