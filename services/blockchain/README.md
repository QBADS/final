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
  docker-compose.yaml     3 orderers, 8 peers (2/org), 8 CouchDB, 1 CLI
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
(financial institution), **Regulator D** — each with two peers (`peer0` +
`peer1`), each peer with its own CouchDB world-state database, and each org
with its own MSP/crypto identity. Ordering is a 3-node RAFT cluster under a
separate `OrdererOrg`, per Section 1's 5-layer stack. Two peers per org
exist specifically so the endorsement policy below (majority-of-orgs) is
backed by real fault tolerance rather than one peer per org being a single
point of failure.

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

**Endorsement policy:** commit script now uses
`OutOf(3, 'BankAMSP.peer','BankBMSP.peer','InstitutionCMSP.peer','RegulatorDMSP.peer')`
— a majority (3 of 4) of orgs must endorse a write, not just any single one.
Each org runs two peers (`peer0` + `peer1`) so an org can still endorse if
one of its peers is down, making the majority requirement meaningful rather
than a majority-of-one. This was the dev-only OR-across-any-single-org
tradeoff flagged in an earlier version of this doc; it's now production-
appropriate at the config level (see "Not done here" below for what's still
outstanding).

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
with a **dedicated Middleware client identity** —
`User2@banka.qbads.com`, a non-admin client identity provisioned under
BankAMSP distinct from BankA's own identity (`User1`). The permission model
(Table, Section 5) has a distinct `Middleware` role ("read events / submit
transactions"), and this identity is scoped to exactly that: chaincode
(`assertIsMiddleware` in `fraudLedgerContract.ts`) recognizes it specifically
for `RecordFraudDecision` (the ML model's decision write-back, which no bank
should be able to submit on its own behalf), while `CreateTransactionRecord`
still accepts any writer-org identity per the "Bank / Wallet / Middleware ->
submit transactions" row.

There's no 5th "Middleware" org/MSP — Section 2 fixes the consortium at the
four ledger-owning orgs, and Middleware holds no peers or channel admin
rights, so a `MiddlewareMSP` would misrepresent it as a consortium member.
A same-org, reduced-privilege client identity is the correct shape here.

What's still a placeholder: this identity's crypto material is generated by
`cryptogen` (static, dev-only certs — see `network/crypto-config.yaml`),
which can only produce sequentially-named identities (`User1`, `User2`, ...),
not custom attributes. A real deployment should register it with a Fabric CA
instead, giving it a proper name and a `role=middleware` attribute so
chaincode can check `ctx.clientIdentity.assertAttributeValue()` rather than
matching on a certificate CN — see "Not done here".

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
  crypto material — fine for dev, not for onboarding real institutions, and
  the reason the Middleware identity above is distinguished by certificate
  CN rather than a proper CA-issued attribute).
- Actually running any of this — deferred at your request; see Status above.
  Also, as of this sandbox's environment, blocked independent of that: the
  Docker daemon here cannot pull any images (Docker Hub blob downloads
  return `403 Forbidden` through this environment's network proxy —
  confirmed with `hello-world`), so `network-up.sh` / `create-channel.sh` /
  `deploy-chaincode.sh` cannot be executed to prove out an actual running
  network from here. The Middleware identity and majority endorsement
  policy fixes above are code/config-complete and validated by TypeScript
  compilation + YAML parsing + cross-file consistency (peer/org/MSP names
  match across `crypto-config.yaml`, `configtx.yaml`, and
  `docker-compose.yaml`) — they're a `cryptogen generate` + `docker compose
  up` away from being live the moment real infra is available.

Previously-listed items now fixed at the code/config level (see above):
a dedicated Middleware application identity, and multiple peers per org
with a majority endorsement policy.
