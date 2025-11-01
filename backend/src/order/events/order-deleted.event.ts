export interface OrderDeletedEvent {
  eventType: 'OrderDeleted';
  orderId: string;
  userId: string;
  deletedAt: string; // ISO 8601 timestamp
  deletedBy: string; // Admin user ID who performed the deletion
  version: number; // Unix timestamp in milliseconds for version control
}
