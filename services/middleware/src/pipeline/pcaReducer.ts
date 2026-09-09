import { fitPCA, projectPCA, type PCAModel } from "./pca";

/**
 * Stage 2.1 dimensionality reduction state: a rolling in-memory sample
 * buffer of recent Stage 1-normalized "reducible" feature vectors (see
 * vectorStandardization.ts for what's in that group), and the real PCA
 * model periodically refit from it.
 *
 * Per the doc, PCA is applied *selectively* - vectorStandardization.ts only
 * ever routes the non-core (categorical/hashed/timestamp) group through
 * this reducer; the explainability-critical core fields (amount and the
 * key risk flags) are never touched here.
 *
 * Cold start: a covariance matrix/eigen-decomposition is meaningless (and
 * numerically unstable) with too few samples, so until MIN_SAMPLES_FOR_PCA
 * vectors have been observed, `reduce()` falls through to a simple,
 * documented placeholder (chunked averaging - every input value still
 * contributes to some output component, nothing is dropped) so the system
 * works end to end from the very first transaction.
 */
const MAX_SAMPLES = 400;
const MIN_SAMPLES_FOR_PCA = 30;
const REFIT_INTERVAL = 20; // refit the PCA basis every N new samples, not per-request

let sampleBuffer: number[][] = [];
let cachedModel: PCAModel | null = null;
let cachedComponentCount = 0;
let samplesSinceRefit = 0;
let lastFitAt: string | null = null;

function chunkAverageFallback(vector: number[], componentCount: number): number[] {
  const k = Math.max(1, Math.min(componentCount, vector.length));
  const chunkSize = Math.ceil(vector.length / k);
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const chunk = vector.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) {
      out.push(0);
      continue;
    }
    out.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
  }
  return out;
}

/**
 * Records a new observation and returns its reduced representation.
 * `componentCount` is the number of principal components the caller wants
 * (derived from the remaining qubit budget after core fields and the
 * amplitude-encoding cost formula - see vectorStandardization.ts).
 */
export function reduceWithPCA(vector: number[], componentCount: number): { values: number[]; usedRealPCA: boolean } {
  sampleBuffer.push(vector);
  if (sampleBuffer.length > MAX_SAMPLES) sampleBuffer.shift();
  samplesSinceRefit += 1;

  const haveEnoughSamples = sampleBuffer.length >= MIN_SAMPLES_FOR_PCA;
  const needsRefit =
    haveEnoughSamples && (!cachedModel || cachedComponentCount !== componentCount || samplesSinceRefit >= REFIT_INTERVAL);

  if (needsRefit) {
    cachedModel = fitPCA(sampleBuffer, componentCount);
    cachedComponentCount = componentCount;
    samplesSinceRefit = 0;
    lastFitAt = new Date().toISOString();
  }

  if (cachedModel && haveEnoughSamples) {
    return { values: projectPCA(cachedModel, vector), usedRealPCA: true };
  }

  // Cold-start fallback, documented above.
  return { values: chunkAverageFallback(vector, componentCount), usedRealPCA: false };
}

/** Debug/observability snapshot - backs GET /api/dashboard/pca-status. */
export function pcaStatus() {
  return {
    sampleCount: sampleBuffer.length,
    minSamplesForRealPca: MIN_SAMPLES_FOR_PCA,
    maxSamples: MAX_SAMPLES,
    usingRealPca: sampleBuffer.length >= MIN_SAMPLES_FOR_PCA,
    componentCount: cachedComponentCount,
    lastFitAt,
    explainedVariance: cachedModel?.explainedVariance ?? [],
    inputDimension: cachedModel?.dim ?? (sampleBuffer[0]?.length ?? 0),
  };
}

/** Test-only reset so unit-style checks can start from a clean buffer. */
export function _resetPcaStateForTests() {
  sampleBuffer = [];
  cachedModel = null;
  cachedComponentCount = 0;
  samplesSinceRefit = 0;
  lastFitAt = null;
}
