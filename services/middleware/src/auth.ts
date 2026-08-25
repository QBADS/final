import type { NextFunction, Request, Response } from "express";
import { store } from "./store/inMemoryStore";
import type { Institution } from "./domainTypes";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      institution?: Institution;
    }
  }
}

/**
 * "API Gateway (entry layer): AuthN/AuthZ - routes all four APIs"
 * (QBADS_Middleware_Flow_Structure.pdf, Section 2). Node API calls must
 * present a valid institution API key; Dashboard API is read-only and
 * unauthenticated in this reference implementation (a real deployment
 * would put session auth in front of it).
 */
export function requireNodeAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.header("x-api-key");
  if (!apiKey) {
    store.pushAuthEvent({ type: "missing_key", keyPrefix: null, path: req.path, occurredAt: new Date().toISOString() });
    res.status(401).json({ error: "missing x-api-key header" });
    return;
  }
  const institution = store.institutionByApiKey(apiKey);
  if (!institution) {
    store.pushAuthEvent({
      type: "invalid_key",
      keyPrefix: apiKey.slice(0, 16),
      path: req.path,
      occurredAt: new Date().toISOString(),
    });
    res.status(401).json({ error: "invalid api key" });
    return;
  }
  req.institution = institution;
  next();
}
