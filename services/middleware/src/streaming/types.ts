/**
 * Streaming platform abstraction - the "Institution APIs -> API gateway ->
 * Streaming platform (Kafka real-time ingestion) -> Validation & cleaning ->
 * Feature engineering" stage of the system architecture doc. Two
 * implementations share this interface: kafkaBroker.ts (real kafkajs,
 * used when KAFKA_BROKERS is set) and inProcessBroker.ts (in-memory
 * fallback, used otherwise - see its own doc comment for why that's a
 * legitimate substitution here, not a shortcut).
 */
export interface Broker {
  publish(topic: string, message: unknown): Promise<void>;
  /**
   * Registers `handler` to receive every message published to `topic`
   * under consumer group `groupId`. Multiple groups on the same topic each
   * get their own independent copy of every message (standard Kafka
   * consumer-group semantics); calling subscribe again with the same
   * (topic, groupId) is a no-op, matching "one group = one logical
   * consumer".
   */
  subscribe(topic: string, groupId: string, handler: (message: unknown) => Promise<void>): Promise<void>;
}

export const TOPICS = {
  TRANSACTIONS_RAW: "qbads.transactions.raw",
} as const;
