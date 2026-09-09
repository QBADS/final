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

  // Ensemble weights (pipeline/ensembleEngine.ts): when the quantum engine
  // is reachable, the final risk score blends the quantum model's score
  // with the classical ML model's (pipeline/classicalMlModel.ts - logistic
  // regression) score, ensembleQuantumWeight * quantumScore +
  // ensembleClassicalWeight * classicalScore. Quantum is weighted higher
  // since it's this platform's primary detection signal per the
  // architecture spec ("AI & quantum detection engine"); the classical
  // model is a fast, corroborating second opinion that pulls the score down
  // when it disagrees, not a coequal vote. 0.75/0.25 keeps quantum
  // dominant while still measurably moving the final score whenever the two
  // models disagree - unlike a token 95/5 split, which would make the
  // "ensemble" indistinguishable from a pass-through in practice. Kept
  // independent of, and unrelated to, classicalRuleEngine.ts's fallback
  // decisions or responseInterpretation.ts's own small rule-based
  // calibration blend on the quantum score.
  ensembleQuantumWeight: Number(process.env.ENSEMBLE_QUANTUM_WEIGHT ?? 0.75),
  ensembleClassicalWeight: Number(process.env.ENSEMBLE_CLASSICAL_WEIGHT ?? 0.25),

  // services/blockchain/gateway - not required to be running; writes are
  // best-effort so the pipeline stays responsive per the Middleware doc's
  // "deterministic under failure" principle.
  blockchainGatewayUrl: process.env.BLOCKCHAIN_GATEWAY_URL ?? "http://localhost:4001",
  blockchainWriteEnabled: (process.env.BLOCKCHAIN_WRITE_ENABLED ?? "true") === "true",

  // Streaming platform (system architecture doc: "API gateway -> Streaming
  // platform (Kafka real-time ingestion) -> Validation & cleaning ->
  // Feature engineering"). Comma-separated broker list, e.g.
  // "kafka1:9092,kafka2:9092" - when unset, streaming/index.ts falls back
  // to the in-process broker (same interface) so the system still runs
  // end-to-end with no external Kafka cluster.
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // How long the Node API's HTTP handler waits for the streaming
  // subscriber (streaming/transactionConsumer.ts) to finish processing a
  // published transaction before giving up - covers Stage 1/2 + quantum
  // orchestration's own timeout/retries + decisioning + storage.
  streamingResponseTimeoutMs: Number(process.env.STREAMING_RESPONSE_TIMEOUT_MS ?? 15_000),
};
