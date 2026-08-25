import { KpiCard, Panel, StatLine } from "@qbads/ui";
import { fetchFraudStats, fetchKpis, fetchTransactions } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_FRAUD_STATS, EMPTY_KPIS } from "../lib/emptyState";

export function KpiAnalytics() {
  const kpis = usePoll(fetchKpis, 4000, EMPTY_KPIS);
  const fraudStats = usePoll(fetchFraudStats, 4000, EMPTY_FRAUD_STATS);
  const rows = usePoll(() => fetchTransactions(), 5000, []);

  const byRiskLevel = { low: 0, medium: 0, high: 0 };
  const byDecision: Record<string, number> = { SAFE: 0, REVIEW: 0, FRAUD: 0, HOLD: 0 };
  for (const r of rows) {
    byRiskLevel[r.decision.riskLevel] += 1;
    byDecision[r.decision.decision] = (byDecision[r.decision.decision] ?? 0) + 1;
  }
  const total = rows.length || 1;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Transactions today" value={kpis.transactionsToday.toLocaleString()} delta="all institutions" color="blue" />
        <KpiCard label="Composite risk score" value={fraudStats.compositeRiskScore.toFixed(1)} delta={`threshold ${fraudStats.riskThreshold}`} color="amber" />
        <KpiCard label="Quantum-scored" value={String(fraudStats.quantumDecisionsToday)} delta={`${fraudStats.fallbackDecisionsToday} fallback`} color="purple" />
        <KpiCard label="Avg. detection time" value={`${fraudStats.avgDetectionTimeMs}ms`} delta="full pipeline" color="cyan" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Panel title="Risk level distribution" subtitle={`${rows.length} scored transactions`}>
          <StatLine label="Low" value={`${byRiskLevel.low} (${((byRiskLevel.low / total) * 100).toFixed(0)}%)`} trackPct={(byRiskLevel.low / total) * 100} trackColor="green" />
          <StatLine label="Medium" value={`${byRiskLevel.medium} (${((byRiskLevel.medium / total) * 100).toFixed(0)}%)`} trackPct={(byRiskLevel.medium / total) * 100} trackColor="amber" />
          <StatLine label="High" value={`${byRiskLevel.high} (${((byRiskLevel.high / total) * 100).toFixed(0)}%)`} trackPct={(byRiskLevel.high / total) * 100} trackColor="red" />
        </Panel>

        <Panel title="Decision breakdown" subtitle="Middleware decision engine outcomes">
          <StatLine label="Safe" value={String(byDecision.SAFE)} trackPct={(byDecision.SAFE / total) * 100} trackColor="green" />
          <StatLine label="Review" value={String(byDecision.REVIEW)} trackPct={(byDecision.REVIEW / total) * 100} trackColor="amber" />
          <StatLine label="Fraud" value={String(byDecision.FRAUD)} trackPct={(byDecision.FRAUD / total) * 100} trackColor="red" />
          <StatLine label="Hold (classical fallback)" value={String(byDecision.HOLD)} trackPct={(byDecision.HOLD / total) * 100} trackColor="blue" />
        </Panel>
      </div>
    </div>
  );
}
