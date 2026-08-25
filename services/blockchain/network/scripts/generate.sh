#!/usr/bin/env bash
# Generates crypto material (cryptogen) and channel artifacts (configtxgen)
# for the QBADS Fabric network, using the fabric-tools image so nobody needs
# Go or the Fabric binaries installed locally - only Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf crypto-config channel-artifacts
mkdir -p channel-artifacts

docker run --rm \
  -v "$(pwd)":/data \
  -w /data \
  -e FABRIC_CFG_PATH=/data \
  hyperledger/fabric-tools:2.5 \
  bash -c '
    set -e
    cryptogen generate --config=crypto-config.yaml --output=crypto-config

    configtxgen -profile QBADSOrdererGenesis -channelID qbads-system-channel \
      -outputBlock channel-artifacts/genesis.block

    configtxgen -profile QBADSChannel -outputCreateChannelTx \
      channel-artifacts/qbadschannel.tx -channelID qbadschannel

    for org in BankA BankB InstitutionC RegulatorD; do
      configtxgen -profile QBADSChannel -outputAnchorPeersUpdate \
        channel-artifacts/${org}MSPanchors.tx -channelID qbadschannel -asOrg ${org}MSP
    done
  '

echo "Crypto material + channel artifacts generated."
