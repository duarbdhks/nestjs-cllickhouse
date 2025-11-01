import { OrderStatus } from '../../database/entities';

// Hybrid Events: 변경 가능한 필드만 payload에 포함
// userEmail은 Consumer에서 User 테이블 조회
export interface OrderCreatedEvent {
  eventType: 'OrderCreated';
  orderId: string;
  userId: string;
  totalAmount: number;
  itemsCount: number;
  status: OrderStatus;
  createdAt: string;
}
