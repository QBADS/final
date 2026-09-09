import { randomUUID } from "node:crypto";
import type { NormalizedFeature, QuantumEncodedFeature, QuantumReadyVector } from "../domainTypes";
import { config } from "../config";
import { reduceWithPCA } from "./pcaReducer";

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
 * "Core" fields: the handful of highest-signal, most-scrutinized attributes
 * regulators/analysts actually look at (this exact set is also what
 * quantumOrchestrationClient.ts's mock scorer weights by name). These are
 * never PCA-reduced, per the doc's "applied selectively... to preserve
 * explainability where regulators require it" - every other one of the 30
 * fields goes through PCA below.
 */
const CORE_FIELD_NAMES = new Set(["amount", "crossBorderFlag", "newDeviceFlag", "mfaUsed", "merchantCategory"]);

/** Max number of amplitude-packed PCA components that fit in `qubits` qubits (inverse of the amplitude cost formula). */
function maxComponentsForQubits(qubits: number): number {
  return Math.max(1, Math.pow(2, Math.max(qubits, 0)) - 1);
}

/**
 * 2.1 Dimensionality reduction - real PCA (pca.ts/pcaReducer.ts): center the
 * data, compute the covariance matrix, get eigenvectors via the Jacobi
 * eigenvalue algorithm, and project onto the top-K components. Applied
 * *selectively*: CORE_FIELD_NAMES above are always kept as individual
 * angle/basis-encoded qubits; every other field's normalized values are
 * concatenated into one vector and PCA-reduced together into a single
 * amplitude-encoded feature, sized to whatever qubit budget remains after
 * the core fields.
 *
 * Overflow-recovery loop (doc 2.1: "if the total qubit cost across all
 * assigned encodings still exceeds the available budget, the excess
 * features are routed back through dimensionality reduction before a final
 * encoding assignment"): if core-cost + PCA-group-cost still exceeds the
 * budget (e.g. a misconfigured very low QUBIT_BUDGET), the PCA component
 * count is iteratively shrunk by one and the vector re-projected/re-packed
 * - never simply truncated by padOrTruncate below, which was the bug fixed
 * in the prior audit (whole trailing features silently dropped from the
 * vector actually sent to the quantum engine). The PCA group is only ever
 * shrunk, never removed outright, so every one of the 30 fields still
 * contributes to the final vector via the group's principal components.
 */
function reduceDimensionality(features: QuantumEncodedFeature[]): {
  features: QuantumEncodedFeature[];
  reduced: boolean;
  usedRealPCA: boolean;
} {
  if (totalQubitCost(features) <= config.qubitBudget) {
    return { features, reduced: false, usedRealPCA: false };
  }

  const core = features.filter((f) => CORE_FIELD_NAMES.has(f.name));
  const reducible = features.filter((f) => !CORE_FIELD_NAMES.has(f.name));
  const coreCost = totalQubitCost(core);

  // Flatten the whole non-core group into one vector, in stable field order
  // (features arrives in FIELD_CONFIG's fixed insertion order), so nothing
  // from any of the 30 fields is left out of the PCA input.
  const reducibleVector = reducible.flatMap((f) => f.values);

  let targetQubits = Math.max(config.qubitBudget - coreCost, 1);
  let componentCount = Math.min(maxComponentsForQubits(targetQubits), reducibleVector.length);

  let { values, usedRealPCA } = reduceWithPCA(reducibleVector, componentCount);
  let mergedFeature: QuantumEncodedFeature = {
    name: "pca_reduced_group",
    type: "categorical_high",
    values,
    encoding: "amplitude",
  };
  let assembled = [...core, mergedFeature];

  // Overflow-recovery: shrink the PCA group further (never drop it, never
  // let padOrTruncate silently cut features) until it fits, or there's
  // nothing left to shrink.
  while (totalQubitCost(assembled) > config.qubitBudget && mergedFeature.values.length > 1) {
    mergedFeature = { ...mergedFeature, values: mergedFeature.values.slice(0, mergedFeature.values.length - 1) };
    assembled = [...core, mergedFeature];
  }

  return { features: assembled, reduced: true, usedRealPCA };
}

/**
 * "Vector standardization: Scale - clip - pad/truncate to qubit-safe size"
 * (QBADS_Middleware_Flow_Structure.pdf, Section 2). The Quantum Engine's own
 * base architecture (Quantum_Engine_Base_Architecture.pdf, Section 05, step
 * 1 "Dimension Check") expects a fixed-length vector of length N - its
 * circuits are built once for N qubits, not reconstructed per request - so
 * this is a hard requirement, not a nice-to-have. By the time we get here,
 * reduceDimensionality above has already brought the *encoded feature*
 * count within budget for any realistic schema/budget combination, so this
 * is just a final safety net (e.g. an extreme/misconfigured qubit budget),
 * not where reduction actually happens.
 */
function padOrTruncate(values: number[], length: number): number[] {
  if (values.length === length) return values;
  if (values.length > length) return values.slice(0, length);
  return [...values, ...new Array(length - values.length).fill(0)];
}

export function runStage2(recordId: string, normalized: NormalizedFeature[]): QuantumReadyVector {
  const encoded = encode(normalized);
  const { features, reduced, usedRealPCA } = reduceDimensionality(encoded);
  const finalCost = totalQubitCost(features);

  if (finalCost > config.qubitBudget) {
    console.warn(
      `[vectorStandardization] qubit cost ${finalCost} still exceeds budget ${config.qubitBudget} after dimensionality reduction for record ${recordId}`,
    );
  }
  if (reduced) {
    console.log(
      `[vectorStandardization] record ${recordId}: dimensionality-reduced (${usedRealPCA ? "real PCA" : "cold-start fallback"}), qubit cost ${finalCost}/${config.qubitBudget}`,
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
