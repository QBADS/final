import { KpiCard, Panel, StatLine } from "@qbads/ui";
import { fetchPlatformHealth } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_HEALTH } from "../lib/emptyState";

export function ApiGatewayPage() {
  const health = usePoll(fetchPlatformHealth, 4000, EMPTY_HEALTH);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Uptime" value={`${health.apiGateway.uptimePct}%`} delta="since process start" color="green" />
        <KpiCard label="Requests / sec" value={health.apiGateway.requestsPerSecond.toFixed(2)} delta="lifetime average" color="blue" />
        <KpiCard label="p99 latency" value={`${health.apiGateway.p99LatencyMs}ms`} delta="last 200 requests" color="cyan" />
      </div>
      <Panel title="API Gateway" subtitle="Middleware's own request handling (metrics.ts) - the entry layer for all four APIs">
        <StatLine label="Node API" value="authenticated (x-api-key)" />
        <StatLine label="Dashboard API" value="unauthenticated (reference implementation)" />
        <StatLine label="Blockchain API" value="outbound only - Middleware calls services/blockchain/gateway" />
        <StatLine label="Quantum Model API" value="outbound only - Middleware calls services/quantum-pipeline" />
      </Panel>
    </div>
  );
}
