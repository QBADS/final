import { Chip, Panel } from "@qbads/ui";
import { fetchSecurity } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

export function SecurityOperations() {
  const info = usePoll(fetchSecurity, 5000, { authEvents: [], institutions: [] });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-3.5">
      <Panel title="Institution credentials" subtitle="Sandbox API keys, masked">
        {info.institutions.map((i) => (
          <div key={i.id} className="qb-stat-line">
            <span className="k">
              {i.name}
              <span className="block text-[10px] mt-0.5 font-mono" style={{ color: "var(--txt3)" }}>
                {i.apiKeyMasked}
              </span>
            </span>
            <Chip color={i.status === "healthy" ? "green" : i.status === "degraded" ? "amber" : "red"}>{i.status}</Chip>
          </div>
        ))}
      </Panel>

      <Panel title="Authentication failures" subtitle="Real rejected Node API requests (auth.ts) - not simulated" tag={{ label: String(info.authEvents.length), color: info.authEvents.length ? "red" : "green" }}>
        {info.authEvents.length === 0 && (
          <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
            No authentication failures recorded this session.
          </div>
        )}
        {info.authEvents.map((e) => (
          <div key={e.id} className="qb-stat-line">
            <span className="k">
              {e.path}
              <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                {new Date(e.occurredAt).toLocaleTimeString()} {e.keyPrefix ? `· key "${e.keyPrefix}…"` : "· no key presented"}
              </span>
            </span>
            <Chip color="red">{e.type === "missing_key" ? "missing key" : "invalid key"}</Chip>
          </div>
        ))}
      </Panel>
    </div>
  );
}
