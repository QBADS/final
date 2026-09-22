import { useState } from "react";
import { Chip, Panel } from "@qbads/ui";
import type { Institution } from "@qbads/types";
import {
  approveInstitution,
  fetchInstitutions,
  fetchPendingInstitutions,
  institutionSubtitle,
  rejectInstitution,
  revokeInstitution,
  rotateInstitutionKey,
} from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

interface RevealedKey {
  institutionName: string;
  apiKey: string;
}

/**
 * Exec-admin review queue for institution onboarding
 * (services/middleware/src/routes/onboardingApi.ts's public POST
 * /api/institutions/apply feeds this). Not instant self-service by design -
 * every application sits pending until reviewed here, and every issued key
 * is shown exactly once, right after approval/rotation, never again.
 */
export function InstitutionOnboarding() {
  const [revealedKey, setRevealedKey] = useState<RevealedKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const pending = usePoll(fetchPendingInstitutions, 4000, [] as Institution[], [refreshTick]);
  const allInstitutions = usePoll(fetchInstitutions, 5000, [] as Institution[], [refreshTick]);
  const active = allInstitutions.filter((i) => i.onboardingStatus === "active");

  function refresh() {
    setRefreshTick((t) => t + 1);
  }

  async function handleApprove(inst: Institution) {
    setBusyId(inst.id);
    setError(null);
    try {
      const result = await approveInstitution(inst.id);
      setRevealedKey({ institutionName: inst.name, apiKey: result.apiKey });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(inst: Institution) {
    const reason = window.prompt(`Reason for rejecting "${inst.name}"?`);
    if (!reason || !reason.trim()) return;
    setBusyId(inst.id);
    setError(null);
    try {
      await rejectInstitution(inst.id, reason.trim());
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRotate(inst: Institution) {
    if (!window.confirm(`Rotate the API key for "${inst.name}"? The current key will stop working immediately.`)) return;
    setBusyId(inst.id);
    setError(null);
    try {
      const result = await rotateInstitutionKey(inst.id);
      setRevealedKey({ institutionName: inst.name, apiKey: result.apiKey });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevoke(inst: Institution) {
    if (!window.confirm(`Revoke access for "${inst.name}"? Their API key will stop working immediately.`)) return;
    setBusyId(inst.id);
    setError(null);
    try {
      await revokeInstitution(inst.id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {revealedKey && (
        <div
          className="qb-panel flex flex-col gap-1.5 p-3.5"
          style={{ border: "1px solid var(--green)", background: "var(--green-dim)" }}
        >
          <div className="text-[12px] font-semibold" style={{ color: "var(--green)" }}>
            API key issued for {revealedKey.institutionName} - shown once, copy it now
          </div>
          <div className="text-[10.5px]" style={{ color: "var(--txt2)" }}>
            This key will never be shown again. It is stored only as a hash - if lost, the only recovery is rotating
            to a brand new key.
          </div>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-[12px] px-2 py-1 rounded font-mono flex-1 overflow-x-auto" style={{ background: "var(--card)", color: "var(--txt)" }}>
              {revealedKey.apiKey}
            </code>
            <button
              className="text-[11px] px-2.5 py-1 rounded font-medium"
              style={{ background: "var(--green)", color: "var(--bg)" }}
              onClick={() => navigator.clipboard?.writeText(revealedKey.apiKey)}
            >
              Copy
            </button>
            <button
              className="text-[11px] px-2.5 py-1 rounded font-medium"
              style={{ background: "var(--card2)", color: "var(--txt2)" }}
              onClick={() => setRevealedKey(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="qb-panel p-3 text-[11.5px]" style={{ border: "1px solid var(--red)", color: "var(--red)" }}>
          {error}
        </div>
      )}

      <Panel
        title="Pending applications"
        subtitle="Institutions that applied via POST /api/institutions/apply, awaiting review"
        tag={{ label: String(pending.length), color: pending.length ? "amber" : "green" }}
      >
        {pending.length === 0 && (
          <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
            No pending applications.
          </div>
        )}
        {pending.map((inst) => (
          <div key={inst.id} className="qb-stat-line items-start">
            <span className="k">
              {inst.name}
              <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                {institutionSubtitle(inst)} · {inst.contactName} &lt;{inst.contactEmail}&gt;
              </span>
              <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                Applied {inst.appliedAt ? new Date(inst.appliedAt).toLocaleString() : "—"}
              </span>
            </span>
            <span className="flex gap-1.5">
              <button
                disabled={busyId === inst.id}
                className="text-[11px] px-2.5 py-1 rounded font-medium disabled:opacity-50"
                style={{ background: "var(--green)", color: "var(--bg)" }}
                onClick={() => handleApprove(inst)}
              >
                Approve
              </button>
              <button
                disabled={busyId === inst.id}
                className="text-[11px] px-2.5 py-1 rounded font-medium disabled:opacity-50"
                style={{ background: "var(--red-dim)", color: "var(--red)" }}
                onClick={() => handleReject(inst)}
              >
                Reject
              </button>
            </span>
          </div>
        ))}
      </Panel>

      <Panel title="Active institutions" subtitle="Approved and currently able to submit transactions" tag={{ label: String(active.length), color: "green" }}>
        {active.length === 0 && (
          <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
            No active institutions yet.
          </div>
        )}
        {active.map((inst) => (
          <div key={inst.id} className="qb-stat-line">
            <span className="k">
              {inst.name}
              <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                {institutionSubtitle(inst)} · approved by {inst.approvedBy ?? "—"}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Chip color={inst.status === "healthy" ? "green" : inst.status === "degraded" ? "amber" : "red"}>{inst.status}</Chip>
              <button
                disabled={busyId === inst.id}
                className="text-[11px] px-2.5 py-1 rounded font-medium disabled:opacity-50"
                style={{ background: "var(--blue-dim)", color: "var(--blue)" }}
                onClick={() => handleRotate(inst)}
              >
                Rotate key
              </button>
              <button
                disabled={busyId === inst.id}
                className="text-[11px] px-2.5 py-1 rounded font-medium disabled:opacity-50"
                style={{ background: "var(--red-dim)", color: "var(--red)" }}
                onClick={() => handleRevoke(inst)}
              >
                Revoke
              </button>
            </span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
