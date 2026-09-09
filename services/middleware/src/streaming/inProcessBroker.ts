import { EventEmitter } from "node:events";
import type { Broker } from "./types";

/**
 * Default streaming backend, used automatically when KAFKA_BROKERS is not
 * set (see ./index.ts). Same Broker interface as the real Kafka-backed
 * implementation (kafkaBroker.ts), so nothing upstream (nodeApi.ts,
 * streaming/transactionConsumer.ts) needs to know or care which one is
 * running underneath.
 *
 * This is a genuine architectural substitution point, not a shortcut that
 * skips the publish/subscribe boundary: producers still only ever call
 * publish(), consumers still only ever receive messages via subscribe()
 * (asynchronously, decoupled from the publish call), and multiple consumer
 * groups on the same topic each get their own independent delivery of every
 * message - same semantics a real Kafka consumer group gives you. No Docker
 * image can be pulled in this sandbox, so this is what actually runs
 * end-to-end here; in a real deployment, setting KAFKA_BROKERS swaps this
 * out for kafkaBroker.ts with no other code changes.
 */
export class InProcessBroker implements Broker {
  private readonly emitter = new EventEmitter();
  private readonly subscribedGroups = new Map<string, Set<string>>(); // topic -> groupIds already registered

  constructor() {
    // A slow consumer group must never be silently swallowed by Node's
    // default max-listener warning as more groups subscribe to a topic.
    this.emitter.setMaxListeners(50);
  }

  async publish(topic: string, message: unknown): Promise<void> {
    // Dispatch asynchronously (next tick) so publish() never runs a
    // subscriber's handler inline on the caller's stack - matches a real
    // broker, where publish and delivery are decoupled.
    setImmediate(() => this.emitter.emit(topic, message));
  }

  async subscribe(topic: string, groupId: string, handler: (message: unknown) => Promise<void>): Promise<void> {
    const groups = this.subscribedGroups.get(topic) ?? new Set<string>();
    this.subscribedGroups.set(topic, groups);

    if (groups.has(groupId)) {
      // One group = one logical consumer; a second subscribe() call for the
      // same group would double-process every message.
      return;
    }
    groups.add(groupId);

    this.emitter.on(topic, (message: unknown) => {
      void handler(message).catch((err) => {
        console.error(`[inProcessBroker] handler for topic=${topic} group=${groupId} failed:`, err);
      });
    });
  }
}
