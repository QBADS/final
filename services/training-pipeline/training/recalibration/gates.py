"""
"7. Two Independent Gates ... lighter than the model-promotion path's three
gates, by design: weights never move, so there is no Data gate to re-run"
(QBADS_Recalibration_Architecture.pdf, Section 07).
"""

from dataclasses import dataclass, field

from .supervisor import SupervisorVerdict

MIN_BRIER_IMPROVEMENT = 0.01  # "safe enough, and large enough, to justify a live swap"


@dataclass
class GateResult:
    name: str
    passed: bool
    ran: bool
    reasons: list = field(default_factory=list)


@dataclass
class RecalibrationGateOutcome:
    fidelity_gate: GateResult
    deployment_gate: GateResult

    @property
    def promotable(self) -> bool:
        return self.fidelity_gate.passed and self.deployment_gate.passed


def _gate1_fidelity(verdict: SupervisorVerdict) -> GateResult:
    """By the time a verdict reaches here, cycle.py's pre-Supervisor
    monotonicity filter has already discarded any non-monotonic candidate
    (Section 05) - `verdict.rank_safety.monotonic` is re-checked below only
    as a defensive, redundant confirmation of that invariant, not as the
    primary enforcement point."""
    reasons = []
    passed = True

    if not verdict.rank_safety.monotonic:
        passed = False
        reasons.append("candidate map is not monotonic")
    if not verdict.rank_safety.passed:
        passed = False
        reasons.append(
            f"rank safety failed: recall {verdict.rank_safety.recall_before:.3f}->{verdict.rank_safety.recall_after:.3f}, "
            f"precision {verdict.rank_safety.precision_before:.3f}->{verdict.rank_safety.precision_after:.3f}, "
            f"population shift {verdict.rank_safety.threshold_population_shift_pct}%"
        )

    brier_gain = verdict.findings["reliability"]["brierBefore"] - verdict.findings["reliability"]["brierAfter"]
    if brier_gain <= 0:
        passed = False
        reasons.append(f"Brier did not improve ({brier_gain:+.4f})")

    if not verdict.recommend:
        reasons.append(f"AI Recalibration Supervisor does not recommend (score {verdict.recalibration_score:.3f})")

    return GateResult(name="fidelity", passed=passed, ran=True, reasons=reasons)


def _gate2_deployment(verdict: SupervisorVerdict) -> GateResult:
    reasons = []
    passed = True

    if not verdict.findings["operational"]["sampleAdequate"]:
        passed = False
        reasons.append(f"holdout sample too thin ({verdict.findings['operational']['holdoutSamples']} samples)")

    brier_gain = verdict.findings["reliability"]["brierBefore"] - verdict.findings["reliability"]["brierAfter"]
    if brier_gain < MIN_BRIER_IMPROVEMENT:
        passed = False
        reasons.append(f"Brier improvement {brier_gain:.4f} below minimum {MIN_BRIER_IMPROVEMENT} - not worth a live swap")

    return GateResult(name="deployment", passed=passed, ran=True, reasons=reasons)


def evaluate_gates(verdict: SupervisorVerdict) -> RecalibrationGateOutcome:
    fidelity = _gate1_fidelity(verdict)
    if not fidelity.passed:
        skipped = GateResult(name="skipped", passed=False, ran=False, reasons=["upstream gate failed"])
        return RecalibrationGateOutcome(fidelity_gate=fidelity, deployment_gate=skipped)

    deployment = _gate2_deployment(verdict)
    return RecalibrationGateOutcome(fidelity_gate=fidelity, deployment_gate=deployment)
