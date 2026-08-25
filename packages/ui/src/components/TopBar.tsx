import type { ReactNode } from "react";

interface TopBarProps {
  title: string;
  path: string;
  liveLabel?: string;
  actions?: ReactNode;
}

export function TopBar({ title, path, liveLabel, actions }: TopBarProps) {
  return (
    <div className="qb-topbar flex items-center justify-between px-4.5 flex-shrink-0">
      <div>
        <h1 className="text-[15px] font-semibold">{title}</h1>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--txt3)" }}>
          {path}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {liveLabel && (
          <div className="qb-pulse-live">
            <span className="qb-pulse-dot" />
            {liveLabel}
          </div>
        )}
      </div>
    </div>
  );
}
