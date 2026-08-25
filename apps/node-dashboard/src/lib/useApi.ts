import { useEffect, useRef, useState } from "react";
import type { LiveFeedEvent } from "@qbads/types";
import { API_BASE } from "./apiClient";

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

/** Subscribes to Middleware's SSE live feed, filtered to one institution's own events. */
export function useLiveFeed(institutionName: string | null, max = 8): LiveFeedEvent[] {
  const [events, setEvents] = useState<LiveFeedEvent[]>([]);

  useEffect(() => {
    if (!institutionName) return;
    const source = new EventSource(`${API_BASE}/api/dashboard/live-feed`);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as LiveFeedEvent;
      if (event.institutionName !== institutionName) return;
      setEvents((prev) => [event, ...prev].slice(0, max));
    };
    return () => source.close();
  }, [institutionName, max]);

  return events;
}
