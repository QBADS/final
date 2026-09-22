import { useEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import type { LiveFeedEvent, TickerItem } from "@qbads/types";
import { db } from "./firebase";

/**
 * Polls `fetchFn` on an interval, keeping the last known value on a
 * transient failure. Pass `deps` (e.g. a filter value) to re-fetch
 * immediately when it changes, instead of waiting for the next tick.
 */
export function usePoll<T>(fetchFn: () => Promise<T>, intervalMs: number, initial: T, deps: unknown[] = []): T {
  const [data, setData] = useState<T>(initial);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await fetchRef.current();
        if (!cancelled) setData(result);
      } catch {
        // keep the last known value - Middleware may be mid-restart
      }
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return data;
}

/**
 * Real-time live feed, read directly from Firestore (populated by
 * services/middleware's integrations/firebaseClient.ts) rather than
 * Middleware's SSE endpoint - see the implementation notes for why live
 * feed/ticker specifically were chosen for this, and
 * services/middleware/firestore.rules for the read-only security rule
 * this depends on.
 */
export function useLiveFeed(max = 8): LiveFeedEvent[] {
  const [events, setEvents] = useState<LiveFeedEvent[]>([]);

  useEffect(() => {
    const q = query(collection(db, "live_feed"), orderBy("occurredAt", "desc"), limit(max));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEvents(snapshot.docs.map((doc) => doc.data() as LiveFeedEvent));
      },
      (err) => {
        // keep the last known value - same "deterministic under failure"
        // stance as usePoll's catch block below
        console.warn("[useLiveFeed] Firestore listener error", err);
      },
    );
    return () => unsubscribe();
  }, [max]);

  return events;
}

/**
 * Ticker bar, derived from the same Firestore live-feed stream -
 * reproduces the exact severity/message format Middleware's own
 * GET /api/dashboard/ticker uses, but pushed in real time instead of
 * polled. Does not include the offline-institution entries the REST
 * ticker endpoint adds (that's institution-health data, not a live
 * transaction event) - fetchTicker/GET /api/dashboard/ticker still exists
 * if that's needed again later.
 */
export function useFirestoreTicker(max = 6): TickerItem[] {
  const events = useLiveFeed(max);
  return events.map((event) => ({
    id: event.id,
    severity: event.riskLevel === "high" ? "bad" : event.riskLevel === "medium" ? "warn" : "ok",
    message: `${event.transactionId} · ${event.institutionName} · risk ${event.riskScore.toFixed(0)} (${event.chainStatus})`,
  }));
}
