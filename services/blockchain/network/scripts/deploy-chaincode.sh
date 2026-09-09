#!/usr/bin/env bash
# Packages, installs, approves and commits the fraud-ledger chaincode
# (services/blockchain/chaincode/fraud-ledger) across all four organizations.
#
# Endorsement policy: majority of the four orgs (OutOf(3, ...) - 3-of-4 is
# the smallest integer majority of 4) must endorse a write, not just any
# single org. Each org now runs two peers (peer0 + peer1, see
# crypto-config.yaml / docker-compose.yaml) precisely so this majority
# policy is meaningful fault tolerance rather than a majority-of-one: an
# org whose peer0 is down can still endorse via peer1, and the chaincode is
# installed on both peers of every org below.
set -euo pipefail
cd "$(dirname "$0")/.."

CC_NAME=fraudledger
CC_VERSION=1
CC_SEQUENCE=1
POLICY="OutOf(3, 'BankAMSP.peer','BankBMSP.peer','InstitutionCMSP.peer','RegulatorDMSP.peer')"

CC_BASE=/opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config
ORDERER_CA="$CC_BASE/ordererOrganizations/qbads.com/tlsca/tlsca.qbads.com-cert.pem"

orgs=(BankA BankB InstitutionC RegulatorD)
domains=(banka.qbads.com bankb.qbads.com institutionc.qbads.com regulatord.qbads.com)
msps=(BankAMSP BankBMSP InstitutionCMSP RegulatorDMSP)
peers=(peer0 peer1)

# peer_env i [peer]  - defaults to peer0 for org i; pass "peer1" as $2 to
# target that org's second peer instead (used for the install loop so the
# chaincode package lands on both peers of every org).
peer_env() {
  local i=$1
  local peer=${2:-peer0}
  echo "-e CORE_PEER_LOCALMSPID=${msps[$i]}" \
       "-e CORE_PEER_ADDRESS=${peer}.${domains[$i]}:7051" \
       "-e CORE_PEER_MSPCONFIGPATH=$CC_BASE/peerOrganizations/${domains[$i]}/users/Admin@${domains[$i]}/msp" \
       "-e CORE_PEER_TLS_ROOTCERT_FILE=$CC_BASE/peerOrganizations/${domains[$i]}/peers/${peer}.${domains[$i]}/tls/ca.crt"
}

echo "==> Building chaincode (TypeScript -> JS)"
(cd ../chaincode/fraud-ledger && npm install && npm run build)

echo "==> Packaging chaincode"
docker compose exec -e CORE_PEER_LOCALMSPID=BankAMSP cli peer lifecycle chaincode package \
  ${CC_NAME}.tar.gz --path chaincode/fraud-ledger --lang node --label ${CC_NAME}_${CC_VERSION}

for i in "${!orgs[@]}"; do
  for peer in "${peers[@]}"; do
    echo "==> ${orgs[$i]}/${peer}: installing chaincode"
    # shellcheck disable=SC2046
    docker compose exec $(peer_env "$i" "$peer") cli peer lifecycle chaincode install ${CC_NAME}.tar.gz
  done
done

echo "==> Querying package ID"
PACKAGE_ID=$(docker compose exec -e CORE_PEER_LOCALMSPID=BankAMSP cli peer lifecycle chaincode queryinstalled 2>&1 \
  | grep -o "${CC_NAME}_${CC_VERSION}:[a-f0-9]*" | head -1)
echo "    package id: $PACKAGE_ID"

for i in "${!orgs[@]}"; do
  echo "==> ${orgs[$i]}: approving chaincode definition"
  # shellcheck disable=SC2046
  docker compose exec $(peer_env "$i") cli peer lifecycle chaincode approveformyorg \
    -o orderer1.qbads.com:7050 --channelID qbadschannel --name ${CC_NAME} \
    --version ${CC_VERSION} --package-id "$PACKAGE_ID" --sequence ${CC_SEQUENCE} \
    --signature-policy "$POLICY" --tls --cafile "$ORDERER_CA"
done

echo "==> Committing chaincode definition"
PEER_ADDR_ARGS=""
for i in "${!orgs[@]}"; do
  PEER_ADDR_ARGS+=" --peerAddresses peer0.${domains[$i]}:7051 --tlsRootCertFiles $CC_BASE/peerOrganizations/${domains[$i]}/peers/peer0.${domains[$i]}/tls/ca.crt"
done

# shellcheck disable=SC2086
docker compose exec cli peer lifecycle chaincode commit \
  -o orderer1.qbads.com:7050 --channelID qbadschannel --name ${CC_NAME} \
  --version ${CC_VERSION} --sequence ${CC_SEQUENCE} --signature-policy "$POLICY" \
  --tls --cafile "$ORDERER_CA" $PEER_ADDR_ARGS

echo "fraud-ledger chaincode committed on qbadschannel."
