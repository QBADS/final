import { Outlet, useLocation } from "react-router-dom";
import { Sidebar, TopBar } from "@qbads/ui";
import { nodeNavGroups } from "./lib/nav";
import { fetchInstitutionDetail, fetchNodeStatus } from "./lib/apiClient";
import { usePoll } from "./lib/useApi";
import { EMPTY_DETAIL, EMPTY_STATUS } from "./lib/emptyState";
import { apiUsage, connectionStatus, fraudSummary } from "./lib/derive";

function routeTitles(name: string): Record<string, { title: string; path: string }> {
  return {
    "/": { title: "Overview", path: `${name} / Node Dash / Overview` },
    "/transactions": { title: "Transaction history", path: `${name} / Node Dash / Transactions` },
    "/fraud": { title: "Fraud & risk", path: `${name} / Node Dash / Fraud & risk` },
    "/api": { title: "API & credentials", path: `${name} / Node Dash / API & credentials` },
    "/connection": { title: "Node connection", path: `${name} / Node Dash / Node connection` },
    "/feedback": { title: "Feedback", path: `${name} / Node Dash / Feedback` },
    "/settings": { title: "Settings", path: `${name} / Node Dash / Settings` },
  };
}

export default function App() {
  const location = useLocation();
  const detail = usePoll(fetchInstitutionDetail, 4000, EMPTY_DETAIL);
  const status = usePoll(fetchNodeStatus, 4000, EMPTY_STATUS);

  const name = detail.institution.name;
  const usage = apiUsage(status, detail.decisions);
  const connection = connectionStatus(status, detail.decisions);
  const route = routeTitles(name)[location.pathname] ?? { title: "Node Dash", path: name };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        brandName={name}
        brandSub="QBADS NODE PORTAL"
        groups={nodeNavGroups(fraudSummary(detail.decisions).reviewQueue)}
        footer={
          <>
            env: <span style={{ color: "var(--txt2)" }}>sandbox</span>
          </>
        }
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={route.title}
          path={route.path}
          liveLabel={connection.status === "healthy" ? `${connection.apiLatencyMs}ms latency` : connection.status}
          actions={
            <div className="text-[11px] mr-2" style={{ color: "var(--txt3)" }}>
              {usage.requestsToday.toLocaleString()} / {usage.requestsQuotaDaily.toLocaleString()} req today
            </div>
          }
        />
        <div className="flex-1 overflow-y-auto p-4.5 flex flex-col gap-4">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
