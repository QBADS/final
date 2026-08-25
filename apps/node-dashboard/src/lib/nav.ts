import type { NavGroupConfig } from "@qbads/ui";

export function nodeNavGroups(reviewQueueCount: number): NavGroupConfig[] {
  return [
    {
      items: [{ label: "Overview", to: "/" }],
    },
    {
      label: "Transactions",
      items: [
        { label: "Transaction history", to: "/transactions" },
        { label: "Fraud & risk", to: "/fraud", badge: { label: String(reviewQueueCount), color: "amber" } },
      ],
    },
    {
      label: "Integration",
      items: [
        { label: "API & credentials", to: "/api" },
        { label: "Node connection", to: "/connection" },
      ],
    },
    {
      label: "Model feedback",
      items: [{ label: "Feedback", to: "/feedback" }],
    },
    {
      label: "Account",
      items: [{ label: "Settings", to: "/settings" }],
    },
  ];
}
