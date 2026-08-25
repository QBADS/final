from typing import Literal, Optional

from pydantic import BaseModel, Field

ModelType = Literal["QSVM", "QNN", "VQC"]


class InferenceRequest(BaseModel):
    """
    Matches the "FROM CLASSICAL MIDDLEWARE" box in
    Quantum_Engine_Base_Architecture.pdf, Section 05: "Encoded Features
    (Feature Vector) x1..xn, Normalized & Vectorized (Length = N)".
    """

    recordId: str
    vector: list[float]
    modelType: Optional[ModelType] = Field(default=None, description="Override the active champion model")


class InferenceResponse(BaseModel):
    """
    "8. Output & Return to Middleware": Anomaly Score, Model Type Used,
    Confidence, Quantum Inference ID, Timestamp, Model Version, signed
    response.
    """

    quantumInferenceId: str
    anomalyScore: float  # 0.00-1.00 - the RECALIBRATED score if a calibration map is live, else the raw score
    rawScore: float  # what the model actually output, before any calibration map
    riskLevel: Literal["low", "medium", "high"]
    modelType: ModelType
    modelVersion: str
    confidence: float
    calibrationMethod: str  # "identity" until a map clears both recalibration gates for this model version
    calibrationVersion: str
    timestamp: str
    latencyMs: float
    circuitDepth: int
    shots: int
    signature: str


class FeedbackRequest(BaseModel):
    """
    "9. Continuous Learning Feedback (From Middleware)": ground truth labels
    for a past inference. The engine only stores these - per the doc, it
    "does not train live". services/training-pipeline exists now but runs
    its own synthetic data generation rather than consuming this queue yet
    - see its README for why.
    """

    quantumInferenceId: str
    recordId: str
    confirmedFraud: bool


class ModelInfo(BaseModel):
    modelType: ModelType
    modelVersion: str
    featureDimension: int
    trainedOn: str
    bootstrapSamples: int


class DeployRequest(BaseModel):
    """
    "Global Model Update -> Quantum Engine, receives updated weights, does
    not train live" (QBADS_Training_Learning_Architecture.pdf, Section 11).
    Sent by services/training-pipeline/training/promotion.py after a
    challenger clears all three gates.
    """

    modelType: ModelType
    version: str
    registryEntry: dict


class RecalibrateRequest(BaseModel):
    """
    "Deploy path, analogous to the existing POST /models/deploy... a
    lightweight POST /models/recalibrate swaps only the post-processing
    score mapping in place. No model reload, no retraining"
    (QBADS_Recalibration_Architecture.pdf, Section 10). Sent by
    services/training-pipeline/training/recalibration/cycle.py after a
    candidate map clears both recalibration gates.
    """

    modelType: ModelType
    version: str  # must match the model's current modelVersion - maps are 1:1 to an exact model version
    calibrationVersion: str
    method: Literal["identity", "platt", "temperature", "isotonic"]
    params: dict
