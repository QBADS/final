import type { NormalizedFeature } from "../domainTypes";
import { flattenNormalizedFeatures } from "./classicalFeatureVector";
// Imported as a JSON module (tsconfig's resolveJsonModule) rather than read
// from disk at runtime, so `npm run build` copies it into dist/ alongside
// the compiled JS automatically and there's no path-resolution surprise
// between `npm run dev` (tsx, runs from src/) and `npm start` (node, runs
// from dist/).
import rawModelWeights from "./classicalModelWeights.json";

/**
 * The classical ML fraud-scoring component the architecture spec's ensemble
 * calls for: a genuine gradient-boosting/DNN-family classical model
 * alongside the quantum score - here, logistic regression, chosen for being
 * honest, fast, explainable, and needing no new heavy ML dependency. This is
 * NOT classicalRuleEngine.ts (the deterministic outage fallback): this
 * component only ever runs on the quantum-success path, as one input to
 * ensembleEngine.ts's blended score.
 *
 * Coefficients are real, trained weights - not hand-picked - produced by
 * scripts/trainClassicalModel.ts (synthetic labeled dataset -> hand-rolled
 * gradient descent) and checked in as classicalModelWeights.json. See that
 * script's console output / this repo's PR description for the observed
 * train/holdout accuracy and recall.
 */
export interface ClassicalModelWeights {
  trainedAt: string;
  algorithm: string;
  featureNames: string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
  hyperparameters: { epochs: number; learningRate: number; l2: number };
  datasetSize: number;
  trainSize: number;
  holdoutSize: number;
  finalTrainLoss: number;
  trainAccuracy: number;
  trainPrecision: number;
  trainRecall: number;
  holdoutAccuracy: number;
  holdoutPrecision: number;
  holdoutRecall: number;
}

export interface ClassicalScoreResult {
  /** 0-100, same scale as the quantum engine's anomalyScore and the classical rule engine's riskScore. */
  score: number;
  /** 0-1 raw sigmoid probability, before the *100 scaling above. */
  probability: number;
  /** 0-1 - how far the probability sits from the decision boundary (0.5), not a statistical confidence interval. */
  confidence: number;
}

// Loaded once at module init ("ships with a set of trained coefficients") -
// scoring a transaction never touches disk or re-parses JSON.
const modelWeights = rawModelWeights as ClassicalModelWeights;

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Scores Stage 1's normalized feature vector (featureEngineering.ts's
 * output - reused as-is, never renormalized here) through the trained
 * logistic regression: standardize with the training-set mean/std, take the
 * weighted sum, squash through a sigmoid.
 */
export function scoreClassical(normalized: NormalizedFeature[]): ClassicalScoreResult {
  const { values, featureNames } = flattenNormalizedFeatures(normalized);

  if (values.length !== modelWeights.weights.length) {
    // Schema drift guard: featureEngineering.ts's FIELD_CONFIG changed shape
    // since the model was trained (a field added/removed). Never throw here
    // - this component sits on the quantum-success path, not the outage
    // fallback, so a hard failure would take down transactions that would
    // otherwise process fine. Fall back to a neutral, low-confidence score
    // instead and let the caller weight it down accordingly.
    console.warn(
      `[classicalMlModel] feature vector length ${values.length} does not match trained model's ${modelWeights.weights.length} (schema drift since training) - returning a neutral score`,
    );
    return { score: 50, probability: 0.5, confidence: 0.3 };
  }

  let z = modelWeights.bias;
  for (let i = 0; i < modelWeights.weights.length; i++) {
    const std = modelWeights.std[i] || 1;
    const standardized = (values[i] - modelWeights.mean[i]) / std;
    z += modelWeights.weights[i] * standardized;
  }

  const probability = sigmoid(z);
  const score = Math.min(100, Math.max(0, probability * 100));
  // Distance from the 0.5 decision boundary, scaled to [0.5, 0.98] - a
  // prediction near 0 or 1 is one the model is confident about, one near 0.5
  // is one it's essentially guessing on.
  const confidence = Math.min(0.98, 0.5 + Math.abs(probability - 0.5) * 0.96);

  void featureNames; // kept on the result type for future debugging/telemetry, unused here
  return { score, probability, confidence };
}

export function classicalModelInfo() {
  return {
    trainedAt: modelWeights.trainedAt,
    algorithm: modelWeights.algorithm,
    featureCount: modelWeights.weights.length,
    trainAccuracy: modelWeights.trainAccuracy,
    trainRecall: modelWeights.trainRecall,
    holdoutAccuracy: modelWeights.holdoutAccuracy,
    holdoutRecall: modelWeights.holdoutRecall,
  };
}
