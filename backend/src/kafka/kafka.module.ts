import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity, OrderItemEntity, UserEntity } from '../database/entities';
import { KafkaProducerService } from './kafka-producer.service';
import { KafkaConsumerService } from './kafka-consumer.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, OrderEntity, OrderItemEntity])],
  providers: [KafkaProducerService, KafkaConsumerService],
  exports: [KafkaProducerService, KafkaConsumerService],
})
export class KafkaModule {}
