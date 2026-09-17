import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Correlation-ID middleware. No such pattern existed anywhere on the HTTP
 * boundary before this (only an internal Kafka/pub-sub messageId, see
 * streaming/pendingResults.ts) - introduced for the new IBM Quantum
 * job-management feature's structured logging, but mounted globally in
 * server.ts since every route benefits from it for free.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.header("x-request-id") ?? randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}
