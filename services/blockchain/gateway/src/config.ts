import * as path from "node:path";

/**
 * Connects to the network as one organization's client identity. Real
 * deployments should provision a dedicated "Middleware" application
 * identity via Fabric CA (see permission model, Table in
 * QBADS_Hyperledger_Fabric_Architecture.pdf Section 5: "Middleware - Read
 * events / submit transactions") rather than reusing an org admin cert as
 * this dev config does.
 */
const cryptoRoot = process.env.QBADS_CRYPTO_ROOT ?? path.resolve(__dirname, "../../network/crypto-config");

const org = process.env.QBADS_ORG ?? "banka.qbads.com";
const orgMspId = process.env.QBADS_MSP_ID ?? "BankAMSP";
const orgUser = process.env.QBADS_USER ?? "User1";
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
