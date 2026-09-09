/**
 * Correlates a published message with the result of the subscriber that
 * eventually processes it, keyed by a caller-generated messageId.
 *
 * Design choice (documented per the task): rather than making the Node API
 * fire-and-forget (which would break the two dashboards' dependency on a
 * synchronous decision in the POST /transactions response), the HTTP
 * handler publishes the raw transaction onto the streaming topic and then
 * awaits this in-memory promise, which streaming/transactionConsumer.ts
 * resolves/rejects once it finishes running the pipeline for that specific
 * message. The HTTP response is still synchronous from the caller's point
 * of view; a genuine publish/subscribe boundary now sits between ingestion
 * and processing rather than a direct in-process function call.
 *
 * This only works because the consumer runs in the same Node process as
 * the producer (true for both the in-process broker and, in this single-
 * instance deployment, the Kafka one too) - a horizontally-scaled
 * multi-instance deployment would need a shared correlation store instead
 * (e.g. Redis), which is out of scope for this reference implementation.
 */
interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

const pending = new Map<string, PendingEntry>();

/**
 * Registers a pending slot for `id` and returns a promise that resolves or
 * rejects once resolvePendingResult/rejectPendingResult is called with the
 * same id, or after `timeoutMs` elapses (whichever comes first). Call this
 * *before* publishing the message - the executor runs synchronously, so the
 * slot exists the moment this returns, closing the race against a
 * same-tick consumer delivery.
 */
export function registerPendingResult<T>(id: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`streaming pipeline result for ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

export function resolvePendingResult(id: string, value: unknown): void {
  const entry = pending.get(id);
  if (!entry) return; // already timed out, or nothing was waiting (e.g. a replayed/duplicate message)
  pending.delete(id);
  entry.resolve(value);
}

export function rejectPendingResult(id: string, err: unknown): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.reject(err);
}
