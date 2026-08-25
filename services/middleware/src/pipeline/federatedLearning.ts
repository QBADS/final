import { store } from "../store/inMemoryStore";

/**
 * "Federated Learning Loop" (QBADS_Middleware_Flow_Structure.pdf, Section
 * 4): collects anonymized stats/gradients from institution feedback,
 * aggregates across institutions, and would push updated parameters back
 * through the Quantum Model API. It never sees raw PII and never makes a
 * fraud decision itself - it only summarizes what institutions confirmed.
 *
 * There's no real quantum model to push trained parameters to yet (see
 * services/quantum-pipeline/README.md), so this stops at the aggregation
 * step and reports what a real push would be based on, rather than faking
 * a training run.
 */
export interface FederatedLearningSnapshot {
  totalFeedback: number;
  confirmedFraud: number;
  confirmedLegitimate: number;
  unresolved: number;
  agreementRatePct: number | null; // feedback that matched the original decision
  readyForAggregation: boolean; // arbitrary demo threshold - "enough signal to justify a push"
}

const AGGREGATION_BATCH_SIZE = 25;

export function federatedLearningSnapshot(): FederatedLearningSnapshot {
  const feedback = store.feedback;
  const confirmedFraud = feedback.filter((f) => f.institutionVerdict === "confirmed_fraud").length;
  const confirmedLegitimate = feedback.filter((f) => f.institutionVerdict === "confirmed_legitimate").length;
  const unresolved = feedback.filter((f) => f.institutionVerdict === "unresolved").length;

  const resolved = feedback.filter((f) => f.institutionVerdict !== "unresolved");
  let agreementRatePct: number | null = null;
  if (resolved.length > 0) {
    const agreeing = resolved.filter((f) => {
      const decision = store.decisions.get(f.txId);
      if (!decision) return false;
      const decisionSaysFraud = decision.decision === "FRAUD" || decision.decision === "HOLD";
      return (f.institutionVerdict === "confirmed_fraud") === decisionSaysFraud;
    });
    agreementRatePct = (agreeing.length / resolved.length) * 100;
  }

  return {
    totalFeedback: feedback.length,
    confirmedFraud,
    confirmedLegitimate,
    unresolved,
    agreementRatePct,
    readyForAggregation: feedback.length > 0 && feedback.length % AGGREGATION_BATCH_SIZE === 0,
  };
}
