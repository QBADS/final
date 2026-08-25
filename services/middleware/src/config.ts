export const config = {
  port: Number(process.env.PORT ?? 4000),

  // Quantum orchestration client (pipeline/quantumOrchestrationClient.ts)
  quantumTimeoutMs: Number(process.env.QUANTUM_TIMEOUT_MS ?? 3000),
  quantumMaxRetries: Number(process.env.QUANTUM_MAX_RETRIES ?? 2),
  // "http" calls the real services/quantum-pipeline engine; "mock" uses an
  // in-process heuristic for local dev without Python/Qiskit running.
  quantumClientMode: (process.env.QUANTUM_CLIENT_MODE ?? "http") as "http" | "mock",
  quantumEngineUrl: process.env.QUANTUM_ENGINE_URL ?? "http://localhost:4002",
  // Fraction of calls the mock quantum client artificially fails/times out,
  // so the classical fallback path is exercisable without real hardware.
  quantumFailureRate: Number(process.env.QUANTUM_FAILURE_RATE ?? 0.05),

  // Stage 2: dimensionality reduction budget (Quantum_Ready_Feature_Pipeline doc,
  // Section 2.1: "typically in the range of 8 to 16 for a practical circuit").
  // Pinned to the low end of that range deliberately: this must match
  // services/quantum-pipeline's FEATURE_DIMENSION exactly (its circuits are
  // built once for a fixed qubit count), and benchmarking showed a real
  // quantum kernel (QSVM) and variational circuits (QNN/VQC) at 16 qubits
  // are too slow for live per-transaction inference on a simulator - 8
  // keeps single-inference latency well under quantumTimeoutMs.
  qubitBudget: Number(process.env.QUBIT_BUDGET ?? 8),

  // Decision engine thresholds (0-100 composite risk score).
  reviewThreshold: Number(process.env.REVIEW_THRESHOLD ?? 40),
  fraudThreshold: Number(process.env.FRAUD_THRESHOLD ?? 75),

  // services/blockchain/gateway - not required to be running; writes are
  // best-effort so the pipeline stays responsive per the Middleware doc's
  // "deterministic under failure" principle.
  blockchainGatewayUrl: process.env.BLOCKCHAIN_GATEWAY_URL ?? "http://localhost:4001",
  blockchainWriteEnabled: (process.env.BLOCKCHAIN_WRITE_ENABLED ?? "true") === "true",
};
