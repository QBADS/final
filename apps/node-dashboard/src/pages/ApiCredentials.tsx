import { Panel, StatLine } from "@qbads/ui";
import { fetchInstitutionDetail, fetchNodeStatus, NODE_API_KEY } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_DETAIL, EMPTY_STATUS } from "../lib/emptyState";
import { apiUsage } from "../lib/derive";

function maskKey(key: string): string {
  return key.length <= 18 ? key : `${key.slice(0, 14)}…${key.slice(-4)}`;
}

export function ApiCredentials() {
  const detail = usePoll(fetchInstitutionDetail, 6000, EMPTY_DETAIL);
  const status = usePoll(fetchNodeStatus, 4000, EMPTY_STATUS);
  const usage = apiUsage(status, detail.decisions);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      <Panel title="API credentials" subtitle="This sandbox's Node API key">
        <StatLine label="Key" value={maskKey(NODE_API_KEY)} />
        <StatLine label="Scope" value="submit_transactions, read_own_status" />
        <StatLine label="Environment" value="sandbox" />
        <StatLine label="Fabric org" value={detail.institution.fabricOrgId} />
      </Panel>

      <Panel title="Usage" subtitle="Real request counts from Middleware's Node API">
        <StatLine
          label="Requests today"
          value={`${usage.requestsToday.toLocaleString()} / ${usage.requestsQuotaDaily.toLocaleString()}`}
          trackPct={(usage.requestsToday / usage.requestsQuotaDaily) * 100}
          trackColor="blue"
        />
        <StatLine label="Avg. pipeline latency" value={`${usage.avgLatencyMs}ms`} />
        <StatLine label="Fallback rate" value={`${usage.fallbackRatePct}%`} />
        <div className="text-[11px] pt-3" style={{ color: "var(--txt3)" }}>
          Daily quota is a configured sandbox limit, not enforced - Middleware has no rate
          limiter yet.
        </div>
      </Panel>
    </div>
  );
}
