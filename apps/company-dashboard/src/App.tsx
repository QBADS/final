import { Outlet, useLocation } from "react-router-dom";
import { Sidebar, TickerBar, TopBar } from "@qbads/ui";
import { companyNavGroups } from "./lib/nav";
import { fetchFraudStats, fetchKpis, fetchTicker, fetchTransactions } from "./lib/apiClient";
import { usePoll } from "./lib/useApi";
import { EMPTY_FRAUD_STATS, EMPTY_KPIS } from "./lib/emptyState";

const routeTitles: Record<string, { title: string; path: string }> = {
  "/": { title: "Executive overview", path: "QBADS / Dashboard / Executive overview" },
  "/live-monitoring": { title: "Live monitoring", path: "QBADS / Dashboard / Live monitoring" },
  "/kpi-analytics": { title: "KPIs & analytics", path: "QBADS / Dashboard / KPIs & analytics" },
  "/institutions/banks": { title: "Connected banks", path: "QBADS / Institutions / Connected banks" },
  "/institutions/fintechs": { title: "Fintechs & wallets", path: "QBADS / Institutions / Fintechs & wallets" },
  "/institutions/processors": { title: "Payment processors", path: "QBADS / Institutions / Payment processors" },
  "/institutions/exchanges": { title: "Crypto exchanges", path: "QBADS / Institutions / Crypto exchanges" },
  "/operations/transactions": { title: "Transaction centre", path: "QBADS / Operations / Transaction centre" },
  "/operations/fraud": { title: "Fraud detection", path: "QBADS / Operations / Fraud detection" },
  "/operations/cases": { title: "Case management", path: "QBADS / Operations / Case management" },
  "/intelligence/ai-ml": { title: "AI & machine learning", path: "QBADS / Intelligence / AI & machine learning" },
  "/intelligence/quantum": { title: "Quantum computing", path: "QBADS / Intelligence / Quantum computing" },
  "/intelligence/blockchain": { title: "Blockchain", path: "QBADS / Intelligence / Blockchain" },
  "/intelligence/feature-engineering": { title: "Feature engineering", path: "QBADS / Intelligence / Feature engineering" },
  "/platform/api-gateway": { title: "API gateway", path: "QBADS / Platform / API gateway" },
  "/platform/security": { title: "Security operations", path: "QBADS / Platform / Security operations" },
  "/platform/reports": { title: "Reports", path: "QBADS / Platform / Reports" },
  "/platform/admin": { title: "Administration", path: "QBADS / Platform / Administration" },
};

export default function App() {
  const location = useLocation();
  const fraudStats = usePoll(fetchFraudStats, 4000, EMPTY_FRAUD_STATS);
  const kpis = usePoll(fetchKpis, 4000, EMPTY_KPIS);
  const ticker = usePoll(fetchTicker, 5000, [] as Awaited<ReturnType<typeof fetchTicker>>);
  const reviewCases = usePoll(() => fetchTransactions({ decision: "REVIEW" }), 6000, []);
  const route = routeTitles[location.pathname] ?? { title: "QBADS", path: "QBADS / Dashboard" };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        brandName="QBADS"
        brandSub="QUANTUM · BLOCKCHAIN · AI"
        groups={companyNavGroups(fraudStats.detectedToday, reviewCases.length)}
        footer={
          <>
            v4.2.1 · role: <span style={{ color: "var(--txt2)" }}>exec-admin</span>
          </>
        }
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TickerBar items={ticker} />
        <TopBar
          title={route.title}
          path={route.path}
          liveLabel={`${kpis.liveTransactionsPerSecond.toLocaleString()} tx/s`}
        />
        <div className="flex-1 overflow-y-auto p-4.5 flex flex-col gap-4">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
