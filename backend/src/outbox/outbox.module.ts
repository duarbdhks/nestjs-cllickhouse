import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEntity } from '../database/entities';
import { KafkaModule } from '../kafka/kafka.module';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxService } from './outbox.service';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEntity]), KafkaModule],
  providers: [OutboxService, OutboxRelayService],
  exports: [OutboxService],
})
export class OutboxModule {}
