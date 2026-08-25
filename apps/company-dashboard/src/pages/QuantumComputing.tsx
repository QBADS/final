import { Panel, StatLine } from "@qbads/ui";
import { fetchQuantumInfo } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

const EMPTY: Awaited<ReturnType<typeof fetchQuantumInfo>> = { reachable: false, champion: null, featureDimension: 8, models: [] };

export function QuantumComputing() {
  const info = usePoll(fetchQuantumInfo, 5000, EMPTY);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel title="Quantum Engine" subtitle="services/quantum-pipeline - real Qiskit circuits" tag={{ label: info.reachable ? "ONLINE" : "OFFLINE", color: info.reachable ? "green" : "red" }}>
        <StatLine label="Reachable" value={info.reachable ? "yes" : "no"} />
        <StatLine label="Champion model" value={info.champion ?? "—"} />
        <StatLine label="Feature dimension (qubits)" value={String(info.featureDimension)} />
      </Panel>

      <Panel title="Model roster" subtitle="QSVM (quantum kernel) · QNN (EstimatorQNN) · VQC (variational circuit)" bodyClassName="!pt-1">
        {info.models.length === 0 && (
          <div className="text-[11.5px] py-3" style={{ color: "var(--txt3)" }}>
            {info.reachable ? "No models reported." : "Engine unreachable - start services/quantum-pipeline to see live model info."}
          </div>
        )}
        {info.models.map((m) => (
          <div key={m.modelType} className="qb-stat-line">
            <span className="k">
              {m.modelType === info.champion && <span style={{ color: "var(--green)" }}>★ </span>}
              {m.modelType}
              <span className="block text-[10px] mt-0.5" style={{ color: "var(--txt3)" }}>
                {m.trainedOn} · {m.featureDimension}-qubit
              </span>
            </span>
            <span className="v">{m.modelVersion}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
