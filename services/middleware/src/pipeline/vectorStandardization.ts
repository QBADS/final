import { randomUUID } from "node:crypto";
import type { NormalizedFeature, QuantumEncodedFeature, QuantumReadyVector } from "../domainTypes";
import { config } from "../config";

/**
 * Stage 2 of Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf: dimensionality
 * reduction (2.1), quantum encoding mapping (2.2), feature vector assembly
 * (2.3). Runs on the output of Stage 1 (featureEngineering.ts).
 */

function encodingFor(feature: NormalizedFeature): QuantumEncodedFeature["encoding"] {
  switch (feature.type) {
    case "continuous":
    case "timestamp":
      return "angle";
    case "binary":
    case "categorical_low":
      return "basis";
    case "categorical_high":
    case "hashed":
      return "amplitude";
    default:
      return "angle";
  }
}

/** Angle/basis cost 1 qubit per value; amplitude compresses n values into ~log2(n) qubits. */
function qubitCost(encoding: QuantumEncodedFeature["encoding"], valueCount: number): number {
  if (encoding === "amplitude") {
    return Math.max(1, Math.ceil(Math.log2(Math.max(valueCount, 1) + 1)));
  }
  return valueCount;
}

function encode(features: NormalizedFeature[]): QuantumEncodedFeature[] {
  return features.map((feature) => {
    const encoding = encodingFor(feature);
    const values = encoding === "angle" ? feature.values.map((v) => v * Math.PI) : feature.values;
    return { ...feature, values, encoding };
  });
}

function totalQubitCost(features: QuantumEncodedFeature[]): number {
  return features.reduce((sum, f) => sum + qubitCost(f.encoding, f.values.length), 0);
}

/**
 * 2.1 Dimensionality reduction. Real PCA needs a covariance matrix fitted on
 * historical data, which doesn't exist yet for a from-scratch service - this
 * is a documented placeholder: multi-value, lower-explainability-priority
 * groups (one-hot categoricals, hashed embeddings, cyclical timestamps) get
 * collapsed to a single averaged component and re-tagged amplitude, rather
 * than dropped. Core risk fields (amount, flags) are never touched, per the
 * doc's note that PCA is applied "selectively... to preserve explainability
 * where regulators require it."
 */
function reduceDimensionality(features: QuantumEncodedFeature[]): { features: QuantumEncodedFeature[]; reduced: boolean } {
  if (totalQubitCost(features) <= config.qubitBudget) {
    return { features, reduced: false };
  }

  const reducible = new Set<QuantumEncodedFeature["encoding"] | string>(["categorical_low", "hashed", "timestamp"]);
  const reduced = features.map((f): QuantumEncodedFeature => {
    if (!reducible.has(f.type) || f.values.length <= 1) return f;
    const avg = f.values.reduce((a, b) => a + b, 0) / f.values.length;
    return { ...f, values: [avg], encoding: "amplitude" };
  });

  return { features: reduced, reduced: true };
}

/**
 * "Vector standardization: Scale - clip - pad/truncate to qubit-safe size"
 * (QBADS_Middleware_Flow_Structure.pdf, Section 2). The Quantum Engine's own
 * base architecture (Quantum_Engine_Base_Architecture.pdf, Section 05, step
 * 1 "Dimension Check") expects a fixed-length vector of length N - its
 * circuits are built once for N qubits, not reconstructed per request - so
 * this is a hard requirement, not a nice-to-have.
 */
function padOrTruncate(values: number[], length: number): number[] {
  if (values.length === length) return values;
  if (values.length > length) return values.slice(0, length);
  return [...values, ...new Array(length - values.length).fill(0)];
}

export function runStage2(recordId: string, normalized: NormalizedFeature[]): QuantumReadyVector {
  const encoded = encode(normalized);
  const { features, reduced } = reduceDimensionality(encoded);
  const finalCost = totalQubitCost(features);

  if (finalCost > config.qubitBudget) {
    console.warn(
      `[vectorStandardization] qubit cost ${finalCost} still exceeds budget ${config.qubitBudget} after dimensionality reduction for record ${recordId}`,
    );
  }

  return {
    recordId: recordId || randomUUID(),
    qubitBudget: config.qubitBudget,
    qubitCost: finalCost,
    dimensionalityReduced: reduced,
    features,
    flat: padOrTruncate(
      features.flatMap((f) => f.values),
      config.qubitBudget,
    ),
  };
}
