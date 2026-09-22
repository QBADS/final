import { firestore } from "./firebaseAdmin";
import type { LiveFeedEvent } from "../domainTypes";

/**
 * Real-time dashboard feed: publishes each live-feed event to Firestore's
 * `live_feed` collection so both dashboards can subscribe directly for
 * push updates, in addition to the existing SQLite-backed SSE path
 * (server.ts's own /api/dashboard/live-feed is untouched).
 *
 * Best-effort, fire-and-forget - exactly like blockchainClient.ts's
 * writes: a Firestore hiccup must never add latency to, or fail, the
 * transaction pipeline's own response.
 */
export async function publishLiveFeedEvent(event: LiveFeedEvent): Promise<boolean> {
  if (!firestore) return false;
  try {
    await firestore
      .collection("live_feed")
      .doc(event.id)
      .set({ ...event, publishedAt: Date.now() });
    return true;
  } catch (err) {
    console.warn(`[firebaseClient] failed to publish live feed event ${event.id}: ${(err as Error).message}`);
    return false;
  }
}
