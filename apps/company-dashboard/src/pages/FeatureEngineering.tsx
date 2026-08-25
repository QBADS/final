import { Chip, Panel } from "@qbads/ui";
import { fetchFeaturePipeline } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

const typeColor: Record<string, "green" | "amber" | "red" | "blue"> = {
  continuous: "blue",
  categorical_low: "green",
  categorical_high: "amber",
  binary: "blue",
  hashed: "red",
  timestamp: "amber",
};

export function FeatureEngineering() {
  const info = usePoll(fetchFeaturePipeline, 6000, { fields: [], recentWarnings: [] });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-3.5">
      <Panel title="Stage 1 field classification" subtitle="Middleware's actual featureEngineering.ts config" bodyClassName="!pt-1">
        {info.fields.map((f) => (
          <div key={f.name} className="qb-stat-line">
            <span className="k">
              {f.name}
              {f.required && <span style={{ color: "var(--red)" }}> *</span>}
              {f.vocab && (
                <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                  {f.vocab.join(", ")}
                </span>
              )}
              {f.min !== undefined && f.max !== undefined && (
                <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                  range {f.min}-{f.max}, impute {f.imputeDefault}
                </span>
              )}
            </span>
            <Chip color={typeColor[f.type]}>{f.type}</Chip>
          </div>
        ))}
      </Panel>

      <Panel title="Recent pipeline warnings" subtitle="Real Stage 1 imputation/quarantine warnings from live submissions">
        {info.recentWarnings.length === 0 && (
          <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
            No warnings yet - submissions with all fields present don't generate any.
          </div>
        )}
        {info.recentWarnings.map((w) => (
          <div key={w.id} className="qb-stat-line" style={{ display: "block" }}>
            <div className="k">{w.txId}</div>
            {w.warnings.map((msg, i) => (
              <div key={i} className="text-[10.5px] mt-1" style={{ color: "var(--amber)" }}>
                ⚠ {msg}
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}
