import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEntity } from '../database/entities';

export interface PublishEventDto {
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  payload: Record<string, any>;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEntity)
    private readonly outboxRepository: Repository<OutboxEntity>,
  ) {}

  /**
   * Publish event to outbox table within a transaction
   * This ensures atomicity with business logic
   */
  async publishEvent(manager: EntityManager, dto: PublishEventDto): Promise<OutboxEntity> {
    const outboxEvent = manager.create(OutboxEntity, {
      aggregateId: dto.aggregateId,
      aggregateType: dto.aggregateType,
      eventType: dto.eventType,
      payload: dto.payload,
      processed: false,
    });

    const savedEvent = await manager.save(OutboxEntity, outboxEvent);

    this.logger.log(`Published event: ${dto.eventType} for ${dto.aggregateType}:${dto.aggregateId}`);

    return savedEvent;
  }

  /**
   * Find unprocessed events for relay
   */
  async findUnprocessedEvents(limit: number = 100): Promise<OutboxEntity[]> {
    return this.outboxRepository.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Mark event as processed
   */
  async markAsProcessed(eventId: number): Promise<void> {
    await this.outboxRepository.update(eventId, { processed: true });
  }

  /**
   * Mark multiple events as processed (batch)
   */
  async markManyAsProcessed(eventIds: number[]): Promise<void> {
    if (eventIds.length === 0) return;

    await this.outboxRepository
      .createQueryBuilder()
      .update(OutboxEntity)
      .set({ processed: true })
      .where('id IN (:...ids)', { ids: eventIds })
      .execute();
  }
}
