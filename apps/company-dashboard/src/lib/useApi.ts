import { useEffect, useRef, useState } from "react";
import type { LiveFeedEvent } from "@qbads/types";
import { API_BASE } from "./apiClient";

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

/** Subscribes to Middleware's SSE live feed (GET /api/dashboard/live-feed). */
export function useLiveFeed(max = 8): LiveFeedEvent[] {
  const [events, setEvents] = useState<LiveFeedEvent[]>([]);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/dashboard/live-feed`);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as LiveFeedEvent;
      setEvents((prev) => [event, ...prev].slice(0, max));
    };
    return () => source.close();
  }, [max]);

  return events;
}
