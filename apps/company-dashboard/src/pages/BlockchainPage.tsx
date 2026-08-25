import { Panel, StatLine } from "@qbads/ui";
import { fetchBlockchainInfo } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";

const EMPTY: Awaited<ReturnType<typeof fetchBlockchainInfo>> = {
  reachable: false,
  channel: null,
  chaincode: null,
  gatewayUrl: "",
  writeEnabled: false,
};

export function BlockchainPage() {
  const info = usePoll(fetchBlockchainInfo, 5000, EMPTY);

  return (
    <Panel
      title="Blockchain"
      subtitle="services/blockchain/gateway - Hyperledger Fabric network"
      tag={{ label: info.reachable ? "ONLINE" : "OFFLINE", color: info.reachable ? "green" : "red" }}
    >
      <StatLine label="Gateway reachable" value={info.reachable ? "yes" : "no"} />
      <StatLine label="Channel" value={info.channel ?? "—"} />
      <StatLine label="Chaincode" value={info.chaincode ?? "—"} />
      <StatLine label="Write-back enabled" value={info.writeEnabled ? "yes" : "no"} />
      {!info.reachable && (
        <div className="text-[11.5px] pt-3" style={{ color: "var(--txt3)" }}>
          The Fabric network isn't deployed in this environment (needs Docker) - see
          services/blockchain/README.md. Middleware's transaction/decision write-backs are
          best-effort and simply log a warning when this is unreachable, which is why the rest
          of the platform keeps working regardless.
        </div>
      )}
    </Panel>
  );
}
