import { KpiCard, Panel, TransactionTable } from "@qbads/ui";
import { fetchTransactions } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

export function CaseManagement() {
  const rows = usePoll(() => fetchTransactions({ decision: "REVIEW" }), 4000, []);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Open cases" value={String(rows.length)} delta="decision = REVIEW" color="amber" />
        <KpiCard
          label="Avg. risk score"
          value={rows.length ? (rows.reduce((s, r) => s + r.decision.riskScore, 0) / rows.length).toFixed(1) : "0.0"}
          delta="within the review band"
          color="amber"
        />
      </div>
      <Panel title="Case management" subtitle="Transactions the decision engine sent for human review" bodyClassName="!pt-1">
        <TransactionTable rows={rows} showInstitution />
      </Panel>
    </div>
  );
}
