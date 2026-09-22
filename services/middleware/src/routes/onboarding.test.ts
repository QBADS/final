import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../config";

let server: Server;
let baseUrl: string;
let execAdminToken: string;
let institutionToken: string;

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/dashboard/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return ((await res.json()) as { token: string }).token;
}

function authed(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

async function apply(overrides: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/institutions/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Test Bank",
      kind: "bank",
      region: "US",
      contactName: "Jane Doe",
      contactEmail: "jane@testbank.example",
      ...overrides,
    }),
  });
}

beforeAll(async () => {
  // Must be set before the dynamic import below - onboardingApi.ts's
  // rateLimiter(...) call reads this once, at module-load time (same
  // pattern as quantumJobsApi.rateLimit.test.ts). This file applies more
  // than the production default (5/hour) across its own test cases.
  config.onboardingApplyRateLimitPerHour = 1000;

  const { app } = await import("../server");
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  execAdminToken = await login("exec-admin", "qbads-exec-admin-2026");
  institutionToken = await login("novafintech", "qbads-novafintech-2026");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("backward compatibility: seeded institutions still authenticate", () => {
  it("an existing sandbox key still works against the Node API after the hash migration", async () => {
    const res = await fetch(`${baseUrl}/api/node/status`, { headers: { "x-api-key": "qbads_sandbox_novafintech" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.institution.id).toBe("inst-2");
  });
});

describe("public application", () => {
  it("accepts a valid application as pending, with no key issued", async () => {
    const res = await apply();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.applicationId).toMatch(/^inst-/);
  });

  it("rejects an invalid email with 422", async () => {
    const res = await apply({ contactEmail: "not-an-email" });
    expect(res.status).toBe(422);
  });

  it("rejects an invalid kind with 422", async () => {
    const res = await apply({ kind: "not-a-real-kind" });
    expect(res.status).toBe(422);
  });

  it("rejects a missing name with 422", async () => {
    const res = await apply({ name: "" });
    expect(res.status).toBe(422);
  });
});

describe("exec-admin review", () => {
  it("institution role cannot access the pending queue", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/institutions/pending`, { headers: authed(institutionToken) });
    expect(res.status).toBe(403);
  });

  it("unauthenticated requests are rejected", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/institutions/pending`);
    expect(res.status).toBe(401);
  });

  it("full lifecycle: apply -> appears in pending -> approve -> key works -> rotate -> old key dead, new key works -> revoke -> key dead", async () => {
    const applyRes = await apply({ name: "Lifecycle Bank", contactEmail: "ops@lifecycle.example" });
    const { applicationId } = await applyRes.json();

    const pendingRes = await fetch(`${baseUrl}/api/dashboard/institutions/pending`, { headers: authed(execAdminToken) });
    const pending = await pendingRes.json();
    expect(pending.some((i: { id: string }) => i.id === applicationId)).toBe(true);

    const approveRes = await fetch(`${baseUrl}/api/dashboard/institutions/${applicationId}/approve`, {
      method: "POST",
      headers: authed(execAdminToken),
    });
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    expect(approveBody.institution.onboardingStatus).toBe("active");
    const firstKey: string = approveBody.apiKey;
    expect(firstKey).toMatch(/^qbads_live_/);

    // The freshly issued key genuinely authenticates against the Node API.
    const useKeyRes = await fetch(`${baseUrl}/api/node/status`, { headers: { "x-api-key": firstKey } });
    expect(useKeyRes.status).toBe(200);

    // Approving again is rejected - already active, not pending.
    const reapproveRes = await fetch(`${baseUrl}/api/dashboard/institutions/${applicationId}/approve`, {
      method: "POST",
      headers: authed(execAdminToken),
    });
    expect(reapproveRes.status).toBe(409);

    // Rotate: old key stops working, new key works.
    const rotateRes = await fetch(`${baseUrl}/api/dashboard/institutions/${applicationId}/rotate-key`, {
      method: "POST",
      headers: authed(execAdminToken),
    });
    expect(rotateRes.status).toBe(200);
    const secondKey: string = (await rotateRes.json()).apiKey;
    expect(secondKey).not.toBe(firstKey);

    const oldKeyRes = await fetch(`${baseUrl}/api/node/status`, { headers: { "x-api-key": firstKey } });
    expect(oldKeyRes.status).toBe(401);
    const newKeyRes = await fetch(`${baseUrl}/api/node/status`, { headers: { "x-api-key": secondKey } });
    expect(newKeyRes.status).toBe(200);

    // Revoke: even the current key stops working immediately.
    const revokeRes = await fetch(`${baseUrl}/api/dashboard/institutions/${applicationId}/revoke`, {
      method: "POST",
      headers: authed(execAdminToken),
    });
    expect(revokeRes.status).toBe(200);
    const afterRevokeRes = await fetch(`${baseUrl}/api/node/status`, { headers: { "x-api-key": secondKey } });
    expect(afterRevokeRes.status).toBe(401);
  });

  it("reject flow: a rejected application is never issued a key and cannot later be approved", async () => {
    const applyRes = await apply({ name: "Rejected Corp", contactEmail: "ops@rejected.example" });
    const { applicationId } = await applyRes.json();

    const rejectRes = await fetch(`${baseUrl}/api/dashboard/institutions/${applicationId}/reject`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json" },
      body: JSON.stringify({ reason: "Sanctions screening failed" }),
    });
    expect(rejectRes.status).toBe(200);
    const rejectBody = await rejectRes.json();
    expect(rejectBody.institution.onboardingStatus).toBe("rejected");
    expect(rejectBody.institution.apiKeyHash).toBeUndefined(); // never exposed

    const approveAfterRejectRes = await fetch(`${baseUrl}/api/dashboard/institutions/${applicationId}/approve`, {
      method: "POST",
      headers: authed(execAdminToken),
    });
    expect(approveAfterRejectRes.status).toBe(409);
  });

  it("reject requires a reason", async () => {
    const applyRes = await apply({ name: "No Reason Inc", contactEmail: "ops@noreason.example" });
    const { applicationId } = await applyRes.json();
    const res = await fetch(`${baseUrl}/api/dashboard/institutions/${applicationId}/reject`, {
      method: "POST",
      headers: { ...authed(execAdminToken), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});
