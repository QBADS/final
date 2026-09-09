import * as crypto from "node:crypto";
import type { ClassifiedField, FeatureType, NormalizedFeature, RawTransactionInput } from "../domainTypes";

/**
 * Stage 1 of Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf: schema
 * validation (1.2), feature classification (1.3), missing/outlier handling
 * (1.4), normalization (1.5). Runs before Stage 2 (vectorStandardization.ts).
 */

export class QuarantineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuarantineError";
  }
}

export interface FieldConfig {
  type: FeatureType;
  required: boolean;
  // continuous
  min?: number;
  max?: number;
  imputeDefault?: number;
  // categorical_low
  vocab?: string[];
}

// The full 30 core attributes from Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf,
// across its six documented categories (5 fields each): transaction
// details, customer behavior, device signals, location signals,
// authentication signals, merchant/risk indicators. Field names match
// domainTypes.ts's RawTransactionInput/StoredTransaction 1:1.
export const FIELD_CONFIG: Record<string, FieldConfig> = {
  // -- Transaction details --
  amount: { type: "continuous", required: true, min: 0, max: 50_000, imputeDefault: 100 },
  currency: { type: "categorical_low", required: true, vocab: ["USD", "EUR", "GBP", "JPY", "CAD"] },
  paymentChannel: { type: "categorical_low", required: true, vocab: ["card", "bank_transfer", "wallet", "crypto"] },
  merchantCategory: { type: "categorical_high", required: false },
  submittedAt: { type: "timestamp", required: false },

  // -- Customer behavior --
  accountAgeDays: { type: "continuous", required: false, min: 0, max: 10_000, imputeDefault: 365 },
  sessionDurationSec: { type: "continuous", required: false, min: 0, max: 3_600, imputeDefault: 120 },
  avgTransactionAmount30d: { type: "continuous", required: false, min: 0, max: 50_000, imputeDefault: 100 },
  transactionVelocity1h: { type: "continuous", required: false, min: 0, max: 100, imputeDefault: 1 },
  daysSinceLastTransaction: { type: "continuous", required: false, min: 0, max: 3_650, imputeDefault: 30 },

  // -- Device signals --
  deviceType: { type: "categorical_low", required: false, vocab: ["mobile", "desktop", "tablet"] },
  newDeviceFlag: { type: "binary", required: false },
  deviceId: { type: "hashed", required: false },
  browserFingerprint: { type: "hashed", required: false },
  deviceTrustScore: { type: "continuous", required: false, min: 0, max: 100, imputeDefault: 70 },

  // -- Location signals --
  ipAddress: { type: "hashed", required: false },
  crossBorderFlag: { type: "binary", required: false },
  country: { type: "categorical_high", required: false },
  distanceFromHomeKm: { type: "continuous", required: false, min: 0, max: 20_000, imputeDefault: 10 },
  vpnOrProxyFlag: { type: "binary", required: false },

  // -- Authentication signals --
  loginMethod: { type: "categorical_low", required: false, vocab: ["password", "biometric", "otp", "sso"] },
  mfaUsed: { type: "binary", required: false },
  authFailureCount24h: { type: "continuous", required: false, min: 0, max: 50, imputeDefault: 0 },
  passwordAgeDays: { type: "continuous", required: false, min: 0, max: 3_650, imputeDefault: 180 },
  biometricMatchScore: { type: "continuous", required: false, min: 0, max: 100, imputeDefault: 80 },

  // -- Merchant / risk indicators --
  merchantId: { type: "hashed", required: false },
  merchantRiskScore: { type: "continuous", required: false, min: 0, max: 100, imputeDefault: 20 },
  chargebackHistory: { type: "continuous", required: false, min: 0, max: 50, imputeDefault: 0 },
  isHighRiskMerchantCategory: { type: "binary", required: false },
  cardPresentFlag: { type: "binary", required: false },
};

export interface Stage1Result {
  record: RawTransactionInput;
  classified: ClassifiedField[];
  normalized: NormalizedFeature[];
  warnings: string[];
}

/** 1.2 Schema and data validation - rejects records missing required fields or with the wrong type. */
function validate(raw: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  if (!raw.institutionId || typeof raw.institutionId !== "string") {
    throw new QuarantineError("institutionId is required");
  }
  for (const [name, cfg] of Object.entries(FIELD_CONFIG)) {
    if (cfg.required && (raw[name] === undefined || raw[name] === null)) {
      throw new QuarantineError(`${name} is a required field`);
    }
    if (cfg.type === "continuous" && raw[name] !== undefined && typeof raw[name] !== "number") {
      throw new QuarantineError(`${name} must be numeric`);
    }
  }
  return warnings;
}

/** 1.3 Feature classification - tags every field with the type that drives its cleaning/normalization/encoding path. */
function classify(raw: Record<string, unknown>): ClassifiedField[] {
  return Object.entries(FIELD_CONFIG).map(([name, cfg]) => ({
    name,
    type: cfg.type,
    rawValue: raw[name],
  }));
}

/** 1.4 Missing value and outlier handling - impute missing numerics, cap (not drop) extreme values. */
function cleanAndImpute(classified: ClassifiedField[], warnings: string[]): ClassifiedField[] {
  return classified.map((field) => {
    const cfg = FIELD_CONFIG[field.name];
    if (cfg.type === "continuous") {
      let value = typeof field.rawValue === "number" ? field.rawValue : undefined;
      if (value === undefined) {
        value = cfg.imputeDefault ?? 0;
        warnings.push(`${field.name} missing, imputed ${value}`);
      }
      if (cfg.max !== undefined && value > cfg.max) {
        warnings.push(`${field.name} outlier ${value} capped at ${cfg.max}`);
        value = cfg.max;
      }
      if (cfg.min !== undefined && value < cfg.min) {
        value = cfg.min;
      }
      return { ...field, rawValue: value };
    }
    if (cfg.type === "categorical_low" && field.rawValue === undefined) {
      warnings.push(`${field.name} missing, using "unknown" category`);
      return { ...field, rawValue: "unknown" };
    }
    if (cfg.type === "categorical_high" && (field.rawValue === undefined || field.rawValue === null || field.rawValue === "")) {
      warnings.push(`${field.name} missing, using "unknown" category`);
      return { ...field, rawValue: "unknown" };
    }
    if (cfg.type === "binary" && field.rawValue === undefined) {
      return { ...field, rawValue: false };
    }
    if (cfg.type === "hashed" && (field.rawValue === undefined || field.rawValue === null || field.rawValue === "")) {
      warnings.push(`${field.name} missing, using "unknown" identifier`);
      return { ...field, rawValue: "unknown" };
    }
    if (cfg.type === "timestamp" && (field.rawValue === undefined || field.rawValue === null || field.rawValue === "")) {
      warnings.push(`${field.name} missing, defaulted to current time`);
      return { ...field, rawValue: new Date().toISOString() };
    }
    return field;
  });
}

// Frequency table for high-cardinality categorical encoding (1.5: "Replaces
// each category with its occurrence rate"). Learned online from traffic
// rather than a fixed lookup, since there's no historical dataset to seed it
// from yet.
const highCardinalityFrequency = new Map<string, number>();
let highCardinalityTotal = 0;

function frequencyEncode(value: string): number {
  const count = (highCardinalityFrequency.get(value) ?? 0) + 1;
  highCardinalityFrequency.set(value, count);
  highCardinalityTotal += 1;
  return count / highCardinalityTotal;
}

/** Deterministic fixed-length embedding for hashed identifiers (1.5: "Raw hash is never used directly"). */
function hashEmbedding(value: string, dims = 4): number[] {
  const digest = crypto.createHash("sha256").update(value).digest();
  const out: number[] = [];
  for (let i = 0; i < dims; i++) {
    out.push(digest[i] / 255);
  }
  return out;
}

function cyclicalEncode(isoTimestamp: string): number[] {
  const date = new Date(isoTimestamp);
  const hour = Number.isNaN(date.getTime()) ? 0 : date.getUTCHours();
  const day = Number.isNaN(date.getTime()) ? 0 : date.getUTCDay();
  return [
    Math.sin((2 * Math.PI * hour) / 24),
    Math.cos((2 * Math.PI * hour) / 24),
    Math.sin((2 * Math.PI * day) / 7),
    Math.cos((2 * Math.PI * day) / 7),
  ];
}

/** 1.5 Normalization and encoding, per data type. */
function normalize(classified: ClassifiedField[]): NormalizedFeature[] {
  return classified.map((field): NormalizedFeature => {
    const cfg = FIELD_CONFIG[field.name];
    switch (cfg.type) {
      case "continuous": {
        const value = field.rawValue as number;
        const min = cfg.min ?? 0;
        const max = cfg.max ?? 1;
        const scaled = max > min ? (value - min) / (max - min) : 0;
        return { name: field.name, type: field.type, values: [Math.min(1, Math.max(0, scaled))] };
      }
      case "categorical_low": {
        // One-hot over the known vocabulary plus a trailing "unknown" bucket
        // for any value outside it, rather than conflating unknowns with
        // whichever category happens to be listed last.
        const vocab = cfg.vocab ?? [];
        const value = String(field.rawValue);
        const knownIndex = vocab.indexOf(value);
        const oneHot = vocab.map((_, i) => (i === knownIndex ? 1 : 0));
        oneHot.push(knownIndex === -1 ? 1 : 0);
        return { name: field.name, type: field.type, values: oneHot };
      }
      case "categorical_high": {
        const value = String(field.rawValue ?? "unknown");
        return { name: field.name, type: field.type, values: [frequencyEncode(value)] };
      }
      case "binary":
        return { name: field.name, type: field.type, values: [field.rawValue ? 1 : 0] };
      case "hashed":
        return {
          name: field.name,
          type: field.type,
          values: field.rawValue ? hashEmbedding(String(field.rawValue)) : [0, 0, 0, 0],
        };
      case "timestamp":
        return {
          name: field.name,
          type: field.type,
          values: cyclicalEncode(String(field.rawValue ?? new Date().toISOString())),
        };
      default:
        return { name: field.name, type: field.type, values: [0] };
    }
  });
}

/**
 * Flattens Stage 1's cleaned/imputed classified fields back into a plain
 * record - every one of the 30 fields has a concrete value at this point
 * (see cleanAndImpute above), which is what lets nodeApi.ts build a
 * complete StoredTransaction/decision input straight from Stage 1's output
 * rather than re-reading the raw (possibly missing) request body.
 */
export function classifiedToRecord(classified: ClassifiedField[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of classified) {
    record[field.name] = field.rawValue;
  }
  return record;
}

export function runStage1(rawBody: Record<string, unknown>): Stage1Result {
  const warnings = validate(rawBody);
  const classified = cleanAndImpute(classify(rawBody), warnings);
  const normalized = normalize(classified);
  // The "record" downstream stages/consumers see is the imputed/cleaned
  // version (every field has a concrete value), not the possibly-partial
  // raw request body - classicalRuleEngine.ts and blockchainClient.ts read
  // straight off it and must never see `undefined` for an optional field.
  const record = {
    ...classifiedToRecord(classified),
    txId: rawBody.txId,
    institutionId: rawBody.institutionId,
  } as unknown as RawTransactionInput;
  return {
    record,
    classified,
    normalized,
    warnings,
  };
}
