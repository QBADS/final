import type { NavGroupConfig } from "@qbads/ui";

export function companyNavGroups(fraudCaseCount: number, openCaseCount: number): NavGroupConfig[] {
  return [
    {
      items: [
        { label: "Executive overview", to: "/" },
        { label: "Live monitoring", to: "/live-monitoring" },
        { label: "KPIs & analytics", to: "/kpi-analytics" },
      ],
    },
    {
      label: "Institutions",
      items: [
        { label: "Connected banks", to: "/institutions/banks" },
        { label: "Fintechs & wallets", to: "/institutions/fintechs" },
        { label: "Payment processors", to: "/institutions/processors" },
        { label: "Crypto exchanges", to: "/institutions/exchanges" },
      ],
    },
    {
      label: "Operations",
      items: [
        { label: "Transaction centre", to: "/operations/transactions" },
        { label: "Fraud detection", to: "/operations/fraud", badge: { label: String(fraudCaseCount), color: "red" } },
        { label: "Case management", to: "/operations/cases", badge: { label: String(openCaseCount), color: "amber" } },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { label: "AI & machine learning", to: "/intelligence/ai-ml" },
        { label: "Quantum computing", to: "/intelligence/quantum" },
        { label: "Blockchain", to: "/intelligence/blockchain" },
        { label: "Feature engineering", to: "/intelligence/feature-engineering" },
      ],
    },
    {
      label: "Platform",
      items: [
        { label: "API gateway", to: "/platform/api-gateway" },
        { label: "Security operations", to: "/platform/security" },
        { label: "Reports", to: "/platform/reports" },
        { label: "Administration", to: "/platform/admin" },
      ],
    },
  ];
}
