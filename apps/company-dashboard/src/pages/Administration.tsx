import { InstitutionRow, Panel, StatLine } from "@qbads/ui";
import { fetchConfig, fetchInstitutions, institutionSubtitle } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

const EMPTY_CONFIG: Awaited<ReturnType<typeof fetchConfig>> = {
  quantumClientMode: "—",
  quantumTimeoutMs: 0,
  quantumMaxRetries: 0,
  qubitBudget: 0,
  reviewThreshold: 0,
  fraudThreshold: 0,
  blockchainWriteEnabled: false,
  institutionCount: 0,
};

export function Administration() {
  const config = usePoll(fetchConfig, 8000, EMPTY_CONFIG);
  const institutions = usePoll(fetchInstitutions, 8000, []);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-3.5">
      <Panel title="Runtime configuration" subtitle="services/middleware/src/config.ts, non-secret values">
        <StatLine label="Quantum client mode" value={config.quantumClientMode} />
        <StatLine label="Quantum timeout" value={`${config.quantumTimeoutMs}ms, ${config.quantumMaxRetries} retries`} />
        <StatLine label="Qubit budget" value={String(config.qubitBudget)} />
        <StatLine label="Review threshold" value={String(config.reviewThreshold)} />
        <StatLine label="Fraud threshold" value={String(config.fraudThreshold)} />
        <StatLine label="Blockchain write-back" value={config.blockchainWriteEnabled ? "enabled" : "disabled"} />
        <StatLine label="Registered institutions" value={String(config.institutionCount)} />
      </Panel>

      <Panel title="Managed institutions" subtitle="All seeded sandbox nodes">
        {institutions.map((i) => (
          <InstitutionRow key={i.id} name={i.name} subtitle={institutionSubtitle(i)} status={i.status} metric={`${i.syncHealthPct.toFixed(1)}%`} />
        ))}
      </Panel>
    </div>
  );
}
