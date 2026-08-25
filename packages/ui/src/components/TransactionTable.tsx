import type { FraudDecision, Transaction } from "@qbads/types";
import { Chip, riskChip } from "./Chip";

export interface TransactionTableRow {
  tx: Transaction;
  decision: FraudDecision;
  institutionName?: string;
}

const decisionChipColor: Record<FraudDecision["decision"], "green" | "amber" | "red" | "blue"> = {
  SAFE: "green",
  REVIEW: "amber",
  FRAUD: "red",
  HOLD: "blue",
};

export function TransactionTable({ rows, showInstitution = false }: { rows: TransactionTableRow[]; showInstitution?: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
        No matching transactions.
      </div>
    );
  }

  const columns = showInstitution
    ? "84px 1fr 74px 80px 64px 70px 56px"
    : "90px 74px 80px 64px 70px 56px";

  return (
    <div className="flex flex-col">
      {rows.map(({ tx, decision, institutionName }) => {
        const risk = riskChip(decision.riskLevel);
        return (
          <div key={tx.txId} className="qb-feed-row" style={{ gridTemplateColumns: columns }}>
            <span className="qb-feed-id">{tx.txId}</span>
            {showInstitution && <span style={{ color: "var(--txt2)" }}>{institutionName}</span>}
            <span style={{ color: "var(--txt2)" }}>${tx.amount.toLocaleString()}</span>
            <Chip color="blue">{tx.chainConfirmed ? "chain ✓" : "chain …"}</Chip>
            <Chip color={risk.color}>{risk.label}</Chip>
            <Chip color={decisionChipColor[decision.decision]}>{decision.decision}</Chip>
            <span className="qb-feed-score">{decision.riskScore.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}
