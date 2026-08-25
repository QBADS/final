import { useState } from "react";
import { Chip, Panel } from "@qbads/ui";
import { fetchInstitutionDetail, submitFeedback } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_DETAIL } from "../lib/emptyState";
import { recentTransactions } from "../lib/derive";

export function FeedbackPage() {
  const detail = usePoll(fetchInstitutionDetail, 4000, EMPTY_DETAIL);
  const [txId, setTxId] = useState("");
  const [verdict, setVerdict] = useState<"confirmed_fraud" | "confirmed_legitimate" | "unresolved">("confirmed_legitimate");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  const recent = recentTransactions(detail.transactions, detail.decisions, 20);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!txId) return;
    setStatus("submitting");
    try {
      await submitFeedback({ txId, institutionVerdict: verdict, note: note || undefined });
      setStatus("done");
      setTxId("");
      setNote("");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-3.5">
      <Panel title="Submit feedback" subtitle="Confirm or dispute a decision - feeds the federated learning loop">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 py-1">
          <label className="text-[11px]" style={{ color: "var(--txt2)" }}>
            Transaction
            <select value={txId} onChange={(e) => setTxId(e.target.value)} className="qb-tb-search w-full mt-1" required>
              <option value="">Select a transaction…</option>
              {recent.map((r) => (
                <option key={r.tx.txId} value={r.tx.txId}>
                  {r.tx.txId} · ${r.tx.amount.toLocaleString()} · {r.decision.decision}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px]" style={{ color: "var(--txt2)" }}>
            Verdict
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value as typeof verdict)}
              className="qb-tb-search w-full mt-1"
            >
              <option value="confirmed_legitimate">Confirmed legitimate</option>
              <option value="confirmed_fraud">Confirmed fraud</option>
              <option value="unresolved">Unresolved</option>
            </select>
          </label>
          <label className="text-[11px]" style={{ color: "var(--txt2)" }}>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} className="qb-tb-search w-full mt-1" placeholder="Context for the reviewer…" />
          </label>
          <button
            type="submit"
            disabled={!txId || status === "submitting"}
            className="text-[11.5px] font-medium rounded-md px-4 py-2 self-start"
            style={{
              color: "var(--cyan)",
              border: "1px solid var(--cyan)",
              background: "var(--cyan-dim)",
              opacity: !txId || status === "submitting" ? 0.5 : 1,
            }}
          >
            {status === "submitting" ? "Submitting…" : "Submit feedback"}
          </button>
          {status === "done" && <span style={{ color: "var(--green)" }}>Submitted - POST /api/node/feedback</span>}
          {status === "error" && <span style={{ color: "var(--red)" }}>Failed to submit - check Middleware is running</span>}
        </form>
      </Panel>

      <Panel title="Feedback history" subtitle="Your verdicts feed the federated learning loop" bodyClassName="!pt-1">
        {detail.feedback.length === 0 && (
          <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
            No feedback submitted yet.
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
            <Chip color={item.institutionVerdict === "confirmed_fraud" ? "red" : item.institutionVerdict === "confirmed_legitimate" ? "green" : "amber"}>
              {item.institutionVerdict.replace("_", " ")}
            </Chip>
          </div>
        ))}
      </Panel>
    </div>
  );
}
