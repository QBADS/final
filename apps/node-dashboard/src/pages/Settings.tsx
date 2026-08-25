import { Panel, StatLine } from "@qbads/ui";
import { fetchInstitutionDetail, NODE_INSTITUTION_ID } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_DETAIL } from "../lib/emptyState";

export function Settings() {
  const detail = usePoll(fetchInstitutionDetail, 8000, EMPTY_DETAIL);
  const inst = detail.institution;

  return (
    <Panel title="Institution profile" subtitle="Read-only - Middleware has no institution-editing endpoint yet">
      <StatLine label="Institution ID" value={NODE_INSTITUTION_ID} />
      <StatLine label="Name" value={inst.name} />
      <StatLine label="Kind" value={inst.kind} />
      <StatLine label="Region" value={inst.region} />
      <StatLine label="Fabric organization" value={inst.fabricOrgId} />
      <StatLine label="Status" value={inst.status} />
      <StatLine label="Connected since" value={new Date(inst.connectedSince).toLocaleDateString()} />
    </Panel>
  );
}
