# Kafka-ClickHouse MVP E-Commerce Analytics Pipeline

**로컬 Docker Compose 환경**에서 실행 가능한 **이벤트 기반 데이터 파이프라인** MVP 프로젝트입니다.

## 🎯 프로젝트 목표

1. ✅ **Outbox Pattern** 구현 - MySQL 트랜잭션 일관성 보장
2. ✅ **Kafka Event Streaming** - 이벤트 기반 아키텍처
3. ✅ **ClickHouse 실시간 집계** - OLAP 분석 및 Materialized Views
4. ✅ **Grafana 모니터링** - 실시간 대시보드
5. ✅ **Cron Batch 폴링** - Debezium 없이 Outbox 이벤트 릴레이

## 📋 기술 스택

| 레이어 | 기술 | 용도 |
|--------|------|------|
| **OLTP** | MySQL 8.0 | 트랜잭션 데이터 + Outbox 테이블 |
| **Event Streaming** | Apache Kafka | 이벤트 스트리밍 |
| **Event Relay** | NestJS Cron | Outbox → Kafka (5초 폴링) |
| **OLAP** | ClickHouse | 실시간 집계 및 분석 |
| **Monitoring** | Grafana | 대시보드 시각화 |
| **Orchestration** | Docker Compose | 로컬 인프라 |

## 🏗️ 시스템 아키텍처

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   NestJS    │────▶│   MySQL      │────▶│   Outbox    │
│   Monolith  │     │   (OLTP)     │     │   Table     │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                                          ┌──────▼──────┐
                                          │ Outbox Relay│
                                          │ (Cron 5sec) │
                                          └──────┬──────┘
                                                 │
                                          ┌──────▼──────┐
                                          │    Kafka    │
                                          │   Topics    │
                                          └──────┬──────┘
                                                 │
                                    ┌────────────┴────────────┐
                                    │                         │
                            ┌───────▼────────┐      ┌────────▼────────┐
                            │ Kafka Consumer │      │ Kafka Connect   │
                            │  (Transformer) │      │ ClickHouse Sink │
                            └───────┬────────┘      └────────┬────────┘
                                    │                        │
                                    └────────────┬───────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │   ClickHouse    │
                                        │ Materialized    │
                                        │     Views       │
                                        └────────┬────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │    Grafana      │
                                        │   Dashboard     │
                                        └─────────────────┘
```

## 🚀 빠른 시작

### 1. 프로젝트 클론

```bash
git clone <repository-url>
cd kafka-click-house
```

### 2. 인프라 실행

```bash
# 모든 서비스 시작
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 서비스 상태 확인
docker-compose ps
```

### 3. 초기 데이터베이스 설정

```bash
# MySQL 스키마 초기화 (orders.deleted_at 포함)
docker exec -i mysql mysql -u root -ppassword < scripts/init-mysql.sql

# ClickHouse 스키마 초기화 (삭제 지원 필드 + TTL 포함)
docker exec -i clickhouse clickhouse-client --multiquery < scripts/init-clickhouse.sql
```

### 4. Kafka Connect Sink 등록

```bash
# ClickHouse Sink Connector 등록
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @kafka-connect/clickhouse-sink.json

# Connector 상태 확인
curl http://localhost:8083/connectors/clickhouse-sink-orders/status
```

### 5. 접속 정보

| 서비스 | URL | 계정 정보 |
|--------|-----|-----------|
| **MySQL** | `localhost:3306` | `root` / `test123` 또는 `admin` / `test123` |
| **Kafka** | `localhost:9092` | - |
| **Kafka UI** | http://localhost:8080 | - |
| **Kafka Connect** | http://localhost:8083 | - |
| **ClickHouse HTTP** | http://localhost:8123 | `admin` / `test123` |
| **Grafana** | http://localhost:3001 | `admin` / `test123` |
| **Backend API** | http://localhost:3000 | - |
| **Admin API** | http://localhost:3000/admin/orders | X-Admin-Id header 필수 |
| **HTML Dashboard** | http://localhost:3000/ | - |

## 📊 데이터 흐름

### Outbox Pattern 플로우

1. **트랜잭션 시작**
   ```sql
   BEGIN;
   INSERT INTO orders (...);
   INSERT INTO outbox (...);  -- 같은 트랜잭션
   COMMIT;
   ```

2. **Cron Polling (5초마다)**
   ```typescript
   @Cron('*/5 * * * * *')
   async relayEvents() {
     const events = await this.outboxRepo.find({
       where: { processed: false },
       order: { createdAt: 'ASC' },
       take: 100,
     });
     // Kafka로 전송 → processed=true 마킹
   }
   ```

3. **Kafka → ClickHouse**
   - Kafka Connect Sink가 자동으로 ClickHouse에 적재
   - Materialized Views가 실시간 집계

## 🗄️ 데이터베이스 스키마

### MySQL (OLTP)

```sql
-- 주문 테이블 (Soft Delete 지원)
CREATE TABLE orders (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    status ENUM('PENDING', 'COMPLETED', 'CANCELLED'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL  -- Soft Delete 지원
);

-- Outbox 테이블 (OrderCreated/OrderDeleted 이벤트)
CREATE TABLE outbox (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(100) NOT NULL,  -- 'OrderCreated', 'OrderDeleted'
    payload JSON NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_processed_created (processed, created_at)
);
```

### ClickHouse (OLAP)

```sql
-- 분석 테이블 (ReplacingMergeTree with Version + Soft Delete + TTL)
CREATE TABLE analytics.orders_analytics (
    order_id String,
    user_id String,
    order_date DateTime,
    total_amount Decimal(10, 2),
    status String,

    -- Deletion support fields
    version UInt64,                     -- Event version (Unix timestamp in milliseconds)
    event_type String DEFAULT 'CREATED', -- 'CREATED', 'DELETED'
    deleted_at Nullable(DateTime),      -- Soft delete timestamp
    is_deleted UInt8 DEFAULT 0          -- 0=active, 1=deleted
) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(order_date)
ORDER BY (order_date, user_id, order_id)
TTL assumeNotNull(deleted_at) + INTERVAL 7 DAY DELETE WHERE is_deleted = 1;
-- Physical deletion 7 days after soft delete

-- 일별 매출 집계 (Materialized View with is_deleted filter)
CREATE MATERIALIZED VIEW analytics.daily_sales_mv
ENGINE = SummingMergeTree()
AS SELECT
    toDate(order_date) as order_date,
    count() as order_count,
    sum(total_amount) as total_revenue
FROM analytics.orders_analytics
WHERE status NOT IN ('cancelled', 'refunded')
  AND is_deleted = 0  -- Exclude soft-deleted orders
GROUP BY order_date;
```

## 🔍 검증 및 모니터링

### Outbox 처리 상태 확인

```bash
# 미처리 이벤트 수
docker exec -it mysql mysql -u root -ptest123 -e \
  "SELECT COUNT(*) as pending FROM ecommerce.outbox WHERE processed = false;"
```

### Kafka 토픽 확인

```bash
# 토픽 목록
docker exec -it kafka kafka-topics.sh --list --bootstrap-server localhost:9092

# Consumer Lag 확인
docker exec -it kafka kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group analytics-transformer --describe
```

### ClickHouse 데이터 확인

```bash
# 데이터 적재 확인
docker exec -it clickhouse clickhouse-client --query \
  "SELECT COUNT(*) FROM analytics.orders_analytics;"

# 일별 매출 조회
docker exec -it clickhouse clickhouse-client --query \
  "SELECT * FROM analytics.daily_sales_mv ORDER BY order_date DESC LIMIT 5;"
```

### Grafana 대시보드

1. http://localhost:3001 접속 (admin/test123)
2. ClickHouse 데이터 소스 추가
3. 대시보드 생성:
   - 일별 매출 트렌드
   - 시간별 주문 수
   - 상위 10개 상품

## 🧪 테스트 시나리오

### 1. 주문 생성

```bash
# NestJS API로 주문 생성
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "status": "PENDING",
    "totalAmount": 50000,
    "items": [
      {
        "productId": 101,
        "quantity": 2,
        "price": 25000
      }
    ]
  }'
```

### 2. 주문 삭제 (Admin API)

```bash
# Admin API로 주문 삭제 (Soft Delete)
curl -X DELETE http://localhost:3000/admin/orders/{orderId} \
  -H "X-Admin-Id: admin-user-123"

# 삭제 플로우 E2E 테스트 (자동화 스크립트)
./scripts/test-deletion-flow.sh
```

### 3. 파이프라인 검증

```bash
# 1. MySQL에서 주문 확인
docker exec -it mysql mysql -u root -ptest123 -e \
  "SELECT * FROM ecommerce.orders ORDER BY created_at DESC LIMIT 1;"

# 2. Outbox 이벤트 확인
docker exec -it mysql mysql -u root -ptest123 -e \
  "SELECT * FROM ecommerce.outbox WHERE processed=false LIMIT 1;"

# 3. 5초 대기 후 processed=true 확인
sleep 5
docker exec -it mysql mysql -u root -ptest123 -e \
  "SELECT processed FROM ecommerce.outbox ORDER BY created_at DESC LIMIT 1;"

# 4. ClickHouse 적재 확인 (10초 대기)
sleep 10
docker exec -it clickhouse clickhouse-client --query \
  "SELECT * FROM analytics.orders_analytics ORDER BY created_at DESC LIMIT 1;"
```

## 📈 성능 메트릭 (MVP 목표)

| 메트릭 | 목표 | 비고 |
|--------|------|------|
| Outbox Polling Interval | 5초 | Cron 간격 |
| Event Delivery Latency | 5-10초 | Polling + Kafka + ClickHouse |
| ClickHouse Query | <100ms | Materialized Views |
| Order Throughput | ~100 orders/min | 단일 인스턴스 |
| Kafka Lag | <1000 messages | 정상 동작 시 |

## 🛠️ 트러블슈팅

### MySQL 연결 실패
```bash
docker-compose restart mysql
docker exec -it mysql mysql -u root -ppassword -e "SELECT 1;"
```

### Kafka Connect 실패
```bash
# Connector 로그 확인
docker logs kafka-connect

# Connector 재시작
curl -X POST http://localhost:8083/connectors/clickhouse-sink-orders/restart
```

### ClickHouse 데이터 누락
```bash
# Kafka Connect 상태 확인
curl http://localhost:8083/connectors/clickhouse-sink-orders/status

# ClickHouse 로그 확인
docker logs clickhouse
```

## 🧹 정리

```bash
# 서비스 중지 및 볼륨 삭제 (데이터 완전 삭제)
docker-compose down -v

# 특정 서비스만 재시작
docker-compose restart kafka
```

## 📚 참고 문서

- **[백엔드 상세 README](./backend/README.md)** - NestJS 구현 상세, API 엔드포인트, 모듈 설명
- [아키텍처 설계](./docs/architecture/system-architecture-diagram.md)
- [ADR-001: Event-Driven Architecture](./docs/architecture/ADR-001-event-driven-architecture.md)
- [Database Schema Design](./docs/architecture/database-schema-design.md)

## 🔗 외부 참고 자료

- [Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [ClickHouse Kafka Integration](https://clickhouse.com/docs/en/engines/table-engines/integrations/kafka)
- [NestJS Task Scheduling](https://docs.nestjs.com/techniques/task-scheduling)

## 📝 구현 현황

1. ✅ **로컬 인프라 구축** (Docker Compose)
   - Kafka 3-node KRaft cluster
   - MySQL, ClickHouse, Grafana, Kafka Connect

2. ✅ **NestJS 백엔드 구현** (완료)
   - ✅ Order Module (CRUD API + Outbox Pattern)
   - ✅ Admin Orders Module (Soft Delete with OrderDeleted event)
   - ✅ Outbox Module (Outbox Relay Service with Cron)
   - ✅ Kafka Module (Producer + Consumer/Transformer)
   - ✅ ClickHouse Module (쿼리 클라이언트)
   - ✅ Analytics Module (집계 API)
   - ✅ User, Product Module (기본 엔티티)
   - ✅ Order Deletion Flow (Soft Delete + TTL)
   - ⚠️ **미완성**: Payment/Inventory Entity

3. ⏳ **Grafana 대시보드 구성** (인프라 준비 완료, 대시보드 미구성)

4. ⏳ **React 프론트엔드** (Optional)
   - ✅ 정적 HTML 대시보드 제공 중 (`public/`)

## ⚠️ 알려진 제약사항

### 1. Payment 관리 미완성

주문 생성 후 결제 프로세스 관리는 구현되지 않았습니다:

```typescript
payment_method: 'UNKNOWN',    // 결제 수단 조회 필요
payment_status: 'PENDING',    // 결제 상태 조회 필요
```

**영향**: ClickHouse `orders_analytics` 테이블의 해당 컬럼이 불완전한 데이터로 채워집니다.

**해결 방법**: PaymentEntity 추가 후 결제 프로세스 구현

### 2. 미구현 엔티티

MySQL 스키마에는 존재하지만 TypeORM 엔티티가 없는 테이블:

- `payments` 테이블 → `PaymentEntity` 필요
- `inventory` 테이블 → `InventoryEntity` 필요

**영향**: 결제 및 재고 관리 기능을 NestJS로 구현할 수 없습니다.

### 3. React Frontend 미구현

현재는 정적 HTML UI만 제공되며, React 기반 SPA는 구현되지 않았습니다.

**대안**: `backend/public/` 디렉토리의 HTML 대시보드 사용

---

## 🏗️ 백엔드 개발 구조 (NestJS)

### 프로젝트 구조

```
backend/nestjs-app/
├── src/
│   ├── main.ts                      # 애플리케이션 진입점
│   ├── app.module.ts                # 루트 모듈
│   │
│   ├── config/                      # 설정
│   │   ├── database.config.ts       # MySQL 연결 설정
│   │   ├── kafka.config.ts          # Kafka 설정
│   │   └── app.config.ts            # 앱 전역 설정
│   │
│   ├── database/                    # 데이터베이스 계층
│   │   ├── entities/
│   │   │   ├── user.entity.ts
│   │   │   ├── order.entity.ts
│   │   │   ├── order-item.entity.ts
│   │   │   ├── product.entity.ts
│   │   │   ├── inventory.entity.ts
│   │   │   ├── payment.entity.ts
│   │   │   └── outbox.entity.ts     # Outbox 패턴
│   │   └── database.module.ts
│   │
│   ├── modules/                     # 비즈니스 로직 모듈
│   │   ├── order/                   # 주문 모듈
│   │   │   ├── dto/
│   │   │   ├── order.controller.ts  # REST API
│   │   │   ├── order.service.ts     # 비즈니스 로직 + Outbox
│   │   │   └── order.module.ts
│   │   │
│   │   ├── payment/                 # 결제 모듈
│   │   ├── inventory/               # 재고 모듈
│   │   ├── product/                 # 상품 모듈
│   │   └── analytics/               # 분석 API 모듈
│   │
│   ├── outbox/                      # Outbox Pattern 핵심
│   │   ├── outbox-relay.service.ts  # Cron Polling → Kafka
│   │   ├── outbox.service.ts        # Outbox 저장 헬퍼
│   │   └── outbox.module.ts
│   │
│   ├── kafka/                       # Kafka 통합
│   │   ├── kafka-producer.service.ts    # Kafka Producer
│   │   ├── kafka-consumer.service.ts    # Event Transformer
│   │   └── kafka.module.ts
│   │
│   └── clickhouse/                  # ClickHouse 클라이언트
│       ├── clickhouse.service.ts    # ClickHouse 쿼리
│       └── clickhouse.module.ts
│
├── test/                            # E2E 테스트
├── package.json
└── .env                             # 환경 변수
```

### 핵심 컴포넌트

#### 1. Order Service (Outbox Pattern)

```typescript
@Injectable()
export class OrderService {
  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    return await this.dataSource.transaction(async (manager) => {
      // 1. Order 저장
      const order = await manager.save(Order, {...});

      // 2. OrderItems 저장
      await manager.save(OrderItem, [...]);

      // 3. Outbox 이벤트 저장 (같은 트랜잭션)
      await this.outboxService.publishEvent(manager, {
        aggregateId: order.id,
        aggregateType: 'Order',
        eventType: 'OrderCreated',
        payload: { orderId, userId, totalAmount, items },
      });

      return OrderResponseDto.from(order);
    });
  }
}
```

#### 2. Outbox Relay Service (Cron Polling)

```typescript
@Injectable()
export class OutboxRelayService {
  @Cron('*/5 * * * * *')  // 5초마다 실행
  async relayEvents() {
    // 1. 미처리 이벤트 조회 (LIMIT 100)
    const events = await this.outboxRepo.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
      take: 100,
    });

    // 2. Kafka로 발행
    for (const event of events) {
      await this.kafkaProducer.send({
        topic: `${event.aggregateType.toLowerCase()}.events`,
        messages: [{ key: event.aggregateId, value: event.payload }],
      });

      // 3. 처리 완료 마킹
      event.processed = true;
      await this.outboxRepo.save(event);
    }
  }
}
```

#### 3. Kafka Consumer (Event Transformer)

```typescript
@Injectable()
export class KafkaConsumerService {
  async onModuleInit() {
    await this.consumer.subscribe({
      topics: ['order.events', 'payment.events', 'inventory.events'],
    });

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const payload = JSON.parse(message.value.toString());

        // 분석용 포맷으로 변환
        const analyticsEvent = this.transformToAnalytics(topic, payload);

        // orders_analytics 토픽으로 발행 (ClickHouse Sink가 소비)
        await this.kafkaProducer.send({
          topic: 'orders_analytics',
          messages: [{ value: JSON.stringify(analyticsEvent) }],
        });
      },
    });
  }
}
```

#### 4. Analytics API (ClickHouse 조회)

```typescript
@Injectable()
export class AnalyticsService {
  async getDailySales(startDate: Date, endDate: Date) {
    const query = `
      SELECT order_date, order_count, total_revenue, avg_order_value
      FROM analytics.daily_sales_mv
      WHERE order_date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY order_date DESC
    `;
    return await this.clickhouseService.query(query);
  }

  async getRealtimeMetrics() {
    const query = `
      SELECT
        count() as total_orders,
        sum(total_amount) as total_revenue
      FROM analytics.orders_analytics
      WHERE order_date = today()
    `;
    return await this.clickhouseService.query(query);
  }
}
```

### API 엔드포인트

#### ✅ 구현된 엔드포인트

**주문 API**:
```
POST   /api/orders              # 주문 생성 (+ Outbox 이벤트)
GET    /api/orders/:id          # 주문 조회
GET    /api/orders/user/:userId # 사용자별 주문 목록
```

**분석 API**:
```
GET    /api/analytics/daily-sales     # 일별 매출 집계
GET    /api/analytics/hourly-sales    # 시간별 주문 집계
GET    /api/analytics/order-status    # 주문 상태별 분포
GET    /api/analytics/stats            # 전체 통계
GET    /api/analytics/health           # ClickHouse 연결 상태
```

#### ⏳ 미구현 엔드포인트 (예정)

```
POST   /api/payments            # 결제 처리
GET    /api/payments/:orderId   # 결제 조회

GET    /api/products            # 상품 목록
GET    /api/products/:id        # 상품 상세

GET    /api/inventory/:productId    # 재고 조회
PATCH  /api/inventory/:productId    # 재고 업데이트
```

### 환경 변수 (.env)

**위치**: `backend/.env`

```env
# Application
NODE_ENV=development
PORT=3000

# MySQL (OLTP)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=admin
MYSQL_PASSWORD=test123
MYSQL_DATABASE=ecommerce

# Kafka
KAFKA_BROKERS=localhost:19092,localhost:19093,localhost:19094
KAFKA_CLIENT_ID=ecommerce-backend
KAFKA_CONSUMER_GROUP_ID=order-event-transformer

# ClickHouse (OLAP)
CLICKHOUSE_HOST=http://localhost:8123
CLICKHOUSE_USER=admin
CLICKHOUSE_PASSWORD=test123
CLICKHOUSE_DATABASE=analytics

# Outbox Relay
OUTBOX_BATCH_SIZE=100
OUTBOX_POLLING_INTERVAL=*/5 * * * * *  # 5초마다
```

### 주요 의존성

```json
{
  "dependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/core": "^11.0.1",
    "@nestjs/typeorm": "^10.0.2",
    "@nestjs/schedule": "^6.0.1",
    "@nestjs/config": "^3.3.0",
    "typeorm": "^0.3.27",
    "mysql2": "^3.11.5",
    "kafkajs": "^2.2.4",
    "@clickhouse/client": "^1.12.1",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1",
    "typescript": "^5.7.3"
  }
}
```

### 개발 로드맵

#### Phase 1: 프로젝트 초기 설정 ✅
- [x] NestJS 프로젝트 생성
- [x] TypeORM + MySQL 연동
- [x] 기본 Entity 정의 (Order, Outbox, User, Product 등)

#### Phase 2: Outbox Pattern 구현 ✅
- [x] Outbox Entity 및 Repository
- [x] OutboxService (이벤트 저장)
- [x] OutboxRelayService (Cron Polling → Kafka)

#### Phase 3: Order Module 구현 ✅
- [x] Order CRUD API
- [x] 트랜잭션과 Outbox 통합
- [x] API 테스트

#### Phase 4: Kafka Consumer 구현 ✅
- [x] KafkaConsumerService (Event Transformer)
- [x] orders_analytics 토픽 발행
- [x] 이벤트 변환 로직 (⚠️ 4개 필드 미완성)

#### Phase 5: Analytics API 구현 ✅
- [x] ClickHouseService
- [x] Analytics Controller (매출, 주문 통계)
- [ ] Grafana 대시보드 연동

#### Phase 6: 테스트 및 검증 ⏳
- [ ] 단위 테스트
- [ ] E2E 테스트
- [ ] 전체 파이프라인 검증

---

## 📄 라이선스

MIT License
