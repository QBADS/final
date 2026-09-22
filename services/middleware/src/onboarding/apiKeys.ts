import { createHash, randomBytes } from "node:crypto";

/**
 * API key generation/hashing for institution onboarding
 * (routes/onboardingApi.ts, store/inMemoryStore.ts's approveInstitution/
 * rotateInstitutionKey). Plain SHA-256 is the right tool here (unlike
 * scrypt for dashboard passwords in auth/dashboardAuth.ts) - these are
 * high-entropy generated tokens, not human-chosen low-entropy passwords,
 * so there's nothing for a slow hash to protect against; SHA-256 is the
 * same choice GitHub/Stripe-style API tokens use.
 *
 * The plaintext key is returned to the caller exactly once, at generation
 * time, and is never persisted anywhere - only its hash (for auth
 * verification) and a short preview (for display, e.g. "Security
 * operations") are stored.
 */

const KEY_PREFIX = "qbads_live_";

export function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Same masking shape as the existing dashboardApi.ts maskKey - kept here
 * so it's computed once at issuance time, not from a plaintext key that no
 * longer exists after this call returns. */
export function previewApiKey(plaintext: string): string {
  return plaintext.length <= 18 ? plaintext : `${plaintext.slice(0, 14)}…${plaintext.slice(-4)}`;
}
