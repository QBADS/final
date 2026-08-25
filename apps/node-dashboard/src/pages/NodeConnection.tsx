import { Panel, StatLine } from "@qbads/ui";
import { fetchInstitutionDetail, fetchNodeStatus } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_DETAIL, EMPTY_STATUS } from "../lib/emptyState";
import { connectionStatus } from "../lib/derive";

export function NodeConnection() {
  const detail = usePoll(fetchInstitutionDetail, 4000, EMPTY_DETAIL);
  const status = usePoll(fetchNodeStatus, 4000, EMPTY_STATUS);
  const connection = connectionStatus(status, detail.decisions);

  return (
    <Panel
      title="Node connection"
      subtitle="Middleware Node API status for this institution"
      tag={{ label: connection.status.toUpperCase(), color: connection.status === "healthy" ? "green" : connection.status === "degraded" ? "amber" : "red" }}
    >
      <StatLine label="Status" value={connection.status} />
      <StatLine label="Avg. pipeline latency" value={`${connection.apiLatencyMs}ms`} />
      <StatLine label="Last event" value={new Date(connection.lastHeartbeatAt).toLocaleString()} />
      <StatLine label="Connected since" value={new Date(detail.institution.connectedSince).toLocaleDateString()} />
      <StatLine label="Fabric organization" value={detail.institution.fabricOrgId} />
      <StatLine label="Region" value={detail.institution.region} />
    </Panel>
  );
}
