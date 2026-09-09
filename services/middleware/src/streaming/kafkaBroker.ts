import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import type { Broker } from "./types";

/**
 * Real streaming backend, used when KAFKA_BROKERS is set (see ./index.ts).
 * Standard kafkajs producer/consumer wiring - one shared producer for
 * publish(), one consumer per consumer group for subscribe().
 */
export class KafkaBroker implements Broker {
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private producerConnect: Promise<void> | null = null;
  private readonly consumers = new Map<string, Consumer>(); // groupId -> Consumer

  constructor(brokers: string[]) {
    this.kafka = new Kafka({ clientId: "qbads-middleware", brokers, logLevel: logLevel.ERROR });
    this.producer = this.kafka.producer();
  }

  private async ensureProducerConnected(): Promise<void> {
    if (!this.producerConnect) this.producerConnect = this.producer.connect();
    await this.producerConnect;
  }

  async publish(topic: string, message: unknown): Promise<void> {
    await this.ensureProducerConnected();
    await this.producer.send({
      topic,
      messages: [{ value: JSON.stringify(message) }],
    });
  }

  async subscribe(topic: string, groupId: string, handler: (message: unknown) => Promise<void>): Promise<void> {
    if (this.consumers.has(groupId)) return; // one group = one logical consumer

    const consumer = this.kafka.consumer({ groupId });
    this.consumers.set(groupId, consumer);
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        try {
          const parsed = JSON.parse(message.value.toString("utf-8"));
          await handler(parsed);
        } catch (err) {
          console.error(`[kafkaBroker] handler for topic=${topic} group=${groupId} failed:`, err);
        }
      },
    });
  }
}
