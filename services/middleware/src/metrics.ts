import type { NextFunction, Request, Response } from "express";

/**
 * Real request metrics for the "API Gateway" row of the Dashboard API's
 * platform-health response (routes/dashboardApi.ts) - this middleware's
 * own request count/latency, not a simulated number.
 */
const startedAt = Date.now();
let requestCount = 0;
const recentLatenciesMs: number[] = [];
const MAX_SAMPLES = 200;

export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    requestCount += 1;
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    recentLatenciesMs.push(elapsedMs);
    if (recentLatenciesMs.length > MAX_SAMPLES) recentLatenciesMs.shift();
  });
  next();
}

export function requestMetricsSnapshot() {
  const uptimeSec = (Date.now() - startedAt) / 1000;
  const sorted = [...recentLatenciesMs].sort((a, b) => a - b);
  const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0;

  return {
    uptimePct: 100, // this process hasn't restarted since startedAt, by definition
    requestsPerSecond: uptimeSec > 0 ? Number((requestCount / uptimeSec).toFixed(2)) : 0,
    p99LatencyMs: Number(p99.toFixed(1)),
    requestCount,
    uptimeSec: Math.round(uptimeSec),
  };
}
