import {
  CartesianGrid,
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FeedRow, Gauge, InstitutionRow, KpiCard, Panel, StatLine } from "@qbads/ui";
import {
  fetchFraudStats,
  fetchInstitutions,
  fetchPlatformHealth,
  fetchKpis,
  fetchVolumeSeries,
  institutionSubtitle,
} from "../lib/apiClient";
import { usePoll, useLiveFeed } from "../lib/useApi";
import { EMPTY_FRAUD_STATS, EMPTY_HEALTH, EMPTY_KPIS } from "../lib/emptyState";

export function Overview() {
  const kpis = usePoll(fetchKpis, 4000, EMPTY_KPIS);
  const fraudStats = usePoll(fetchFraudStats, 4000, EMPTY_FRAUD_STATS);
  const health = usePoll(fetchPlatformHealth, 5000, EMPTY_HEALTH);
  const institutions = usePoll(fetchInstitutions, 6000, [] as Awaited<ReturnType<typeof fetchInstitutions>>);
  const volumeSeries = usePoll(fetchVolumeSeries, 15000, [] as Awaited<ReturnType<typeof fetchVolumeSeries>>);
  const feed = useLiveFeed(8);

  const onlineCount = institutions.filter((i) => i.status !== "offline").length;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Connected institutions" value={kpis.connectedInstitutions.toLocaleString()} delta="live" color="blue" />
        <KpiCard label="Live transactions / sec" value={kpis.liveTransactionsPerSecond.toLocaleString()} delta="last 10s" color="cyan" />
        <KpiCard label="Transactions today" value={kpis.transactionsToday.toLocaleString()} delta="all institutions" color="blue" />
        <KpiCard label="Fraud detected today" value={fraudStats.detectedToday.toLocaleString()} delta={`threshold ${fraudStats.riskThreshold}`} color="red" />
        <KpiCard
          label="Blockchain"
          value={health.blockchain.reachable ? "Online" : "Offline"}
          delta={health.blockchain.reachable ? health.blockchain.channel ?? "connected" : "network not deployed"}
          color={health.blockchain.reachable ? "green" : "red"}
        />
        <KpiCard
          label="Quantum engine"
          value={health.model.reachable ? (health.model.activeModelFamily ?? "—") : "Offline"}
          delta={health.model.reachable ? (health.model.modelVersion ?? "unknown version") : "engine unreachable"}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-3.5">
        <Panel
          title="Live transaction stream"
          subtitle="Real-time, all connected institutions"
          tag={{ label: "STREAMING", color: "cyan" }}
          bodyClassName="!pt-1"
        >
          {feed.length === 0 && <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>Waiting for transactions…</div>}
          {feed.map((event) => (
            <FeedRow key={event.id} event={event} />
          ))}
        </Panel>

        <Panel
          title="Connected institutions"
          subtitle="Health & sync status"
          tag={{ label: `${onlineCount} online`, color: "green" }}
        >
          {institutions.map((inst) => (
            <InstitutionRow
              key={inst.id}
              name={inst.name}
              subtitle={institutionSubtitle(inst)}
              status={inst.status}
              metric={`${inst.syncHealthPct.toFixed(1)}%`}
            />
          ))}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <Panel title="Transaction volume" subtitle="Today, by hour">
          <div style={{ height: 170 }}>
            <ResponsiveContainer>
              <AreaChart data={volumeSeries}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="t" stroke="#5C6675" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#5C6675" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "var(--card2)", border: "1px solid var(--line)", fontSize: 11 }}
                  labelStyle={{ color: "var(--txt2)" }}
                />
                <Area type="monotone" dataKey="count" stroke="#22D3EE" strokeWidth={1.5} fill="rgba(34,211,238,0.08)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Fraud risk gauge" subtitle="Composite score, current window">
          <Gauge value={fraudStats.compositeRiskScore} max={100} label={`Threshold ${fraudStats.riskThreshold}`} />
          <StatLine label="Fraud detected today" value={fraudStats.detectedToday.toLocaleString()} valueColor="red" />
          <StatLine label="Flagged amount (est.)" value={`$${fraudStats.estimatedSavingsUsd.toLocaleString()}`} valueColor="green" />
          <StatLine label="Avg. detection time" value={`${fraudStats.avgDetectionTimeMs} ms`} />
        </Panel>

        <Panel title="System health" subtitle="Quantum · blockchain · API">
          <StatLine
            label="Quantum engine"
            value={health.model.reachable ? `${health.model.activeModelFamily} · ${health.model.modelVersion}` : "unreachable"}
          />
          <StatLine
            label="Fallback rate (today)"
            value={`${health.model.fallbackRatePct}%`}
            trackPct={health.model.fallbackRatePct}
            trackColor="purple"
          />
          <StatLine
            label="Blockchain gateway"
            value={health.blockchain.reachable ? "connected" : "unreachable"}
            trackPct={health.blockchain.reachable ? 100 : 0}
            trackColor="cyan"
          />
          <StatLine label="API gateway uptime" value={`${health.apiGateway.uptimePct}%`} trackPct={health.apiGateway.uptimePct} trackColor="blue" />
          <StatLine
            label="Middleware memory (heap)"
            value={`${health.resources.heapUsedMb}MB / ${health.resources.heapTotalMb}MB`}
            trackPct={(health.resources.heapUsedMb / Math.max(health.resources.heapTotalMb, 1)) * 100}
            trackColor="green"
          />
        </Panel>
      </div>
    </>
  );
}
