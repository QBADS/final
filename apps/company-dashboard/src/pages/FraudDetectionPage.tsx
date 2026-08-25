import { KpiCard, Panel, TransactionTable } from "@qbads/ui";
import { fetchTransactions } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

export function FraudDetectionPage() {
  const rows = usePoll(() => fetchTransactions(), 4000, []);
  const flagged = rows.filter((r) => r.decision.decision === "FRAUD" || r.decision.decision === "HOLD");
  const fraud = flagged.filter((r) => r.decision.decision === "FRAUD");
  const hold = flagged.filter((r) => r.decision.decision === "HOLD");

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Flagged" value={String(flagged.length)} delta="FRAUD + HOLD" color="red" />
        <KpiCard label="Fraud (quantum-confirmed)" value={String(fraud.length)} delta="above fraud threshold" color="red" />
        <KpiCard label="Hold (classical fallback)" value={String(hold.length)} delta="quantum engine was unavailable" color="blue" />
      </div>
      <Panel title="Fraud detection queue" subtitle="Every FRAUD or HOLD decision, newest first" bodyClassName="!pt-1">
        <TransactionTable rows={flagged} showInstitution />
      </Panel>
    </div>
  );
}
