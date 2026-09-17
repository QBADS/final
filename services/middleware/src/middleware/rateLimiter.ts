import type { NextFunction, Request, Response } from "express";

/**
 * Minimal fixed-window rate limiter, in-process Map. No rate-limiting
 * exists anywhere else in this repo (confirmed) and the only route that
 * needs it (POST /api/v1/quantum/jobs - a quota-consuming, potentially
 * billed call to a real IBM Cloud account) is single-key (dashboard
 * username), low-cardinality - a ~20-line Map beats adding
 * express-rate-limit as a new dependency for one route family. If
 * rate-limiting is ever needed repo-wide, that's the point to reconsider.
 */
interface LimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyFn: (req: Request) => string;
  message: string;
}

export function rateLimiter(options: LimiterOptions) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return function (req: Request, res: Response, next: NextFunction): void {
    const key = options.keyFn(req);
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= options.windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      next();
      return;
    }
    if (entry.count >= options.maxRequests) {
      res.status(429).json({ error: options.message, requestId: req.requestId });
      return;
    }
    entry.count += 1;
    next();
  };
}
