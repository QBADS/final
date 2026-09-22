import { useEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import type { LiveFeedEvent } from "@qbads/types";
import { db } from "./firebase";

// Firestore query window before the client-side institution filter below -
// wider than `max` since only a fraction of the most recent events across
// ALL institutions will belong to this one.
const LIVE_FEED_QUERY_WINDOW = 50;

/** Polls `fetchFn` on an interval, keeping the last known value on a transient failure. */
export function usePoll<T>(fetchFn: () => Promise<T>, intervalMs: number, initial: T): T {
  const [data, setData] = useState<T>(initial);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

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
  }, [intervalMs]);

  return data;
}

/**
 * Real-time live feed, read directly from Firestore (populated by
 * services/middleware's integrations/firebaseClient.ts) rather than
 * Middleware's SSE endpoint, filtered to one institution's own events -
 * see services/middleware/firestore.rules for the read-only security rule
 * this depends on.
 */
export function useLiveFeed(institutionName: string | null, max = 8): LiveFeedEvent[] {
  const [events, setEvents] = useState<LiveFeedEvent[]>([]);

  useEffect(() => {
    if (!institutionName) return;
    const q = query(collection(db, "live_feed"), orderBy("occurredAt", "desc"), limit(LIVE_FEED_QUERY_WINDOW));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const mine = snapshot.docs.map((doc) => doc.data() as LiveFeedEvent).filter((e) => e.institutionName === institutionName);
        setEvents(mine.slice(0, max));
      },
      (err) => {
        console.warn("[useLiveFeed] Firestore listener error", err);
      },
    );
    return () => unsubscribe();
  }, [institutionName, max]);

  return events;
}
