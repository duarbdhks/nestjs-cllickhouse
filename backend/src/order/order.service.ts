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
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepository: Repository<OrderItemEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly outboxService: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create order with Outbox Pattern
   * Order creation and outbox event are saved in the same transaction
   */
  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    // Lookup user email before transaction (for outbox payload enrichment)
    const user = await this.userRepository.findOne({
      where: { id: dto.userId },
      select: ['email'],
    });

    if (!user) {
      throw new NotFoundException(`User ${dto.userId} not found`);
    }

    return await this.dataSource.transaction(async manager => {
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

      // 3. Publish Outbox event (same transaction)
      await this.outboxService.publishEvent(manager, {
        aggregateId: orderId,
        aggregateType: 'Order',
        eventType: 'OrderCreated',
        payload: {
          orderId: savedOrder.id,
          userId: savedOrder.userId,
          userEmail: user.email,
          totalAmount: Number(savedOrder.totalAmount),
          itemsCount: dto.items?.length || 0,
          status: savedOrder.status,
          shippingAddress: savedOrder.shippingAddress,
          items: dto.items || [],
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
}
