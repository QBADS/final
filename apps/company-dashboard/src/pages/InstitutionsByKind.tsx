import { InstitutionRow, Panel } from "@qbads/ui";
import type { Institution } from "@qbads/types";
import { fetchInstitutions, institutionSubtitle } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

export function InstitutionsByKind({ kinds, label }: { kinds: Institution["kind"][]; label: string }) {
  const institutions = usePoll(fetchInstitutions, 5000, [] as Institution[]);
  const filtered = institutions.filter((i) => kinds.includes(i.kind));

  return (
    <Panel title={label} subtitle={`${filtered.length} connected`}>
      {filtered.length === 0 && (
        <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
          No {label.toLowerCase()} connected.
        </div>
      )}
      {filtered.map((inst) => (
        <InstitutionRow
          key={inst.id}
          name={inst.name}
          subtitle={institutionSubtitle(inst)}
          status={inst.status}
          metric={`${inst.syncHealthPct.toFixed(1)}%`}
        />
      ))}
    </Panel>
  );
}
