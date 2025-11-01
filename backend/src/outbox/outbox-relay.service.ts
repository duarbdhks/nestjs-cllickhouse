import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly batchSize: number;
  private isProcessing = false;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly configService: ConfigService,
  ) {
    this.batchSize = this.configService.get<number>('OUTBOX_BATCH_SIZE', 100);
  }

  /**
   * Cron job that runs every 5 seconds
   * Polls outbox table and relays events to Kafka
   */
  @Cron('*/5 * * * * *')
  async relayEvents() {
    // Prevent concurrent execution
    if (this.isProcessing) {
      this.logger.log('Previous relay is still processing, skipping this cycle');
      return;
    }

    this.isProcessing = true;

    try {
      // 1. Find unprocessed events
      const events = await this.outboxService.findUnprocessedEvents(this.batchSize);

      if (events.length === 0) {
        // this.logger.log('No unprocessed events found');
        return;
      }

      this.logger.log(`Processing ${events.length} outbox events`);

      // 2. Publish each event to Kafka
      const successfulEventIds: number[] = [];

      for (const event of events) {
        try {
          const topic = `${event.aggregateType.toLowerCase()}.events`;
          // Include eventType in the payload for consumers
          const enrichedPayload = {
            eventType: event.eventType,
            ...event.payload,
          };
          await this.kafkaProducer.send(topic, event.aggregateId, enrichedPayload);
          successfulEventIds.push(Number(event.id));
          this.logger.log(`Event relayed: ${event.eventType} for ${event.aggregateType}:${event.aggregateId}`);
        } catch (error) {
          this.logger.error(`Failed to relay event ${event.id}: ${event.eventType}`, error);
          // Continue with other events even if one fails
        }
      }

      // 3. Mark successfully relayed events as processed
      if (successfulEventIds.length > 0) {
        await this.outboxService.markManyAsProcessed(successfulEventIds);
        this.logger.log(`Marked ${successfulEventIds.length} events as processed`);
      }

      // Log failure rate if any
      const failedCount = events.length - successfulEventIds.length;
      if (failedCount > 0) {
        this.logger.warn(`${failedCount} events failed to relay`);
      }
    } catch (error) {
      this.logger.error('Outbox relay cycle failed', error);
    } finally {
      this.isProcessing = false;
    }
  }
}
