import { useState } from "react";
import { Panel, TransactionTable } from "@qbads/ui";
import type { Institution } from "@qbads/types";
import { fetchInstitutions, fetchTransactions } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

export function TransactionCentre() {
  const [institutionId, setInstitutionId] = useState("");
  const institutions = usePoll(fetchInstitutions, 8000, [] as Institution[]);
  const rows = usePoll(() => fetchTransactions(institutionId ? { institutionId } : {}), 4000, [], [institutionId]);

  return (
    <Panel
      title="Transaction centre"
      subtitle={`${rows.length} transactions${institutionId ? " (filtered)" : ""}`}
      tag={{ label: "ALL INSTITUTIONS", color: "cyan" }}
      bodyClassName="!pt-2"
    >
      <select
        value={institutionId}
        onChange={(e) => setInstitutionId(e.target.value)}
        className="qb-tb-search mb-3"
        style={{ width: 220 }}
      >
        <option value="">All institutions</option>
        {institutions.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
      <TransactionTable rows={rows} showInstitution />
    </Panel>
  );
}
