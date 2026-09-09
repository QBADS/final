/**
 * Offline trainer for the classical ML fraud-scoring component
 * (../classicalMlModel.ts). Generates a synthetic labeled dataset with
 * realistic fraud/legit patterns tied to a handful of the 30 schema fields,
 * runs every synthetic record through the REAL Stage 1 feature engineering
 * (../featureEngineering.ts) so the model is trained on exactly the feature
 * representation it will see at inference time, fits a logistic regression
 * by hand-rolled batch gradient descent (no ML dependency), and writes the
 * resulting weights/bias/feature order/normalization stats to
 * ../classicalModelWeights.json.
 *
 * Run with:
 *   cd services/middleware && npx tsx src/pipeline/scripts/trainClassicalModel.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { runStage1 } from "../featureEngineering";
import { flattenNormalizedFeatures } from "../classicalFeatureVector";
import type { RawTransactionInput } from "../../domainTypes";

// ---- Deterministic PRNG (mulberry32) so training is reproducible ----
function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function uniform(min: number, max: number): number {
  return min + rand() * (max - min);
}
function bernoulli(p: number): boolean {
  return rand() < p;
}

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD"];
const CHANNELS: RawTransactionInput["paymentChannel"][] = ["card", "bank_transfer", "wallet", "crypto"];
const DEVICE_TYPES: RawTransactionInput["deviceType"][] = ["mobile", "desktop", "tablet"];
const LOGIN_METHODS: RawTransactionInput["loginMethod"][] = ["password", "biometric", "otp", "sso"];
const MERCHANT_CATEGORIES = ["groceries", "electronics", "travel", "gambling", "crypto_exchange", "utilities", "luxury_goods", "software"];
const COUNTRIES = ["US", "GB", "DE", "FR", "NG", "RU", "CN", "BR", "IN", "CA"];
const HIGH_RISK_CATEGORIES = new Set(["gambling", "crypto_exchange", "luxury_goods"]);

/**
 * Generates one synthetic raw transaction plus its "true" fraud probability.
 * The probability is a hidden logistic function of a handful of raw fields
 * (amount, cross-border, new device, MFA, auth failures, device trust,
 * merchant risk, chargebacks, account age, velocity) - i.e. the same kind of
 * signal a real fraud-labeling process would be tied to. The label is then
 * sampled from that probability (with noise), not derived from the flattened
 * feature vector itself, so the classifier has to actually learn the
 * relationship rather than trivially recover a hand-coded formula.
 */
function generateRecord(): { raw: Record<string, unknown>; trueProb: number } {
  const isHighRiskCategory = bernoulli(0.25);
  const merchantCategory = isHighRiskCategory ? pick([...HIGH_RISK_CATEGORIES]) : pick(MERCHANT_CATEGORIES.filter((c) => !HIGH_RISK_CATEGORIES.has(c)));
  const amount = bernoulli(0.15) ? uniform(5_000, 49_000) : uniform(5, 3_000);
  const crossBorderFlag = bernoulli(0.2);
  const newDeviceFlag = bernoulli(0.18);
  const mfaUsed = bernoulli(0.7);
  const accountAgeDays = bernoulli(0.15) ? uniform(0, 6) : uniform(7, 3000);
  const authFailureCount24h = bernoulli(0.12) ? uniform(3, 15) : uniform(0, 2);
  const deviceTrustScore = newDeviceFlag ? uniform(0, 40) : uniform(40, 100);
  const merchantRiskScore = isHighRiskCategory ? uniform(40, 100) : uniform(0, 40);
  const chargebackHistory = bernoulli(0.1) ? uniform(1, 8) : 0;
  const biometricMatchScore = uniform(50, 100);
  const vpnOrProxyFlag = bernoulli(0.15);
  const transactionVelocity1h = bernoulli(0.1) ? uniform(6, 30) : uniform(0, 5);
  const distanceFromHomeKm = crossBorderFlag ? uniform(500, 15000) : uniform(0, 300);
  const cardPresentFlag = bernoulli(0.4);
  const avgTransactionAmount30d = uniform(20, 2000);
  const daysSinceLastTransaction = uniform(0, 60);
  const sessionDurationSec = uniform(10, 900);
  const passwordAgeDays = uniform(0, 900);

  // Hidden logistic generator: weighted sum of standardized-ish raw signals,
  // squashed through a sigmoid to a 0-1 probability.
  const z =
    -3.2 +
    2.6 * (amount > 5000 ? 1 : 0) +
    1.4 * (crossBorderFlag ? 1 : 0) +
    1.6 * (newDeviceFlag ? 1 : 0) +
    1.1 * (mfaUsed ? 0 : 1) +
    1.3 * Math.min(authFailureCount24h / 5, 2) +
    1.2 * (1 - deviceTrustScore / 100) +
    1.5 * (merchantRiskScore / 100) +
    1.3 * (chargebackHistory > 0 ? 1 : 0) +
    0.9 * (vpnOrProxyFlag ? 1 : 0) +
    0.7 * (accountAgeDays < 7 ? 1 : 0) +
    0.6 * Math.min(transactionVelocity1h / 10, 2) +
    0.4 * (distanceFromHomeKm > 3000 ? 1 : 0);

  const trueProb = 1 / (1 + Math.exp(-z));

  const raw: Record<string, unknown> = {
    institutionId: "synthetic",
    amount,
    currency: pick(CURRENCIES),
    paymentChannel: pick(CHANNELS),
    merchantCategory,
    submittedAt: new Date(Date.now() - Math.floor(uniform(0, 1e10))).toISOString(),
    accountAgeDays,
    sessionDurationSec,
    avgTransactionAmount30d,
    transactionVelocity1h,
    daysSinceLastTransaction,
    deviceType: pick(DEVICE_TYPES),
    newDeviceFlag,
    deviceId: `dev_${Math.floor(rand() * 1e9)}`,
    browserFingerprint: `fp_${Math.floor(rand() * 1e9)}`,
    deviceTrustScore,
    ipAddress: `ip_${Math.floor(rand() * 1e9)}`,
    crossBorderFlag,
    country: pick(COUNTRIES),
    distanceFromHomeKm,
    vpnOrProxyFlag,
    loginMethod: pick(LOGIN_METHODS),
    mfaUsed,
    authFailureCount24h,
    passwordAgeDays,
    biometricMatchScore,
    merchantId: `merch_${Math.floor(rand() * 1e6)}`,
    merchantRiskScore,
    chargebackHistory,
    isHighRiskMerchantCategory: isHighRiskCategory,
    cardPresentFlag,
  };

  return { raw, trueProb };
}

// ---- Build dataset ----
const N = 4000;
const X: number[][] = [];
const Y: number[] = [];
let featureNames: string[] = [];

for (let i = 0; i < N; i++) {
  const { raw, trueProb } = generateRecord();
  const stage1 = runStage1(raw);
  const flat = flattenNormalizedFeatures(stage1.normalized);
  featureNames = flat.featureNames;
  X.push(flat.values);
  Y.push(bernoulli(trueProb) ? 1 : 0);
}

// ---- Train/holdout split (80/20), shuffled deterministically ----
const indices = [...Array(N).keys()];
for (let i = indices.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [indices[i], indices[j]] = [indices[j], indices[i]];
}
const splitAt = Math.floor(N * 0.8);
const trainIdx = indices.slice(0, splitAt);
const holdoutIdx = indices.slice(splitAt);

const Xtrain = trainIdx.map((i) => X[i]);
const Ytrain = trainIdx.map((i) => Y[i]);
const Xholdout = holdoutIdx.map((i) => X[i]);
const Yholdout = holdoutIdx.map((i) => Y[i]);

// ---- Standardize (fit on train only) ----
const d = Xtrain[0].length;
const mean = new Array(d).fill(0);
const std = new Array(d).fill(0);
for (const row of Xtrain) {
  for (let j = 0; j < d; j++) mean[j] += row[j];
}
for (let j = 0; j < d; j++) mean[j] /= Xtrain.length;
for (const row of Xtrain) {
  for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2;
}
for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / Xtrain.length) || 1;

function standardize(row: number[]): number[] {
  return row.map((v, j) => (v - mean[j]) / std[j]);
}

const XtrainStd = Xtrain.map(standardize);
const XholdoutStd = Xholdout.map(standardize);

// ---- Logistic regression via batch gradient descent ----
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function trainLogisticRegression(
  X: number[][],
  y: number[],
  opts: { epochs: number; lr: number; l2: number },
): { weights: number[]; bias: number; losses: number[] } {
  const n = X.length;
  const dim = X[0].length;
  const weights = new Array(dim).fill(0);
  let bias = 0;
  const losses: number[] = [];

  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    const gradW = new Array(dim).fill(0);
    let gradB = 0;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      const row = X[i];
      for (let j = 0; j < dim; j++) z += weights[j] * row[j];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < dim; j++) gradW[j] += err * row[j];
      gradB += err;
      const eps = 1e-12;
      loss += -(y[i] * Math.log(p + eps) + (1 - y[i]) * Math.log(1 - p + eps));
    }
    for (let j = 0; j < dim; j++) {
      weights[j] -= opts.lr * (gradW[j] / n + opts.l2 * weights[j]);
    }
    bias -= opts.lr * (gradB / n);

    loss = loss / n + (opts.l2 / 2) * weights.reduce((s, w) => s + w * w, 0);
    losses.push(loss);
  }

  return { weights, bias, losses };
}

const EPOCHS = 400;
const { weights, bias, losses } = trainLogisticRegression(XtrainStd, Ytrain, { epochs: EPOCHS, lr: 0.5, l2: 0.001 });

function evaluate(X: number[][], y: number[]): { accuracy: number; precision: number; recall: number } {
  let tp = 0,
    tn = 0,
    fp = 0,
    fn = 0;
  for (let i = 0; i < X.length; i++) {
    let z = bias;
    for (let j = 0; j < X[i].length; j++) z += weights[j] * X[i][j];
    const pred = sigmoid(z) >= 0.5 ? 1 : 0;
    if (pred === 1 && y[i] === 1) tp++;
    else if (pred === 0 && y[i] === 0) tn++;
    else if (pred === 1 && y[i] === 0) fp++;
    else fn++;
  }
  const accuracy = (tp + tn) / X.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return { accuracy, precision, recall };
}

const trainMetrics = evaluate(XtrainStd, Ytrain);
const holdoutMetrics = evaluate(XholdoutStd, Yholdout);

console.log(`Training records: ${Xtrain.length}, holdout: ${Xholdout.length}, features: ${d}`);
console.log(`Positive rate - train: ${(Ytrain.reduce((a, b) => a + b, 0) / Ytrain.length).toFixed(3)}, holdout: ${(Yholdout.reduce((a, b) => a + b, 0) / Yholdout.length).toFixed(3)}`);
console.log(`Loss: epoch 0 = ${losses[0].toFixed(4)}, epoch ${EPOCHS - 1} = ${losses[EPOCHS - 1].toFixed(4)}`);
console.log(`Train  - accuracy: ${trainMetrics.accuracy.toFixed(4)}, precision: ${trainMetrics.precision.toFixed(4)}, recall: ${trainMetrics.recall.toFixed(4)}`);
console.log(`Holdout- accuracy: ${holdoutMetrics.accuracy.toFixed(4)}, precision: ${holdoutMetrics.precision.toFixed(4)}, recall: ${holdoutMetrics.recall.toFixed(4)}`);

const output = {
  trainedAt: new Date().toISOString(),
  algorithm: "logistic_regression_gradient_descent",
  featureNames,
  mean,
  std,
  weights,
  bias,
  hyperparameters: { epochs: EPOCHS, learningRate: 0.5, l2: 0.001 },
  datasetSize: N,
  trainSize: Xtrain.length,
  holdoutSize: Xholdout.length,
  finalTrainLoss: losses[EPOCHS - 1],
  trainAccuracy: trainMetrics.accuracy,
  trainPrecision: trainMetrics.precision,
  trainRecall: trainMetrics.recall,
  holdoutAccuracy: holdoutMetrics.accuracy,
  holdoutPrecision: holdoutMetrics.precision,
  holdoutRecall: holdoutMetrics.recall,
};

const outPath = path.join(__dirname, "..", "classicalModelWeights.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Wrote weights to ${outPath}`);
