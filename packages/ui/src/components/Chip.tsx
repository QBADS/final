export type ChipColor = "green" | "amber" | "red" | "blue";

export function Chip({ color, children }: { color: ChipColor; children: React.ReactNode }) {
  return <span className={`qb-chip ${color}`}>{children}</span>;
}

export function riskChip(riskLevel: "low" | "medium" | "high"): { color: ChipColor; label: string } {
  if (riskLevel === "high") return { color: "red", label: "High" };
  if (riskLevel === "medium") return { color: "amber", label: "Medium" };
  return { color: "green", label: "Low" };
}

export function healthChip(status: "healthy" | "degraded" | "offline"): { color: ChipColor; label: string } {
  if (status === "offline") return { color: "red", label: "Offline" };
  if (status === "degraded") return { color: "amber", label: "Degraded" };
  return { color: "green", label: "Healthy" };
}
