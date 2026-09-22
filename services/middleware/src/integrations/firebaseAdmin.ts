import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { config } from "../config";

/**
 * Firebase Admin SDK bootstrap for the real-time dashboard feed
 * (integrations/firebaseClient.ts). Self-disables (rather than crashing
 * startup) if FIREBASE_LIVE_FEED_ENABLED is false or the service account
 * file is missing/invalid - same "deterministic under failure" principle
 * as blockchainClient.ts/platformHealthClient.ts: a misconfigured or
 * unreachable Firebase project must never take down the transaction
 * pipeline, it should just mean live-feed events don't reach Firestore.
 *
 * The service account key is a real credential - it lives only at
 * firebase-service-account.json (gitignored, never committed) or wherever
 * FIREBASE_SERVICE_ACCOUNT_PATH points, and is never logged.
 */
let firestore: Firestore | null = null;

if (config.firebaseLiveFeedEnabled) {
  const keyPath = join(__dirname, "..", "..", config.firebaseServiceAccountPath);
  if (existsSync(keyPath)) {
    try {
      const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8")) as { project_id?: string };
      if (getApps().length === 0) {
        initializeApp({ credential: cert(keyPath) });
      }
      firestore = getFirestore();
      console.log(`[firebaseAdmin] initialized for project ${serviceAccount.project_id}`);
    } catch (err) {
      console.warn(`[firebaseAdmin] failed to initialize: ${(err as Error).message} - live feed will not publish to Firestore`);
    }
  } else {
    console.warn(`[firebaseAdmin] service account file not found at ${keyPath} - live feed will not publish to Firestore`);
  }
}

export { firestore };
