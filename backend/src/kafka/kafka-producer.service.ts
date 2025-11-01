import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, ProducerRecord } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private kafka: Kafka;
  private producer: Producer;

  constructor(private readonly configService: ConfigService) {
    const brokers = this.configService.get<string>('KAFKA_BROKERS', 'localhost:19092').split(',');

    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID', 'nestjs-ecommerce'),
      brokers,
      retry: {
        retries: 5,
        initialRetryTime: 300,
        multiplier: 2,
      },
    });

    this.producer = this.kafka.producer();
  }

  async onModuleInit() {
    try {
      await this.producer.connect();
      this.logger.log('Kafka Producer connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect Kafka Producer', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.producer.disconnect();
      this.logger.log('Kafka Producer disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka Producer', error);
    }
  }

  /**
   * Send a single message to Kafka
   */
  async send(topic: string, key: string, value: any): Promise<void> {
    try {
      const message = {
        key,
        value: JSON.stringify(value),
        headers: {
          'event-time': new Date().toISOString(),
        },
      };

      await this.producer.send({
        topic,
        messages: [message],
      });

      this.logger.log(`Message sent to topic ${topic} with key ${key}`);
    } catch (error) {
      this.logger.error(`Failed to send message to topic ${topic}`, error);
      throw error;
    }
  }

  /**
   * Send multiple messages in batch
   */
  async sendBatch(record: ProducerRecord): Promise<void> {
    try {
      await this.producer.send(record);
      this.logger.log(`Batch sent to topic ${record.topic}, ${record.messages.length} messages`);
    } catch (error) {
      this.logger.error(`Failed to send batch to topic ${record.topic}`, error);
      throw error;
    }
  }
}
