import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AnalyticsModule } from './analytics/analytics.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClickHouseModule } from './clickhouse/clickhouse.module';
import { KafkaModule } from './kafka/kafka.module';
import { OrderModule } from './order/order.module';
import { OutboxModule } from './outbox/outbox.module';
import { ProductModule } from './product/product.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    // Config Module
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // TypeORM Module
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // MVP: false (use existing MySQL schema)
        logging: ['error', 'warn'],
      }),
      inject: [ConfigService],
    }),

    // Schedule Module (for Outbox Relay Cron)
    ScheduleModule.forRoot(),

    // Serve Static Module (for HTML UI)
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
    }),

    // Outbox Module
    OutboxModule,

    // Order Module
    OrderModule,

    // Product Module
    ProductModule,

    // User Module
    UserModule,

    // Kafka Module
    KafkaModule,

    // ClickHouse Module
    ClickHouseModule,

    // Analytics Module
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
