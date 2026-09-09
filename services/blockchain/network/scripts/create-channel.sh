#!/usr/bin/env bash
# Creates the "qbadschannel" application channel and joins all four
# organizations' peers to it (Bank A, Bank B, Institution C, Regulator D -
# see QBADS_Hyperledger_Fabric_Architecture.pdf, Section 2).
set -euo pipefail
cd "$(dirname "$0")/.."

CC_BASE=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config
ORDERER_CA="$CC_BASE/ordererOrganizations/qbads.com/tlsca/tlsca.qbads.com-cert.pem"

orgs=(BankA BankB InstitutionC RegulatorD)
domains=(banka.qbads.com bankb.qbads.com institutionc.qbads.com regulatord.qbads.com)
msps=(BankAMSP BankBMSP InstitutionCMSP RegulatorDMSP)
peers=(peer0 peer1)

# peer_env i [peer] - defaults to peer0 for org i; pass "peer1" as $2 to
# target that org's second peer (see crypto-config.yaml / docker-compose.yaml
# - each org now runs two peers so the majority endorsement policy in
# deploy-chaincode.sh has real per-org fault tolerance).
peer_env() {
  local i=$1
  local peer=${2:-peer0}
  echo "-e CORE_PEER_LOCALMSPID=${msps[$i]}" \
       "-e CORE_PEER_ADDRESS=${peer}.${domains[$i]}:7051" \
       "-e CORE_PEER_MSPCONFIGPATH=$CC_BASE/peerOrganizations/${domains[$i]}/users/Admin@${domains[$i]}/msp" \
       "-e CORE_PEER_TLS_ROOTCERT_FILE=$CC_BASE/peerOrganizations/${domains[$i]}/peers/${peer}.${domains[$i]}/tls/ca.crt"
}

echo "==> Creating channel qbadschannel"
docker compose exec cli peer channel create \
  -o orderer1.qbads.com:7050 -c qbadschannel \
  -f channel-artifacts/qbadschannel.tx \
  --outputBlock channel-artifacts/qbadschannel.block \
  --tls --cafile "$ORDERER_CA"

for i in "${!orgs[@]}"; do
  for peer in "${peers[@]}"; do
    echo "==> ${orgs[$i]}/${peer}: joining channel"
    # shellcheck disable=SC2046
    docker compose exec $(peer_env "$i" "$peer") cli peer channel join -b channel-artifacts/qbadschannel.block
  done
done

for i in "${!orgs[@]}"; do
  echo "==> ${orgs[$i]}: updating anchor peer"
  # shellcheck disable=SC2046
  docker compose exec $(peer_env "$i") cli peer channel update \
    -o orderer1.qbads.com:7050 -c qbadschannel \
    -f "channel-artifacts/${orgs[$i]}MSPanchors.tx" \
    --tls --cafile "$ORDERER_CA"
done

echo "All organizations joined qbadschannel."
