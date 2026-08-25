import { Panel, StatLine } from "@qbads/ui";
import { fetchModelPerformance, fetchPlatformHealth } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_HEALTH } from "../lib/emptyState";

const EMPTY_PERFORMANCE = {
  totalFeedback: 0,
  confirmedFraud: 0,
  confirmedLegitimate: 0,
  unresolved: 0,
  agreementRatePct: null as number | null,
  readyForAggregation: false,
};

export function AiMl() {
  const health = usePoll(fetchPlatformHealth, 5000, EMPTY_HEALTH);
  const performance = usePoll(fetchModelPerformance, 5000, EMPTY_PERFORMANCE);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      <Panel title="Active model" subtitle="Currently serving live inference">
        <StatLine label="Engine reachable" value={health.model.reachable ? "yes" : "no"} />
        <StatLine label="Model family" value={health.model.activeModelFamily ?? "—"} />
        <StatLine label="Model version" value={health.model.modelVersion ?? "—"} />
        <StatLine label="Trained on" value={health.model.trainedOn ?? "—"} />
        <StatLine label="Fallback rate (today)" value={`${health.model.fallbackRatePct}%`} trackPct={health.model.fallbackRatePct} trackColor="purple" />
      </Panel>

      <Panel title="Federated learning loop" subtitle="Institution feedback aggregation (Middleware doc, Section 4)">
        <StatLine label="Total feedback received" value={String(performance.totalFeedback)} />
        <StatLine label="Confirmed fraud" value={String(performance.confirmedFraud)} valueColor="red" />
        <StatLine label="Confirmed legitimate" value={String(performance.confirmedLegitimate)} valueColor="green" />
        <StatLine label="Unresolved" value={String(performance.unresolved)} valueColor="amber" />
        <StatLine
          label="Agreement rate"
          value={performance.agreementRatePct === null ? "n/a - no resolved feedback yet" : `${performance.agreementRatePct.toFixed(1)}%`}
        />
        <StatLine label="Ready for aggregation" value={performance.readyForAggregation ? "yes" : "not yet (batches of 25)"} />
      </Panel>
    </div>
  );
}
