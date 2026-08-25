export type QbColor = "cyan" | "blue" | "green" | "purple" | "amber" | "red";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  color: QbColor;
}

export function KpiCard({ label, value, delta, color }: KpiCardProps) {
  return (
    <div className="qb-kpi flex flex-col gap-1.5">
      <div className="bar" style={{ background: `var(--${color})` }} />
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {delta && (
        <div className="delta" style={{ color: `var(--${color})` }}>
          {delta}
        </div>
      )}
    </div>
  );
}
