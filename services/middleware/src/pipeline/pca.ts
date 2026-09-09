/**
 * Self-contained PCA for Stage 2.1 (Quantum_Ready_Feature_Pipeline_Stage1_Stage2.pdf).
 * No numpy in TS, and no new heavy dependency was wanted for this, so this
 * is a small from-scratch implementation: mean-center -> covariance matrix
 * -> symmetric eigen-decomposition via the classic Jacobi eigenvalue
 * algorithm -> project onto the top-K eigenvectors by eigenvalue.
 *
 * Used by pcaReducer.ts, which owns the rolling sample buffer and decides
 * when there's enough data to fit a real model vs. falling back to a
 * cold-start placeholder.
 */

export interface PCAModel {
  mean: number[];
  /** componentCount x dim, each row a unit eigenvector, sorted by descending eigenvalue. */
  components: number[][];
  /** Eigenvalues corresponding to `components`, descending. */
  explainedVariance: number[];
  dim: number;
}

/** Mean of each column across a set of equal-length row vectors. */
export function columnMeans(samples: number[][]): number[] {
  const dim = samples[0]?.length ?? 0;
  const means = new Array(dim).fill(0);
  for (const row of samples) {
    for (let j = 0; j < dim; j++) means[j] += row[j];
  }
  return means.map((sum) => sum / Math.max(samples.length, 1));
}

/** Population covariance matrix (dim x dim) of a set of mean-centered row vectors. */
export function covarianceMatrix(centered: number[][], dim: number): number[][] {
  const n = Math.max(centered.length - 1, 1); // sample covariance (n-1)
  const cov = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (const row of centered) {
    for (let i = 0; i < dim; i++) {
      const ri = row[i];
      if (ri === 0) continue;
      for (let j = i; j < dim; j++) {
        cov[i][j] += ri * row[j];
      }
    }
  }
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      cov[i][j] /= n;
      cov[j][i] = cov[i][j];
    }
  }
  return cov;
}

/**
 * Classic cyclic Jacobi eigenvalue algorithm for a real symmetric matrix.
 * Repeatedly zeroes the largest off-diagonal pair via a Givens rotation
 * until the matrix is (numerically) diagonal. Returns eigenvalues and their
 * corresponding eigenvectors (columns of the accumulated rotation matrix),
 * unsorted.
 */
export function jacobiEigenDecomposition(
  matrix: number[][],
  maxSweeps = 100,
  tolerance = 1e-9,
): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  // v accumulates the rotations; v's columns become the eigenvectors.
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  const offDiagonalSum = (m: number[][]) => {
    let sum = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) sum += m[i][j] * m[i][j];
    return sum;
  };

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    if (offDiagonalSum(a) < tolerance) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-14) continue;

        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        const app = a[p][p];
        const aqq = a[q][q];
        const apq = a[p][q];

        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][q] = 0;
        a[q][p] = 0;

        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue;
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip - s * aiq;
          a[p][i] = a[i][p];
          a[i][q] = s * aip + c * aiq;
          a[q][i] = a[i][q];
        }

        for (let i = 0; i < n; i++) {
          const vip = v[i][p];
          const viq = v[i][q];
          v[i][p] = c * vip - s * viq;
          v[i][q] = s * vip + c * viq;
        }
      }
    }
  }

  const eigenvalues = Array.from({ length: n }, (_, i) => a[i][i]);
  const eigenvectors = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => v[j][i])); // rows = eigenvectors
  return { eigenvalues, eigenvectors };
}

/** Fits a PCA model (mean + top-K components by eigenvalue) from a set of equal-length sample vectors. */
export function fitPCA(samples: number[][], numComponents: number): PCAModel {
  const dim = samples[0]?.length ?? 0;
  const mean = columnMeans(samples);
  const centered = samples.map((row) => row.map((v, j) => v - mean[j]));
  const cov = covarianceMatrix(centered, dim);
  const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(cov);

  const order = eigenvalues
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(1, Math.min(numComponents, dim)));

  return {
    mean,
    dim,
    components: order.map(({ index }) => eigenvectors[index]),
    explainedVariance: order.map(({ value }) => Math.max(0, value)),
  };
}

/** Projects a single vector onto a fitted PCA model's components (dot product against each). */
export function projectPCA(model: PCAModel, vector: number[]): number[] {
  const centered = vector.map((v, j) => v - (model.mean[j] ?? 0));
  return model.components.map((component) => component.reduce((sum, c, j) => sum + c * (centered[j] ?? 0), 0));
}
