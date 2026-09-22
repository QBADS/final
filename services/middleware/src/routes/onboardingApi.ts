import { Router } from "express";
import { config } from "../config";
import { store } from "../store/inMemoryStore";
import { rateLimiter } from "../middleware/rateLimiter";
import type { InstitutionKind } from "../domainTypes";

/**
 * Institution onboarding: the one deliberately-unauthenticated write
 * endpoint in this service - an institution can't have an API key before
 * applying for one. Everything past this point (review, approve, reject,
 * issue credentials) requires exec-admin dashboard auth - see
 * routes/dashboardApi.ts's institutions-admin routes.
 *
 * This is intentionally NOT instant self-service: applying only creates a
 * `pending` record with no API access. A real institution gets reviewed
 * and approved by a human (exec-admin) before it can submit a single
 * transaction - the standard shape for onboarding a regulated financial
 * institution into a fraud-detection platform, not a consumer signup form.
 */
export const onboardingApiRouter = Router();

const VALID_KINDS: InstitutionKind[] = [
  "bank", "fintech", "digital_wallet", "insurance", "mobile_money", "crypto_exchange", "payment_processor", "regulator",
];

// New institutions default into org-c, the same catch-all Fabric org every
// seeded non-founding institution already uses (see inMemoryStore.ts's
// seedInstitutions) - org-a/org-b are reserved for the two founding bank
// orgs in the network's fixed 4-org consortium (see
// services/blockchain/README.md's "Organizations" section).
const DEFAULT_FABRIC_ORG_ID = "org-c";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

onboardingApiRouter.post(
  "/apply",
  rateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: config.onboardingApplyRateLimitPerHour,
    keyFn: (req) => req.ip ?? "unknown",
    message: "too many onboarding applications from this address - try again later",
  }),
  (req, res) => {
    const { name, kind, region, contactName, contactEmail } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof name !== "string" || !name.trim()) {
      res.status(422).json({ error: "name is required" });
      return;
    }
    if (typeof kind !== "string" || !VALID_KINDS.includes(kind as InstitutionKind)) {
      res.status(422).json({ error: `kind must be one of: ${VALID_KINDS.join(", ")}` });
      return;
    }
    if (typeof region !== "string" || !region.trim()) {
      res.status(422).json({ error: "region is required" });
      return;
    }
    if (typeof contactName !== "string" || !contactName.trim()) {
      res.status(422).json({ error: "contactName is required" });
      return;
    }
    if (typeof contactEmail !== "string" || !EMAIL_PATTERN.test(contactEmail)) {
      res.status(422).json({ error: "contactEmail must be a valid email address" });
      return;
    }

    const institution = store.applyForOnboarding({
      name: name.trim(),
      kind: kind as InstitutionKind,
      region: region.trim(),
      fabricOrgId: DEFAULT_FABRIC_ORG_ID,
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim(),
    });

    res.status(201).json({
      applicationId: institution.id,
      status: institution.onboardingStatus,
      message: "Application received. An administrator will review it before API access is issued.",
    });
  },
);
