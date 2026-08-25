import { KpiCard, Panel, TransactionTable } from "@qbads/ui";
import { fetchInstitutionDetail } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_DETAIL } from "../lib/emptyState";
import { fraudSummary, recentTransactions } from "../lib/derive";

export function FraudRisk() {
  const detail = usePoll(fetchInstitutionDetail, 4000, EMPTY_DETAIL);
  const summary = fraudSummary(detail.decisions);
  const rows = recentTransactions(detail.transactions, detail.decisions, 200).filter(
    (r) => r.decision.decision !== "SAFE",
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Flagged today" value={String(summary.flaggedToday)} delta="FRAUD + HOLD" color="red" />
        <KpiCard label="In review" value={String(summary.reviewQueue)} delta="today" color="amber" />
        <KpiCard label="Confirmed fraud rate" value={`${summary.confirmedFraudRate}%`} delta="today" color="red" />
      </div>
      <Panel title="Fraud & risk queue" subtitle="Everything not scored SAFE, newest first" bodyClassName="!pt-1">
        <TransactionTable rows={rows} />
      </Panel>
    </div>
  );
}
