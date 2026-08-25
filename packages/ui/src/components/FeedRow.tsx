import type { LiveFeedEvent } from "@qbads/types";
import { Chip, riskChip } from "./Chip";

export function FeedRow({ event }: { event: LiveFeedEvent }) {
  const chip = riskChip(event.riskLevel);
  return (
    <div className="qb-feed-row">
      <span className="qb-feed-id">{event.transactionId}</span>
      <span style={{ color: "var(--txt2)" }}>{event.institutionName}</span>
      <Chip color="blue">chain {event.chainStatus === "confirmed" ? "✓" : "..."}</Chip>
      <Chip color={chip.color}>{chip.label}</Chip>
      <span className="qb-feed-score">{event.riskScore.toFixed(1)}</span>
    </div>
  );
}
