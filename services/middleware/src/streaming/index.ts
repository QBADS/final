import type { Broker } from "./types";
import { InProcessBroker } from "./inProcessBroker";
import { KafkaBroker } from "./kafkaBroker";
import { config } from "../config";

export { TOPICS } from "./types";
export type { Broker } from "./types";

/**
 * System architecture doc's ingestion path: "Institution APIs -> API
 * gateway -> Streaming platform (Kafka real-time ingestion) -> Validation &
 * cleaning -> Feature engineering." KAFKA_BROKERS set -> real kafkajs
 * backend (production path); unset -> the in-process fallback (this
 * sandbox has no way to pull a Kafka Docker image, and more generally this
 * is a legitimate substitution point sharing the exact same Broker
 * interface, not a workaround). Everything downstream (nodeApi.ts,
 * streaming/transactionConsumer.ts) only ever talks to `broker`, never to
 * either concrete class, so switching backends is a config change, not a
 * code change.
 */
export const broker: Broker = config.kafkaBrokers.length > 0 ? new KafkaBroker(config.kafkaBrokers) : new InProcessBroker();

console.log(
  config.kafkaBrokers.length > 0
    ? `[streaming] using KafkaBroker brokers=${config.kafkaBrokers.join(",")}`
    : "[streaming] KAFKA_BROKERS not set - using in-process fallback broker",
);
