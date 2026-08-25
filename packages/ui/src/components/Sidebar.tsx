import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export interface NavItemConfig {
  label: string;
  to: string;
  badge?: { label: string; color: "red" | "amber" };
}

export interface NavGroupConfig {
  label?: string;
  items: NavItemConfig[];
}

interface SidebarProps {
  brandName: string;
  brandSub: string;
  groups: NavGroupConfig[];
  footer: ReactNode;
}

export function Sidebar({ brandName, brandSub, groups, footer }: SidebarProps) {
  return (
    <div className="qb-sidebar flex flex-col flex-shrink-0 h-full">
      <div className="flex items-center gap-2 px-4 py-4 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="qb-brand-mark">Q</div>
        <div>
          <div className="text-sm font-semibold tracking-wide">{brandName}</div>
          <div className="text-[10px] tracking-wider" style={{ color: "var(--txt3)" }}>
            {brandSub}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2.5">
        {groups.map((group, i) => (
          <div key={i} className="mb-1">
            {group.label && (
              <div
                className="text-[10px] uppercase tracking-wider px-2.5 pt-3 pb-1.5"
                style={{ color: "var(--txt3)" }}
              >
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `qb-nav-item ${isActive ? "active" : ""}`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="dot" />
                  {item.label}
                </div>
                {item.badge && <span className={`qb-nav-badge ${item.badge.color}`}>{item.badge.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div
        className="px-4 py-3 border-t text-[10.5px]"
        style={{ borderColor: "var(--line)", color: "var(--txt3)" }}
      >
        {footer}
      </div>
    </div>
  );
}
