import type { TickerItem } from "@qbads/types";

export function TickerBar({ items }: { items: TickerItem[] }) {
  const looped = [...items, ...items];
  return (
    <div className="qb-ticker-wrap flex items-center flex-shrink-0">
      <div className="qb-ticker-tag flex items-center">LIVE FEED</div>
      <div className="qb-ticker-track">
        {looped.map((item, i) => (
          <span key={`${item.id}-${i}`} className="qb-tick">
            <span className={item.severity}>{item.severity === "bad" ? "⚠" : item.severity === "warn" ? "•" : "✓"}</span>
            {item.message}
          </span>
        ))}
      </div>
    </div>
  );
}
