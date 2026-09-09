import * as path from "node:path";

/**
 * Connects to the network as the dedicated Middleware application identity
 * (permission model, QBADS_Hyperledger_Fabric_Architecture.pdf Section 5:
 * "Middleware - Read events / submit transactions").
 *
 * The spec's org list (Section 2) is fixed at four ledger-owning orgs -
 * BankA, BankB, InstitutionC, RegulatorD - with no 5th "Middleware" org, and
 * Middleware isn't a ledger-owning participant (no peers, no MSP admin), so
 * a MiddlewareMSP would be architecturally wrong. Instead this is a
 * dedicated non-admin *client* identity provisioned under BankAMSP -
 * `User2@banka.qbads.com` (see network/crypto-config.yaml, BankA's
 * Users.Count: 2) - distinct from BankA's own identity (`User1`), which the
 * gateway previously signed as by default. Chaincode recognizes and
 * authorizes this specific identity for its two permitted actions
 * (submit transactions / record decisions) separately from BankA acting on
 * its own behalf - see `assertIsMiddleware` in
 * chaincode/fraud-ledger/src/fraudLedgerContract.ts. It is not an admin
 * identity: it cannot install/approve/commit chaincode, manage the channel,
 * or validate blocks.
 *
 * A real deployment should still migrate this off cryptogen's static
 * material and onto a Fabric CA-registered identity (with e.g. a
 * `role=middleware` attribute for ABAC) - see README "Not done here".
 */
const cryptoRoot = process.env.QBADS_CRYPTO_ROOT ?? path.resolve(__dirname, "../../network/crypto-config");

const org = process.env.QBADS_ORG ?? "banka.qbads.com";
const orgMspId = process.env.QBADS_MSP_ID ?? "BankAMSP";
const orgUser = process.env.QBADS_USER ?? "User2";
const peerEndpoint = process.env.QBADS_PEER_ENDPOINT ?? "localhost:7051";
const peerHostAlias = process.env.QBADS_PEER_HOST_ALIAS ?? "peer0.banka.qbads.com";

export const config = {
  port: Number(process.env.PORT ?? 4001),
  channelName: process.env.QBADS_CHANNEL ?? "qbadschannel",
  chaincodeName: process.env.QBADS_CHAINCODE ?? "fraudledger",
  peerEndpoint,
  peerHostAlias,
  mspId: orgMspId,
  certPath: path.join(cryptoRoot, "peerOrganizations", org, "users", `${orgUser}@${org}`, "msp", "signcerts", "cert.pem"),
  keyDir: path.join(cryptoRoot, "peerOrganizations", org, "users", `${orgUser}@${org}`, "msp", "keystore"),
  tlsCertPath: path.join(cryptoRoot, "peerOrganizations", org, "peers", `peer0.${org}`, "tls", "ca.crt"),
};
