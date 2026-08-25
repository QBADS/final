import { Panel, TransactionTable } from "@qbads/ui";
import { fetchTransactions } from "../lib/apiClient";
import { usePoll, useLiveFeed } from "../lib/useApi";

export function LiveMonitoring() {
  const feed = useLiveFeed(20);
  const recent = usePoll(() => fetchTransactions(), 4000, []);

  return (
    <div className="grid grid-cols-1 gap-3.5">
      <Panel title="Live risk events" subtitle="Every scored transaction, newest first" tag={{ label: "SSE", color: "cyan" }}>
        <div className="flex flex-col gap-1">
          {feed.length === 0 && (
            <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
              Waiting for transactions…
            </div>
          )}
          {feed.map((event) => (
            <div key={event.id} className="qb-stat-line">
              <span className="k">
                {event.transactionId} · {event.institutionName}
              </span>
              <span className="v" style={{ color: event.riskLevel === "high" ? "var(--red)" : event.riskLevel === "medium" ? "var(--amber)" : "var(--green)" }}>
                {event.riskScore.toFixed(1)} · {event.chainStatus}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recent transactions" subtitle="Polled from Middleware every 4s, all institutions" bodyClassName="!pt-1">
        <TransactionTable rows={recent.slice(0, 25)} showInstitution />
      </Panel>
    </div>
  );
}
