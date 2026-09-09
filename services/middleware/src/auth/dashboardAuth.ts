import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { db } from "../store/db";

/**
 * Session auth for the Dashboard API (README's "Not done here: Session
 * auth in front of the Dashboard API (currently open)"). Deliberately
 * simple and appropriate for what these two frontends actually are - two
 * fixed, internal/institution-facing tools, not a multi-tenant consumer
 * product - so this is username/password login issuing a signed,
 * short-lived bearer token, not a full identity system.
 *
 * This is completely separate from ../auth.ts (Node API's per-institution
 * API-key auth for transaction ingestion), which is unchanged.
 */

export type DashboardRole = "exec-admin" | "institution";

export interface DashboardSession {
  username: string;
  role: DashboardRole;
  institutionId?: string;
  jti: string;
  exp: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      dashboardSession?: DashboardSession;
    }
  }
}

interface DashboardUser {
  username: string;
  salt: string;
  passwordHash: string; // scrypt(password, salt), hex
  role: DashboardRole;
  institutionId?: string;
}

// scrypt (Node stdlib, `node:crypto`) rather than adding bcrypt as a new
// dependency - dependency-free, and plenty for two seeded accounts.
function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function makeUser(username: string, password: string, role: DashboardRole, institutionId?: string): DashboardUser {
  const salt = randomBytes(16).toString("hex");
  return { username, salt, passwordHash: hashPassword(password, salt), role, institutionId };
}

// Seeded accounts (architecture spec's mockup footer: "role: exec-admin"
// for Company Dash; Node Dash is fixed to one sandbox institution per this
// service's README, so its account is scoped to inst-2 / Nova Fintech, the
// same institution apps/node-dashboard's Node API key already points at).
// Passwords are dev defaults, overridable via env - this is a reference
// implementation's sandbox, not a real credential store.
const USERS: DashboardUser[] = [
  makeUser(process.env.DASHBOARD_ADMIN_USERNAME ?? "exec-admin", process.env.DASHBOARD_ADMIN_PASSWORD ?? "qbads-exec-admin-2026", "exec-admin"),
  makeUser(process.env.DASHBOARD_NODE_USERNAME ?? "novafintech", process.env.DASHBOARD_NODE_PASSWORD ?? "qbads-novafintech-2026", "institution", "inst-2"),
];

function verifyPassword(user: DashboardUser, password: string): boolean {
  const attempt = Buffer.from(hashPassword(password, user.salt), "hex");
  const actual = Buffer.from(user.passwordHash, "hex");
  return attempt.length === actual.length && timingSafeEqual(attempt, actual);
}

const JWT_SECRET = process.env.DASHBOARD_JWT_SECRET ?? "qbads-middleware-dev-dashboard-secret-do-not-use-in-prod";
const TOKEN_TTL_SECONDS = Number(process.env.DASHBOARD_TOKEN_TTL_SECONDS ?? 8 * 60 * 60); // 8h

// ---- revocation list (logout) - persisted so a logged-out token can't be
// replayed after a Middleware restart; pruned of anything already expired. ----

function revokeToken(jti: string, expiresAtEpochSeconds: number): void {
  db.prepare("INSERT OR REPLACE INTO revoked_tokens (jti, expiresAt, revokedAt) VALUES (?, ?, ?)").run(
    jti,
    expiresAtEpochSeconds,
    new Date().toISOString(),
  );
}

function isTokenRevoked(jti: string): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  db.exec(`DELETE FROM revoked_tokens WHERE expiresAt < ${nowSeconds}`);
  const row = db.prepare("SELECT 1 FROM revoked_tokens WHERE jti = ?").get(jti);
  return Boolean(row);
}

export const dashboardAuthRouter = Router();

dashboardAuthRouter.post("/login", (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const user = USERS.find((u) => u.username === username);
  if (!user || !verifyPassword(user, password)) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  const jti = randomUUID();
  const token = jwt.sign({ role: user.role, institutionId: user.institutionId }, JWT_SECRET, {
    subject: user.username,
    jwtid: jti,
    expiresIn: TOKEN_TTL_SECONDS,
  });
  res.json({
    token,
    tokenType: "Bearer",
    expiresInSeconds: TOKEN_TTL_SECONDS,
    username: user.username,
    role: user.role,
    institutionId: user.institutionId ?? null,
  });
});

dashboardAuthRouter.post("/logout", requireDashboardSession, (req, res) => {
  const session = req.dashboardSession!;
  revokeToken(session.jti, session.exp);
  res.status(204).end();
});

/**
 * Bearer-token auth middleware for every other Dashboard API route.
 *
 * Token normally arrives as `Authorization: Bearer <token>`. The one
 * exception is GET /api/dashboard/live-feed (Server-Sent Events): browsers'
 * EventSource API cannot set custom request headers, so - a standard,
 * documented workaround for authenticating SSE, not a security shortcut -
 * this also accepts the token as a `?token=` query parameter. Query-string
 * tokens are otherwise not accepted anywhere else, and this token is
 * short-lived and revocable exactly like the header form.
 */
export function requireDashboardSession(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const isSseRoute = req.path === "/live-feed" || req.path.endsWith("/live-feed");
  const queryToken = isSseRoute && typeof req.query.token === "string" ? req.query.token : undefined;
  const token = bearer ?? queryToken;

  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
    return;
  }

  if (!payload.jti || !payload.sub || !payload.exp) {
    res.status(401).json({ error: "malformed token" });
    return;
  }
  if (isTokenRevoked(payload.jti)) {
    res.status(401).json({ error: "token has been revoked" });
    return;
  }

  req.dashboardSession = {
    username: payload.sub,
    role: payload.role as DashboardRole,
    institutionId: payload.institutionId as string | undefined,
    jti: payload.jti,
    exp: payload.exp,
  };
  next();
}

/**
 * Row-level scoping for the "institution" role (Node Dash): confines it to
 * its own seeded institution, matching the docblock in dashboardApi.ts's
 * original unauthenticated version ("a real deployment would ... scope
 * Node Dash calls to the caller's own institution"). exec-admin (Company
 * Dash) is unrestricted.
 */
export function scopeInstitutionId(req: Request, requested: string | undefined): string | undefined {
  const session = req.dashboardSession;
  if (session?.role === "institution") return session.institutionId;
  return requested;
}

export function forbiddenForOtherInstitution(req: Request, institutionId: string): boolean {
  const session = req.dashboardSession;
  return session?.role === "institution" && session.institutionId !== institutionId;
}
