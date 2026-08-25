"""
"6. Post-processing (Anomaly Score)" and "7. Confidence & Thresholding"
(Quantum_Engine_Base_Architecture.pdf, Section 05). The engine reports a
risk level as a courtesy for logging/dashboards, but the actual SAFE /
REVIEW / FRAUD call stays with Middleware's decision engine (Section 2 of
QBADS_Middleware_Flow_Structure.pdf: "Risk thresholds - institution
policies") - institution-specific policy doesn't belong inside a shared
inference engine.
"""

from typing import Literal

RiskLevel = Literal["low", "medium", "high"]


def score_to_risk_level(anomaly_score: float) -> RiskLevel:
    if anomaly_score > 0.65:
        return "high"
    if anomaly_score > 0.3:
        return "medium"
    return "low"
