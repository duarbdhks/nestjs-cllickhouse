import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { OrderStatus } from '../database/entities';
import { KafkaProducerService } from './kafka-producer.service'; // Order item structure from CreateOrderDto

// Order item structure from CreateOrderDto
interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

// Kafka message structure (flattened by outbox-relay from Outbox payload)
// This matches the actual data sent from order.service.ts createOrder method
interface OrderEvent {
  eventType: string;
  orderId: string;
  userId: string;
  userEmail: string;
  totalAmount: number;
  itemsCount: number;
  status: OrderStatus;
  shippingAddress: string;
  items: OrderItem[];
  createdAt: string;
}

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private kafka: Kafka;
  private consumer: Consumer;
  constructor(
    private readonly configService: ConfigService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {
    const brokers = this.configService.get<string>('KAFKA_BROKERS', 'localhost:19092').split(',');

    this.kafka = new Kafka({
      clientId: this.configService.get('KAFKA_CLIENT_ID', 'nestjs-ecommerce'),
      brokers,
      retry: {
        retries: 3,
        initialRetryTime: 300,
        multiplier: 2,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: 'order-event-transformer',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
  }

  async onModuleInit() {
    try {
      await this.consumer.connect();
      this.logger.log('Kafka Consumer connected successfully');

      // Subscribe to order.events topic
      await this.consumer.subscribe({
        topics: ['order.events'],
        fromBeginning: false, // Only consume new messages
      });

      this.logger.log('Subscribed to order.events topic');

      // Start consuming messages (don't await - it's a long-running process)
      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });

      this.logger.log('Kafka Consumer is now running');
    } catch (error) {
      this.logger.error('Failed to initialize Kafka Consumer', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.consumer.disconnect();
      this.logger.log('Kafka Consumer disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting Kafka Consumer', error);
    }
  }

  private async handleMessage(payload: EachMessagePayload) {
    const { topic, partition, message } = payload;

    try {
      const key = message.key?.toString();
      const value = JSON.parse(message.value?.toString() || '{}') as OrderEvent;

      this.logger.log(`Received message from ${topic}-${partition} | Key: ${key}`);

      // Transform the event based on event type
      if (value.eventType === 'OrderCreated') {
        await this.transformOrderCreatedEvent(value);
      } else {
        this.logger.warn(`Unknown event type: ${value.eventType}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process message from ${topic}-${partition}`, error);
      // In production, you might want to send this to a dead-letter queue
    }
  }

  private async transformOrderCreatedEvent(event: OrderEvent): Promise<void> {
    try {
      // Validate required fields
      if (!event.orderId || !event.userId) {
        throw new Error(`Missing required fields: orderId=${event.orderId}, userId=${event.userId}`);
      }

      // Convert ISO 8601 date to Unix timestamp for ClickHouse DateTime
      const orderDate = Math.floor(new Date(event.createdAt).getTime() / 1000);

      // Transform to analytics format matching ClickHouse schema
      const analyticsEvent = {
        order_id: event.orderId,
        user_id: event.userId,
        user_email: event.userEmail,
        order_date: orderDate, // Unix timestamp for ClickHouse DateTime
        total_amount: event.totalAmount,
        items_count: event.itemsCount,
        status: event.status,
        payment_method: 'UNKNOWN', // Default for MVP (payment happens asynchronously)
        payment_status: 'PENDING', // Default for MVP (payment happens asynchronously)
      };

      // Send to orders_analytics topic for ClickHouse ingestion
      await this.kafkaProducer.send('orders_analytics', analyticsEvent.order_id, analyticsEvent);

      this.logger.log(
        `Transformed OrderCreated event | Order: ${analyticsEvent.order_id} | User: ${analyticsEvent.user_email} | Items: ${analyticsEvent.items_count}`,
      );
    } catch (error) {
      this.logger.error('Failed to transform OrderCreated event', error);
      throw error;
    }
  }
}
