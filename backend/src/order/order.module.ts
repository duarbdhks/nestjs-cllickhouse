import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity, OrderItemEntity, UserEntity } from '../database/entities';
import { OutboxModule } from '../outbox/outbox.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { AdminOrdersController } from './admin-orders.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrderEntity, OrderItemEntity, UserEntity]), OutboxModule],
  controllers: [OrderController, AdminOrdersController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
