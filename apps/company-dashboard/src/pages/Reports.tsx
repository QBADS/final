import { useState } from "react";
import { Panel, StatLine } from "@qbads/ui";
import { fetchFraudStats, fetchInstitutions, fetchKpis } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_FRAUD_STATS, EMPTY_KPIS } from "../lib/emptyState";

export function Reports() {
  const kpis = usePoll(fetchKpis, 8000, EMPTY_KPIS);
  const fraudStats = usePoll(fetchFraudStats, 8000, EMPTY_FRAUD_STATS);
  const institutions = usePoll(fetchInstitutions, 8000, []);
  const [generatedAt] = useState(() => new Date());

  const byStatus = { healthy: 0, degraded: 0, offline: 0 };
  for (const i of institutions) byStatus[i.status] += 1;

  return (
    <Panel title="Daily summary report" subtitle={`Generated ${generatedAt.toLocaleString()} - live data, not a stored snapshot`}>
      <StatLine label="Connected institutions" value={String(kpis.connectedInstitutions)} />
      <StatLine label="  healthy / degraded / offline" value={`${byStatus.healthy} / ${byStatus.degraded} / ${byStatus.offline}`} />
      <StatLine label="Transactions today" value={kpis.transactionsToday.toLocaleString()} />
      <StatLine label="Flagged (FRAUD/HOLD)" value={String(fraudStats.detectedToday)} valueColor="red" />
      <StatLine label="Flagged amount" value={`$${fraudStats.estimatedSavingsUsd.toLocaleString()}`} valueColor="green" />
      <StatLine label="Composite risk score" value={fraudStats.compositeRiskScore.toFixed(1)} />
      <StatLine label="Quantum vs. fallback decisions" value={`${fraudStats.quantumDecisionsToday} / ${fraudStats.fallbackDecisionsToday}`} />
      <StatLine label="Avg. detection time" value={`${fraudStats.avgDetectionTimeMs}ms`} />
      <div className="text-[11px] pt-3" style={{ color: "var(--txt3)" }}>
        This report re-computes from current Middleware state on every visit - there's no
        persistent report store or scheduling in this reference implementation.
      </div>
    </Panel>
  );
}
