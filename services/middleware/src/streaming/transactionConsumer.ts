import { broker, TOPICS } from "./index";
import { resolvePendingResult, rejectPendingResult } from "./pendingResults";
import { processIngestedTransaction } from "../pipeline/transactionIngestion";

/**
 * The subscriber side of the streaming boundary: consumes raw transaction
 * messages off qbads.transactions.raw and runs the full downstream
 * pipeline - feature engineering -> vector standardization -> quantum
 * orchestration -> decision engine -> output routing (storage, live feed,
 * blockchain write-back) - all inside processIngestedTransaction. Started
 * once at server boot (server.ts).
 */
const CONSUMER_GROUP = "middleware-pipeline";

interface RawTransactionMessage {
  messageId: string;
  txId: string;
  body: Record<string, unknown>;
}

function isRawTransactionMessage(value: unknown): value is RawTransactionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RawTransactionMessage).messageId === "string" &&
    typeof (value as RawTransactionMessage).txId === "string" &&
    typeof (value as RawTransactionMessage).body === "object"
  );
}

export async function startTransactionConsumer(): Promise<void> {
  await broker.subscribe(TOPICS.TRANSACTIONS_RAW, CONSUMER_GROUP, async (raw) => {
    if (!isRawTransactionMessage(raw)) {
      console.error("[transactionConsumer] dropped malformed message (missing messageId/txId/body)");
      return;
    }
    try {
      const outcome = await processIngestedTransaction(raw.txId, raw.body);
      resolvePendingResult(raw.messageId, outcome);
    } catch (err) {
      rejectPendingResult(raw.messageId, err);
    }
  });
  console.log(`[streaming] transaction consumer subscribed to ${TOPICS.TRANSACTIONS_RAW} (group=${CONSUMER_GROUP})`);
}
