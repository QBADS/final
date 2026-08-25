import { Chip, Gauge, KpiCard, Panel, StatLine } from "@qbads/ui";
import type { ChipColor } from "@qbads/ui";
import type { RiskDecision } from "@qbads/types";
import { fetchInstitutionDetail, fetchNodeStatus } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_DETAIL, EMPTY_STATUS } from "../lib/emptyState";
import { apiUsage, connectionStatus, decisionSourceSummary, fraudSummary, recentTransactions } from "../lib/derive";

const decisionChip: Record<RiskDecision, { color: ChipColor; label: string }> = {
  SAFE: { color: "green", label: "Safe" },
  REVIEW: { color: "amber", label: "Review" },
  FRAUD: { color: "red", label: "Fraud" },
  HOLD: { color: "blue", label: "Hold" },
};

export function Overview() {
  const detail = usePoll(fetchInstitutionDetail, 4000, EMPTY_DETAIL);
  const status = usePoll(fetchNodeStatus, 4000, EMPTY_STATUS);

  const fraud = fraudSummary(detail.decisions);
  const usage = apiUsage(status, detail.decisions);
  const connection = connectionStatus(status, detail.decisions);
  const { fallbackPct, latestModelVersion } = decisionSourceSummary(detail.decisions);
  const rows = recentTransactions(detail.transactions, detail.decisions);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Transactions today" value={fraud.transactionsToday.toLocaleString()} delta="this institution" color="blue" />
        <KpiCard label="Flagged for review" value={String(fraud.flaggedToday)} delta={`${fraud.reviewQueue} in queue`} color="amber" />
        <KpiCard label="Confirmed fraud rate" value={`${fraud.confirmedFraudRate}%`} delta="today" color="red" />
        <KpiCard label="API health" value={connection.status === "healthy" ? "Healthy" : connection.status} delta={`${connection.apiLatencyMs}ms avg`} color="green" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-3.5">
        <Panel title="Recent transactions" subtitle="Your submissions, scored by QBADS" tag={{ label: "LIVE", color: "cyan" }} bodyClassName="!pt-1">
          {rows.length === 0 && <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>No transactions submitted yet.</div>}
          {rows.map(({ tx, decision }) => {
            const chip = decisionChip[decision.decision];
            return (
              <div key={tx.txId} className="qb-feed-row" style={{ gridTemplateColumns: "90px 90px 100px 90px 1fr" }}>
                <span className="qb-feed-id">{tx.txId}</span>
                <span style={{ color: "var(--txt2)" }}>${tx.amount.toLocaleString()}</span>
                <Chip color="blue">{tx.chainConfirmed ? "chain ✓" : "chain …"}</Chip>
                <Chip color={chip.color}>{chip.label}</Chip>
                <span className="qb-feed-score">{decision.riskScore.toFixed(1)}</span>
              </div>
            );
          })}
        </Panel>

        <Panel title="Composite risk" subtitle="Your institution, current window">
          <Gauge value={fraud.compositeRiskScore} max={100} label="Composite risk score" color="var(--green)" />
          <StatLine label="Model version" value={latestModelVersion} />
          <StatLine label="Decision source" value={`Quantum model (fallback ${fallbackPct}%)`} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Panel title="Node connection & API usage" subtitle="Middleware Node API status">
          <StatLine label="Connection status" value={connection.status} />
          <StatLine label="Avg. pipeline latency" value={`${connection.apiLatencyMs} ms`} />
          <StatLine
            label="Requests today"
            value={`${usage.requestsToday.toLocaleString()} / ${usage.requestsQuotaDaily.toLocaleString()}`}
            trackPct={(usage.requestsToday / usage.requestsQuotaDaily) * 100}
            trackColor="blue"
          />
          <StatLine label="Fallback rate" value={`${usage.fallbackRatePct}%`} />
        </Panel>

        <Panel title="Feedback to model" subtitle="Your verdicts feed the federated learning loop">
          {detail.feedback.length === 0 && (
            <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
              No feedback submitted yet - use POST /api/node/feedback to confirm or dispute a decision.
            </div>
          )}
          {detail.feedback.map((item) => (
            <div key={item.id} className="qb-stat-line">
              <span className="k">
                {item.txId}
                {item.note && (
                  <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                    {item.note}
                  </span>
                )}
              </span>
              <Chip
                color={
                  item.institutionVerdict === "confirmed_fraud"
                    ? "red"
                    : item.institutionVerdict === "confirmed_legitimate"
                      ? "green"
                      : "amber"
                }
              >
                {item.institutionVerdict.replace("_", " ")}
              </Chip>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}
