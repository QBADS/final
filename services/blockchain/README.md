# Blockchain — Hyperledger Fabric network

Status: **code complete, not yet deployed.** All of the network config,
chaincode, and gateway service below is written and compiles clean. Actually
standing it up requires Docker Desktop running locally and pulling the Fabric
images — that step was intentionally deferred (bandwidth/resource cost) and
is a single command away whenever you want it: `./network/scripts/network-up.sh`.

Reference: `QBADS_Hyperledger_Fabric_Architecture.pdf`.

## What's here

```
network/
  crypto-config.yaml       cryptogen config: OrdererOrg + 4 peer orgs
  configtx.yaml               channel profile: RAFT (3 orderers), 4 app orgs
  docker-compose.yaml     3 orderers, 4 peers (1/org), 4 CouchDB, 1 CLI
  scripts/
    generate.sh                cryptogen + configtxgen, via fabric-tools image (no local Go/binaries needed)
    network-up.sh / network-down.sh
    create-channel.sh          creates "qbadschannel", joins all 4 orgs, updates anchor peers
    deploy-chaincode.sh    builds, packages, installs, approves, commits fraud-ledger

chaincode/fraud-ledger/     TypeScript smart contract (fabric-contract-api)
gateway/                          Node.js/Express service - the two documented gateway points
```

## Organizations

Matches Section 2 of the doc exactly: **Bank A**, **Bank B**, **Institution C**
(financial institution), **Regulator D** — each with one peer (`peer0`), its
own CouchDB world-state database, and its own MSP/crypto identity. Ordering
is a 3-node RAFT cluster under a separate `OrdererOrg`, per Section 1's
5-layer stack.

## Smart contract (`chaincode/fraud-ledger`)

Implements the "Smart contract layer" row of Table 1 directly:

- `CreateTransactionRecord` — records an inbound transaction (Middleware
  Blockchain API "in"). Rejects a `txId` that's already been recorded
  (duplicate detection) and validates required fields before writing state.
- `RecordFraudDecision` — writes the auditable decision back on-chain
  (Middleware Blockchain API "out": decision hash, risk class, model
  version). Refuses to decide on a transaction that doesn't exist, and
  refuses to double-record a decision.
- `GetTransaction` / `GetDecision` — point queries against world state.
- `GetTransactionAuditTrail` — full immutable history for one transaction
  key, via `getHistoryForKey` (Table 1: "audit trail").
- `QueryTransactionsByInstitution` — CouchDB rich query (Table 1: "world
  state DB, queryable key-value data").

All chaincode timestamps use `ctx.stub.getTxTimestamp()`, not wall-clock
time — chaincode execution must be deterministic across every endorsing
peer, and `Date.now()` differs peer to peer.

**Endorsement policy:** commit script uses `OR` across the four orgs' peers
(any one org can endorse), chosen so a demo network with one peer per org
doesn't stall if an org is offline. Tighten to `MAJORITY` (or add more peers
per org) before this is anything but a dev/reference network.

## Gateway (`gateway/`)

The doc is explicit that Middleware talks to Fabric through exactly two
gateway points (Section 1) with a labelled interface list (Table 3). This
service *is* that boundary — everything on the other side of it (peers,
ordering, chaincode, ledger) is internal Fabric machinery Middleware never
touches directly.

| Table 3 interface | Endpoint |
|---|---|
| REST API (input) | `POST /api/transactions`, `POST /api/transactions/:txId/decision` |
| Transaction status / receipts | Response body: `{ fabricTransactionId, status }` |
| Ledger query results | `GET /api/transactions/:txId`, `GET /api/transactions/:txId/decision`, `GET /api/institutions/:institutionId/transactions` |
| Blockchain events / block notifications | `GET /api/events` (SSE stream of chaincode events) |
| Audit logs | `GET /api/transactions/:txId/audit-trail` |

It connects to the network using `@hyperledger/fabric-gateway` (gRPC), signed
with one org's client identity — **BankA's `User1` cert by default**, which
is a placeholder. The permission model (Table, Section 5) has a distinct
`Middleware` role ("read events / submit transactions") that should get its
own Fabric CA-issued identity in a real deployment rather than reusing an
org's identity — that's a follow-up, not done here.

## Bringing it up

```bash
cd services/blockchain/network
./scripts/network-up.sh          # starts Docker containers (generates crypto material first run)
./scripts/create-channel.sh      # creates qbadschannel, joins all 4 orgs
./scripts/deploy-chaincode.sh    # builds + installs + commits fraud-ledger

cd ../gateway
npm install
npm run build && npm start       # gateway on :4001
```

Then, e.g.:

```bash
curl -X POST localhost:4001/api/transactions \
  -H 'content-type: application/json' \
  -d '{"txId":"TX-1","institutionId":"inst-2","amount":250,"currency":"USD"}'

curl localhost:4001/api/transactions/TX-1
```

`./scripts/network-down.sh` tears everything down (containers + volumes).

## Not done here

- Fabric CA servers issuing live identities (currently `cryptogen` static
  crypto material — fine for dev, not for onboarding real institutions).
- A dedicated Middleware application identity (see Gateway section above).
- Multiple peers per org / stricter endorsement policy for real fault
  tolerance.
- Actually running any of this — deferred at your request; see Status above.
