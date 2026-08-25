import type { HealthStatus } from "@qbads/types";

const statusColor: Record<HealthStatus, string> = {
  healthy: "var(--green)",
  degraded: "var(--amber)",
  offline: "var(--red)",
};

interface InstitutionRowProps {
  name: string;
  subtitle: string;
  status: HealthStatus;
  metric: string;
}

export function InstitutionRow({ name, subtitle, status, metric }: InstitutionRowProps) {
  return (
    <div className="qb-inst-row">
      <span className="qb-inst-dot" style={{ background: statusColor[status] }} />
      <span className="qb-inst-name">
        {name}
        <span className="t">{subtitle}</span>
      </span>
      <span className="qb-inst-metric">{metric}</span>
    </div>
  );
}
