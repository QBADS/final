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
 *
 * Per the doc's 2.1: "If total qubit cost still exceeds budget after
 * assignment, excess features route back through dimensionality reduction."
 * A single per-field collapse pass isn't always enough (e.g. the default
 * 13-field schema still costs 13 qubits against an 8-qubit budget after pass
 * one) - previously that residual overflow was left for padOrTruncate below
 * to silently truncate, which dropped whole low-index-order features
 * (mfaUsed, deviceId, ipAddress, newDeviceFlag, submittedAt) from the vector
 * actually sent to the quantum engine. Instead, route the excess back
 * through a second reduction pass: merge the remaining low-priority,
 * already-collapsed features into one shared amplitude component. Core risk
 * fields (continuous numerics, binary flags, merchantCategory) are still
 * never touched.
 */
function reduceDimensionality(features: QuantumEncodedFeature[]): { features: QuantumEncodedFeature[]; reduced: boolean } {
  if (totalQubitCost(features) <= config.qubitBudget) {
    return { features, reduced: false };
  }

  const reducibleTypes = new Set<string>(["categorical_low", "hashed", "timestamp"]);

  // Pass 1: collapse each multi-value low-priority field to a single
  // averaged component.
  let current = features.map((f): QuantumEncodedFeature => {
    if (!reducibleTypes.has(f.type) || f.values.length <= 1) return f;
    const avg = f.values.reduce((a, b) => a + b, 0) / f.values.length;
    return { ...f, values: [avg], encoding: "amplitude" };
  });

  // Pass 2 (route-back): if still over budget, merge the now-single-value
  // low-priority fields into one shared amplitude feature instead of
  // letting padOrTruncate below cut whole features off the end of the
  // vector.
  if (totalQubitCost(current) > config.qubitBudget) {
    const mergeable = current.filter((f) => reducibleTypes.has(f.type));
    const kept = current.filter((f) => !reducibleTypes.has(f.type));
    if (mergeable.length > 1) {
      const merged: QuantumEncodedFeature = {
        name: "reduced_group",
        type: "categorical_high",
        values: [mergeable.reduce((sum, f) => sum + (f.values[0] ?? 0), 0) / mergeable.length],
        encoding: "amplitude",
      };
      current = [...kept, merged];
    }
  }

  return { features: current, reduced: true };
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
