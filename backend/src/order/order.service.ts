import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { OrderEntity, OrderItemEntity, OrderStatus, UserEntity } from '../database/entities';
import { OutboxService } from '../outbox/outbox.service';
import { CreateOrderDto, OrderResponseDto } from './dto';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(OrderEntity) private readonly orderRepository: Repository<OrderEntity>,
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create order with Outbox Pattern (Hybrid Events)
   * Order creation and outbox event are saved in the same transaction
   * Payload includes only changing fields (status, totalAmount, itemsCount)
   * Consumer fetches static data (userEmail) from database
   */
  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    return await this.dataSource.transaction(async manager => {
      // Validate user exists within transaction
      const user = await manager.findOne(UserEntity, {
        where: { id: dto.userId },
      });

      if (!user) {
        throw new NotFoundException(`User ${dto.userId} not found`);
      }
      // 1. Create and save Order
      const orderId = uuidv4();

      // Map status from DTO to OrderStatus enum
      let orderStatus = OrderStatus.PENDING;
      if (dto.status) {
        const statusMap: Record<string, OrderStatus> = {
          pending: OrderStatus.PENDING,
          processing: OrderStatus.PREPARING,
          completed: OrderStatus.DELIVERED,
          cancelled: OrderStatus.CANCELLED,
          payment_processing: OrderStatus.PAYMENT_PROCESSING,
          payment_confirmed: OrderStatus.PAYMENT_CONFIRMED,
          preparing: OrderStatus.PREPARING,
          shipped: OrderStatus.SHIPPED,
          delivered: OrderStatus.DELIVERED,
          refunded: OrderStatus.REFUNDED,
        };
        orderStatus = statusMap[dto.status.toLowerCase()] || OrderStatus.PENDING;
      }

      const order = manager.create(OrderEntity, {
        id: orderId,
        userId: dto.userId,
        totalAmount: dto.totalAmount,
        status: orderStatus,
        shippingAddress: dto.shippingAddress || 'Not provided',
      });

      const savedOrder = await manager.save(OrderEntity, order);

      this.logger.log(`Order created: ${orderId} for user ${dto.userId}`);

      // 2. Save Order Items (if provided)
      if (dto.items && dto.items.length > 0) {
        const orderItems = dto.items.map(item =>
          manager.create(OrderItemEntity, {
            orderId: orderId,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          }),
        );

        await manager.save(OrderItemEntity, orderItems);

        this.logger.log(`Saved ${orderItems.length} order items for order ${orderId}`);
      }

      // 3. Publish Outbox event (same transaction) - Hybrid Events
      // Only include changing fields (status, totalAmount, itemsCount)
      // Consumer will fetch static data (userEmail) from database
      await this.outboxService.publishEvent(manager, {
        aggregateId: orderId,
        aggregateType: 'Order',
        eventType: 'OrderCreated',
        payload: {
          orderId: savedOrder.id,
          userId: savedOrder.userId,
          totalAmount: Number(savedOrder.totalAmount),
          itemsCount: dto.items?.length || 0,
          status: savedOrder.status,
          createdAt: savedOrder.createdAt.toISOString(),
        },
      });

      return OrderResponseDto.from(savedOrder);
    });
  }

  /**
   * Find order by ID
   */
  async findOne(id: string): Promise<OrderEntity | null> {
    return this.orderRepository.findOne({ where: { id } });
  }

  /**
   * Find orders by user ID
   */
  async findByUserId(userId: string): Promise<OrderEntity[]> {
    return this.orderRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Soft delete order with Outbox Pattern (Admin only)
   * Marks order as deleted and publishes OrderDeleted event
   */
  async deleteOrder(orderId: string, deletedBy: string): Promise<void> {
    // Check if order exists
    const order = await this.orderRepository.findOne({ where: { id: orderId } });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.deletedAt) {
      throw new Error(`Order ${orderId} is already deleted`);
    }

    return await this.dataSource.transaction(async manager => {
      // 1. Soft delete order (set deleted_at timestamp)
      const deletedAt = new Date();
      await manager.update(OrderEntity, { id: orderId }, { deletedAt });

      this.logger.log(`Order soft-deleted: ${orderId} by admin ${deletedBy}`);

      // 2. Publish OrderDeleted event to Outbox (same transaction)
      // Hybrid Events: Minimal payload (orderId, deletedAt, deletedBy, version)
      // Consumer will fetch Order + User + OrderItem data from database
      const version = Date.now(); // Unix timestamp in milliseconds for version control

      await this.outboxService.publishEvent(manager, {
        aggregateId: orderId,
        aggregateType: 'Order',
        eventType: 'OrderDeleted',
        payload: {
          eventType: 'OrderDeleted',
          orderId: orderId,
          deletedAt: deletedAt.toISOString(),
          deletedBy: deletedBy,
          version: version,
        },
      });

      this.logger.log(`OrderDeleted event published for order ${orderId} with version ${version}`);
    });
  }
}
