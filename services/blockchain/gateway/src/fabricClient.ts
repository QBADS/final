import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as grpc from "@grpc/grpc-js";
import { connect, Gateway, Identity, Signer, signers } from "@hyperledger/fabric-gateway";
import { config } from "./config";

function loadPrivateKeyPem(): string {
  const [keyFile] = fs.readdirSync(config.keyDir);
  return fs.readFileSync(path.join(config.keyDir, keyFile), "utf8");
}

function newGrpcConnection(): grpc.Client {
  const tlsRootCert = fs.readFileSync(config.tlsCertPath);
  const credentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(config.peerEndpoint, credentials, {
    "grpc.ssl_target_name_override": config.peerHostAlias,
  });
}

function newIdentity(): Identity {
  const credentials = fs.readFileSync(config.certPath);
  return { mspId: config.mspId, credentials };
}

function newSigner(): Signer {
  const privateKeyPem = loadPrivateKeyPem();
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

let gatewaySingleton: Gateway | undefined;
let grpcClientSingleton: grpc.Client | undefined;

export function getGateway(): Gateway {
  if (!gatewaySingleton) {
    grpcClientSingleton = newGrpcConnection();
    gatewaySingleton = connect({
      client: grpcClientSingleton,
      identity: newIdentity(),
      signer: newSigner(),
      evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),
      submitOptions: () => ({ deadline: Date.now() + 5000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
  }
  return gatewaySingleton;
}

export function getContract() {
  const network = getGateway().getNetwork(config.channelName);
  return network.getContract(config.chaincodeName);
}

export function getNetwork() {
  return getGateway().getNetwork(config.channelName);
}

export function closeGateway(): void {
  gatewaySingleton?.close();
  grpcClientSingleton?.close();
  gatewaySingleton = undefined;
  grpcClientSingleton = undefined;
}
