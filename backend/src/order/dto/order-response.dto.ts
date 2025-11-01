import { OrderEntity, OrderStatus } from '../../database/entities';

export class OrderResponseDto {
  id: string;
  orderId: string; // Alias for frontend compatibility
  userId: string;
  totalAmount: number;
  status: OrderStatus;
  shippingAddress: string | null;
  createdAt: Date;
  updatedAt: Date;

  static from(entity: OrderEntity): OrderResponseDto {
    const dto = new OrderResponseDto();
    dto.id = entity.id;
    dto.orderId = entity.id; // Set orderId for frontend
    dto.userId = entity.userId;
    dto.totalAmount = Number(entity.totalAmount);
    dto.status = entity.status;
    dto.shippingAddress = entity.shippingAddress || null;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
