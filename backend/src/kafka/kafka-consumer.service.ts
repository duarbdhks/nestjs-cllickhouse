import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { Repository } from 'typeorm';
import { OrderEntity, OrderItemEntity, UserEntity } from '../database/entities';
import { OrderCreatedEvent, OrderDeletedEvent } from '../order/events';
import { KafkaProducerService } from './kafka-producer.service';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private kafka: Kafka;
  private consumer: Consumer;
  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(OrderEntity) private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity) private readonly orderItemRepository: Repository<OrderItemEntity>,
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
      const value = JSON.parse(message.value?.toString() || '{}');

      this.logger.log(`Received message from ${topic}-${partition} | Key: ${key} | EventType: ${value.eventType}`);

      // Transform the event based on event type
      if (value.eventType === 'OrderCreated') {
        await this.transformOrderCreatedEvent(value as OrderCreatedEvent);
      } else if (value.eventType === 'OrderDeleted') {
        await this.transformOrderDeletedEvent(value as OrderDeletedEvent);
      } else {
        this.logger.warn(`Unknown event type: ${value.eventType}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process message from ${topic}-${partition}`, error);
      // In production, you might want to send this to a dead-letter queue
    }
  }

  private async transformOrderCreatedEvent(event: OrderCreatedEvent): Promise<void> {
    // Validate required fields
    if (!event.orderId || !event.userId) {
      throw new Error(`Missing required fields: orderId=${event.orderId}, userId=${event.userId}`);
    }

    // Fetch user email from database (fallback to UNKNOWN if not found)
    const user = await this.userRepository.findOne({
      where: { id: event.userId },
      select: ['email'],
    });
    const userEmail = user?.email ?? 'UNKNOWN';

    if (!user) {
      this.logger.warn(`User not found for userId: ${event.userId}, using default email`);
    }

    // Convert ISO 8601 date to Unix timestamp for ClickHouse DateTime
    const orderDate = Math.floor(new Date(event.createdAt).getTime() / 1000);

    // Transform to analytics format matching ClickHouse schema
    const analyticsEvent = {
      order_id: event.orderId,
      user_id: event.userId,
      user_email: userEmail,
      order_date: orderDate,
      total_amount: event.totalAmount,
      items_count: event.itemsCount,
      status: event.status,
      payment_method: 'UNKNOWN',
      payment_status: 'PENDING',
      version: event.createdAt ? new Date(event.createdAt).getTime() : Date.now(),
      event_type: 'CREATED',
      deleted_at: null,
      is_deleted: 0,
    };

    // Send to orders_analytics topic for ClickHouse ingestion
    await this.kafkaProducer.send('orders_analytics', analyticsEvent.order_id, analyticsEvent);

    this.logger.log(
      `Transformed OrderCreated event | Order: ${analyticsEvent.order_id} | User: ${analyticsEvent.user_email} | Items: ${analyticsEvent.items_count}`,
    );
  }

  /**
   * Transform OrderDeleted event to analytics format
   * Hybrid Events: Fetch original Order + User + OrderItem data from database
   * This creates a new INSERT with is_deleted=1 and deleted_at timestamp
   * ReplacingMergeTree will keep the latest version based on version field
   */
  private async transformOrderDeletedEvent(event: OrderDeletedEvent): Promise<void> {
    // Validate required fields
    if (!event.orderId) {
      throw new Error(`Missing required field: orderId=${event.orderId}`);
    }

    // Fetch original Order data from database
    const order = await this.orderRepository.findOne({
      where: { id: event.orderId },
      select: ['id', 'userId', 'totalAmount', 'status', 'createdAt'],
    });

    if (!order) {
      this.logger.error(`Order not found for orderId: ${event.orderId}, cannot transform OrderDeleted event`);
      throw new Error(`Order ${event.orderId} not found in database`);
    }

    // Fetch User email from database (fallback to UNKNOWN if not found)
    const user = await this.userRepository.findOne({
      where: { id: order.userId },
      select: ['email'],
    });
    const userEmail = user?.email ?? 'UNKNOWN';

    if (!user) {
      this.logger.warn(`User not found for userId: ${order.userId}, using default email`);
    }

    // Count OrderItems from database
    const itemsCount = await this.orderItemRepository.count({
      where: { orderId: event.orderId },
    });

    // Convert timestamps
    const deletedAtTimestamp = Math.floor(new Date(event.deletedAt).getTime() / 1000);
    const orderDateTimestamp = Math.floor(new Date(order.createdAt).getTime() / 1000);

    // Transform to analytics deletion format
    const analyticsDeleteEvent = {
      order_id: order.id,
      user_id: order.userId,
      user_email: userEmail,
      order_date: orderDateTimestamp,
      total_amount: Number(order.totalAmount),
      items_count: itemsCount,
      status: order.status,
      payment_method: 'UNKNOWN',
      payment_status: 'UNKNOWN',
      version: event.version,
      event_type: 'DELETED',
      deleted_at: deletedAtTimestamp,
      is_deleted: 1,
    };

    // Send to orders_analytics topic for ClickHouse ingestion
    await this.kafkaProducer.send('orders_analytics', analyticsDeleteEvent.order_id, analyticsDeleteEvent);

    this.logger.log(
      `Transformed OrderDeleted event | Order: ${analyticsDeleteEvent.order_id} | User: ${userEmail} | Items: ${itemsCount} | DeletedBy: ${event.deletedBy} | Version: ${event.version}`,
    );
  }
}
