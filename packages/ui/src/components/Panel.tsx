import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  subtitle?: string;
  tag?: { label: string; color: "cyan" | "green" | "amber" | "red" | "blue" };
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, subtitle, tag, children, className, bodyClassName }: PanelProps) {
  return (
    <div className={`qb-panel flex flex-col ${className ?? ""}`}>
      <div className="qb-panel-head flex items-center justify-between">
        <div>
          <div className="qb-panel-title">{title}</div>
          {subtitle && <div className="qb-panel-sub">{subtitle}</div>}
        </div>
        {tag && (
          <div
            className="qb-panel-tag"
            style={{ background: `var(--${tag.color}-dim)`, color: `var(--${tag.color})` }}
          >
            {tag.label}
          </div>
        )}
      </div>
      <div className={`qb-panel-body flex-1 ${bodyClassName ?? ""}`}>{children}</div>
    </div>
  );
}
