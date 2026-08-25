import type { QbColor } from "./KpiCard";

interface StatLineProps {
  label: string;
  value: string;
  trackPct?: number;
  trackColor?: QbColor;
  valueColor?: QbColor;
}

export function StatLine({ label, value, trackPct, trackColor = "blue", valueColor }: StatLineProps) {
  return (
    <div className="qb-stat-line">
      <span className="k">{label}</span>
      <span className="v" style={valueColor ? { color: `var(--${valueColor})` } : undefined}>
        {value}
      </span>
      {trackPct !== undefined && (
        <div className="qb-track">
          <div style={{ width: `${trackPct}%`, background: `var(--${trackColor})` }} />
        </div>
      )}
    </div>
  );
}
