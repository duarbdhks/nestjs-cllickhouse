import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('outbox')
@Index(['processed', 'createdAt'])
export class OutboxEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 36 })
  aggregateId: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 100 })
  aggregateType: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'json' })
  payload: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
