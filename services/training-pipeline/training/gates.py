"""
"7. Three Independent Gates: Gate 1 - Data (Is this training dataset
trustworthy?) -> Gate 2 - Model (Did the model actually improve?) -> Gate 3 -
Deployment (Is the improvement safe enough to release?)"
(QBADS_Training_Learning_Architecture.pdf, Section 07). "Only DATA PASS ->
MODEL PASS -> DEPLOYMENT PASS permits promotion" - sequential, and gate 2+3
never run if gate 1 fails.
"""

from dataclasses import dataclass, field

from .ai_training_supervisor import SupervisorVerdict
from .benchmarking import BenchmarkResult
from .config import settings
from .data_quality import QualityReport


@dataclass
class GateResult:
    name: str
    passed: bool
    ran: bool
    reasons: list = field(default_factory=list)


@dataclass
class GateOutcome:
    data_gate: GateResult
    model_gate: GateResult
    deployment_gate: GateResult

    @property
    def promotable(self) -> bool:
        return self.data_gate.passed and self.model_gate.passed and self.deployment_gate.passed


def _gate1_data(quality_report: QualityReport) -> GateResult:
    reasons = list(quality_report.reasons)
    return GateResult(name="data", passed=quality_report.passed, ran=True, reasons=reasons)


def _gate2_model(
    bench: BenchmarkResult,
    supervisor: SupervisorVerdict,
    champion_bench: BenchmarkResult | None,
) -> GateResult:
    reasons = []
    passed = True

    # Deterministic floor, independent of the supervisor's opinion - this is
    # the "never overrides deterministic evaluation" rule from Section 06
    # made concrete.
    if bench.recall < 0.2:
        passed = False
        reasons.append(f"recall {bench.recall:.3f} below absolute floor 0.2")

    if champion_bench is not None:
        regression = champion_bench.f1 - bench.f1
        if regression > settings.max_regression_vs_champion:
            passed = False
            reasons.append(
                f"F1 regression vs champion: {champion_bench.f1:.3f} -> {bench.f1:.3f} "
                f"(regressed {regression:.3f}, max allowed {settings.max_regression_vs_champion})"
            )
    else:
        reasons.append("no incumbent champion - evaluated against absolute floors only")

    if not supervisor.recommend:
        reasons.append(f"AI Training Supervisor does not recommend (quality score {supervisor.quality_score:.3f})")
        # Advisory only, per Section 06's rule - does not flip `passed` on its own.

    return GateResult(name="model", passed=passed, ran=True, reasons=reasons)


def _gate3_deployment(bench: BenchmarkResult) -> GateResult:
    reasons = []
    passed = True

    if bench.failure_rate > 0:
        passed = False
        reasons.append(f"failure rate {bench.failure_rate:.2%} during benchmarking")

    if bench.inference_latency_ms == bench.inference_latency_ms and bench.inference_latency_ms > settings.max_inference_latency_ms:
        passed = False
        reasons.append(f"inference latency {bench.inference_latency_ms:.1f}ms exceeds {settings.max_inference_latency_ms}ms")

    if bench.stress_test_recall is not None:
        reasons.append(f"stress-test recall {bench.stress_test_recall:.3f} (informational, not gating - small sample)")

    return GateResult(name="deployment", passed=passed, ran=True, reasons=reasons)


def evaluate_gates(
    quality_report: QualityReport,
    bench: BenchmarkResult,
    supervisor: SupervisorVerdict,
    champion_bench: BenchmarkResult | None,
) -> GateOutcome:
    data_gate = _gate1_data(quality_report)
    if not data_gate.passed:
        skipped = GateResult(name="skipped", passed=False, ran=False, reasons=["upstream gate failed"])
        return GateOutcome(data_gate=data_gate, model_gate=skipped, deployment_gate=skipped)

    model_gate = _gate2_model(bench, supervisor, champion_bench)
    if not model_gate.passed:
        skipped = GateResult(name="skipped", passed=False, ran=False, reasons=["upstream gate failed"])
        return GateOutcome(data_gate=data_gate, model_gate=model_gate, deployment_gate=skipped)

    deployment_gate = _gate3_deployment(bench)
    return GateOutcome(data_gate=data_gate, model_gate=model_gate, deployment_gate=deployment_gate)
