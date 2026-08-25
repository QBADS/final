import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";

/**
 * QBADS smart contract layer (Table 1, "Smart contract layer" row of
 * QBADS_Hyperledger_Fabric_Architecture.pdf): validation, duplicate
 * detection, state update, event generation. Two record types share the
 * world state: transaction intake records and the fraud decisions written
 * back by Middleware (Table 3: "decision hash, risk class, model version").
 */

export interface TransactionRecord {
  docType: "transaction";
  txId: string;
  institutionId: string;
  amount: number;
  currency: string;
  payloadHash: string;
  submittedAt: string;
  chainRecordedAt: string;
}

export interface FraudDecisionRecord {
  docType: "decision";
  txId: string;
  institutionId: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  decision: "SAFE" | "REVIEW" | "FRAUD" | "HOLD";
  confidence: number;
  modelVersion: string;
  decisionHash: string;
  decidedAt: string;
  chainRecordedAt: string;
}

const txKey = (txId: string) => `TX_${txId}`;
const decisionKey = (txId: string) => `DECISION_${txId}`;

function chaincodeTxTimestampIso(ctx: Context): string {
  const ts = ctx.stub.getTxTimestamp();
  const seconds = typeof ts.seconds.toNumber === "function" ? ts.seconds.toNumber() : Number(ts.seconds);
  return new Date(seconds * 1000).toISOString();
}

@Info({ title: "FraudLedgerContract", description: "QBADS transaction intake and fraud decision ledger" })
export class FraudLedgerContract extends Contract {
  /**
   * Records an inbound transaction event on-chain (Middleware Blockchain API
   * "in": Fabric chaincode events in). Rejects duplicates - a transaction
   * ID can only be recorded once.
   */
  @Transaction()
  public async CreateTransactionRecord(
    ctx: Context,
    txId: string,
    institutionId: string,
    amount: string,
    currency: string,
    payloadHash: string,
    submittedAt: string,
  ): Promise<void> {
    if (!txId || !institutionId) {
      throw new Error("txId and institutionId are required");
    }

    const existing = await ctx.stub.getState(txKey(txId));
    if (existing.length > 0) {
      throw new Error(`Transaction ${txId} already recorded (duplicate submission)`);
    }

    const amountNum = Number(amount);
    if (Number.isNaN(amountNum) || amountNum < 0) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    const record: TransactionRecord = {
      docType: "transaction",
      txId,
      institutionId,
      amount: amountNum,
      currency,
      payloadHash,
      submittedAt,
      chainRecordedAt: chaincodeTxTimestampIso(ctx),
    };

    await ctx.stub.putState(txKey(txId), Buffer.from(JSON.stringify(record)));
    ctx.stub.setEvent("TransactionRecorded", Buffer.from(JSON.stringify(record)));
  }

  /**
   * Writes an auditable fraud decision back on-chain (Middleware Blockchain
   * API "out": decision hash, risk class, model version). The referenced
   * transaction must already exist.
   */
  @Transaction()
  public async RecordFraudDecision(
    ctx: Context,
    txId: string,
    riskScore: string,
    riskLevel: string,
    decision: string,
    confidence: string,
    modelVersion: string,
    decisionHash: string,
    decidedAt: string,
  ): Promise<void> {
    const txBytes = await ctx.stub.getState(txKey(txId));
    if (txBytes.length === 0) {
      throw new Error(`Cannot record a decision for unknown transaction ${txId}`);
    }
    const tx = JSON.parse(txBytes.toString()) as TransactionRecord;

    const existingDecision = await ctx.stub.getState(decisionKey(txId));
    if (existingDecision.length > 0) {
      throw new Error(`Decision for transaction ${txId} already recorded`);
    }

    if (!["low", "medium", "high"].includes(riskLevel)) {
      throw new Error(`Invalid riskLevel: ${riskLevel}`);
    }
    if (!["SAFE", "REVIEW", "FRAUD", "HOLD"].includes(decision)) {
      throw new Error(`Invalid decision: ${decision}`);
    }

    const record: FraudDecisionRecord = {
      docType: "decision",
      txId,
      institutionId: tx.institutionId,
      riskScore: Number(riskScore),
      riskLevel: riskLevel as FraudDecisionRecord["riskLevel"],
      decision: decision as FraudDecisionRecord["decision"],
      confidence: Number(confidence),
      modelVersion,
      decisionHash,
      decidedAt,
      chainRecordedAt: chaincodeTxTimestampIso(ctx),
    };

    await ctx.stub.putState(decisionKey(txId), Buffer.from(JSON.stringify(record)));
    ctx.stub.setEvent("FraudDecisionRecorded", Buffer.from(JSON.stringify(record)));
  }

  @Transaction(false)
  @Returns("string")
  public async GetTransaction(ctx: Context, txId: string): Promise<string> {
    const bytes = await ctx.stub.getState(txKey(txId));
    if (bytes.length === 0) {
      throw new Error(`Transaction ${txId} not found`);
    }
    return bytes.toString();
  }

  @Transaction(false)
  @Returns("string")
  public async GetDecision(ctx: Context, txId: string): Promise<string> {
    const bytes = await ctx.stub.getState(decisionKey(txId));
    if (bytes.length === 0) {
      throw new Error(`Decision for transaction ${txId} not found`);
    }
    return bytes.toString();
  }

  /** Full audit trail for one transaction key - every write, in order (Table 1: "audit trail"). */
  @Transaction(false)
  @Returns("string")
  public async GetTransactionAuditTrail(ctx: Context, txId: string): Promise<string> {
    const iterator = await ctx.stub.getHistoryForKey(txKey(txId));
    const history: unknown[] = [];
    let result = await iterator.next();
    while (!result.done) {
      if (result.value) {
        history.push({
          txHash: result.value.txId,
          timestamp: result.value.timestamp,
          isDelete: result.value.isDelete,
          value: result.value.value.length > 0 ? JSON.parse(result.value.value.toString()) : null,
        });
      }
      result = await iterator.next();
    }
    await iterator.close();
    return JSON.stringify(history);
  }

  /** CouchDB rich query - world state is queryable key-value data (Table 1: "Storage layer"). */
  @Transaction(false)
  @Returns("string")
  public async QueryTransactionsByInstitution(ctx: Context, institutionId: string): Promise<string> {
    const query = {
      selector: { docType: "transaction", institutionId },
    };
    const iterator = await ctx.stub.getQueryResult(JSON.stringify(query));
    const results: unknown[] = [];
    let result = await iterator.next();
    while (!result.done) {
      if (result.value) {
        results.push(JSON.parse(result.value.value.toString()));
      }
      result = await iterator.next();
    }
    await iterator.close();
    return JSON.stringify(results);
  }
}
