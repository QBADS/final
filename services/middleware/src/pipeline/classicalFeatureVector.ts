import type { NormalizedFeature } from "../domainTypes";

/**
 * Shared flattening logic between classicalMlModel.ts (runtime scoring) and
 * scripts/trainClassicalModel.ts (offline training), so the feature vector
 * the model was trained on is byte-identical in shape/order to the vector it
 * scores at inference time. Deliberately built on top of featureEngineering.ts's
 * Stage 1 output (NormalizedFeature[]) rather than Stage 2's quantum-encoded/
 * PCA-reduced vector - Stage 1's output has a fixed, field-stable shape (one
 * or more values per one of the 30 FIELD_CONFIG fields, always in the same
 * order), whereas Stage 2's vector length/content varies with the qubit
 * budget and the PCA reducer's warm-up state. A classical model needs a
 * stable input contract, so it reuses Stage 1's normalization untouched and
 * never reimplements it.
 */
export interface FlattenedVector {
  values: number[];
  featureNames: string[];
}

export function flattenNormalizedFeatures(normalized: NormalizedFeature[]): FlattenedVector {
  const values: number[] = [];
  const featureNames: string[] = [];
  for (const feature of normalized) {
    feature.values.forEach((v, i) => {
      values.push(v);
      featureNames.push(feature.values.length > 1 ? `${feature.name}[${i}]` : feature.name);
    });
  }
  return { values, featureNames };
}
