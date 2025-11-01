# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Kafka-ClickHouse MVP E-Commerce Analytics Pipeline** - 로컬 Docker Compose 환경에서 실행되는 이벤트 기반 데이터 파이프라인 MVP 프로젝트.

핵심 아키텍처:
- **Outbox Pattern**: MySQL 트랜잭션 일관성 보장
- **Kafka Event Streaming**: 이벤트 기반 아키텍처 (3-node KRaft cluster)
- **ClickHouse OLAP**: 실시간 집계 및 Materialized Views
- **Cron Batch Polling**: Outbox → Kafka 이벤트 릴레이 (5초 간격)

## Essential Commands

### Infrastructure Management
```bash
# 전체 설정 (서비스 시작 + DB 초기화)
make setup

# 서비스 제어
make up              # 모든 서비스 시작
make down            # 모든 서비스 중지
make restart         # 재시작
make ps              # 상태 확인
make logs            # 전체 로그 보기
make clean           # 서비스 중지 + 볼륨 삭제 (데이터 완전 삭제)

# 데이터베이스 초기화
make init-db         # MySQL + ClickHouse 스키마 생성
```

### Database Access
```bash
# MySQL 쉘 접속 (ecommerce DB)
make mysql-shell

# ClickHouse 쉘 접속 (analytics DB)
make clickhouse-shell
```

### Kafka Operations
```bash
# 토픽 관리
make kafka-topics                              # 토픽 목록
make kafka-create-topic TOPIC=name PARTITIONS=3
make kafka-describe-topic TOPIC=name

# 모니터링
make kafka-consumer-groups                     # 컨슈머 그룹 목록
make kafka-consumer-lag GROUP=group-name       # Consumer Lag 확인
make kafka-cluster-info                        # 클러스터 상태
```

### Kafka Connect
```bash
make register-connector    # ClickHouse Sink Connector 등록
make connector-status      # Connector 상태 확인
```

### Testing & Monitoring
```bash
make test-pipeline                  # 전체 파이프라인 검증 (MySQL → Kafka → ClickHouse)
./scripts/test-deletion-flow.sh     # 주문 삭제 플로우 E2E 테스트
make kafka-ui                       # Kafka UI 열기 (localhost:8080)
make grafana                        # Grafana 열기 (localhost:3001, admin/test123)
```

## Architecture & Data Flow

### System Components
```
NestJS Monolith → MySQL (OLTP) → Outbox Table
                                      ↓
                              Outbox Relay (Cron 5sec)
                                      ↓
                                  Kafka Topics
                                      ↓
                        ┌─────────────┴─────────────┐
                        ↓                           ↓
              Kafka Consumer              Kafka Connect
              (Transformer)               ClickHouse Sink
                        ↓                           ↓
                        └─────────────┬─────────────┘
                                      ↓
                            ClickHouse (OLAP)
                            Materialized Views
                                      ↓
                                  Grafana
```

### Outbox Pattern Implementation

**Order Creation Flow**:
1. **트랜잭션 보장**: Order 생성과 Outbox 이벤트가 동일 트랜잭션에서 처리
2. **Cron Polling**: 5초마다 미처리 이벤트를 조회하여 Kafka로 전송
3. **이벤트 변환**: Kafka Consumer가 분석용 포맷으로 변환 후 `orders_analytics` 토픽 발행
4. **자동 적재**: Kafka Connect Sink가 ClickHouse에 자동 적재

**Order Deletion Flow** (Soft Delete with TTL):
1. **Admin API 호출**: `DELETE /admin/orders/:id` (X-Admin-Id header 필수)
2. **MySQL 트랜잭션**: `deleted_at` 설정 + `OrderDeleted` 이벤트 Outbox 생성
3. **Kafka 전파**: Outbox Relay가 `OrderDeleted` 이벤트를 `order.events` 토픽으로 전송
4. **Consumer 변환**: Kafka Consumer가 삭제 이벤트를 `is_deleted=1`, `deleted_at` 포함 포맷으로 변환
5. **ClickHouse 적재**: ReplacingMergeTree에 새 버전 INSERT (기존 row는 병합 시 제거)
6. **MV 필터링**: Materialized Views는 `is_deleted=0` 필터로 삭제된 주문 제외
7. **물리 삭제**: TTL에 의해 7일 후 자동 삭제 (`deleted_at + INTERVAL 7 DAY`)

### Database Schemas

**MySQL (OLTP)**:
- `users`: 사용자 정보
- `products`: 상품 정보
- `orders`: 주문 정보 (**`deleted_at` 추가** - soft delete 지원)
- `order_items`: 주문 상품 상세
- `payments`: 결제 정보
- `inventory`: 재고 관리
- `outbox`: 이벤트 아웃박스 (processed flag, `OrderCreated`/`OrderDeleted` 이벤트)

**ClickHouse (OLAP)**:
- `orders_analytics`: 주문 분석 데이터 (ReplacingMergeTree with **version** field)
  - **새 필드**: `version` (UInt64), `event_type` (String), `deleted_at` (Nullable DateTime), `is_deleted` (UInt8)
  - **TTL**: `deleted_at + INTERVAL 7 DAY DELETE` (7일 후 물리 삭제)
- `daily_sales_mv`: 일별 매출 집계 (Materialized View, **`is_deleted=0` 필터 적용**)
- `hourly_sales_mv`: 시간별 주문 집계 (Materialized View, **`is_deleted=0` 필터 적용**)
- `order_status_mv`: 주문 상태별 분포 (Materialized View, **`is_deleted=0` 필터 적용**)
- `user_analytics_mv`: 사용자별 주문 통계 (Materialized View, **`is_deleted=0` 필터 적용**)

## Service Endpoints

| Service | Endpoint | Credentials |
|---------|----------|-------------|
| MySQL | `localhost:3306` | root/test123, admin/test123 |
| Kafka Cluster | `localhost:19092, 19093, 19094` | - |
| Kafka UI | http://localhost:8080 | - |
| Kafka Connect | http://localhost:8083 | - |
| ClickHouse HTTP | http://localhost:8123 | admin/test123 |
| Grafana | http://localhost:3001 | admin/test123 |
| **NestJS Backend** | http://localhost:3000 | - |
| **Admin API** | http://localhost:3000/admin/orders | X-Admin-Id header 필수 |

## Development Status & Next Steps

### ✅ Phase 1: 인프라 구축 (완료)
- Docker Compose 설정 (Kafka 3-node KRaft cluster)
- MySQL, ClickHouse, Grafana 설정
- 초기화 스크립트 작성
- Kafka Connect Sink 구성

### ✅ Phase 2: 백엔드 구현 (완료)
- NestJS 프로젝트 구현 완료
- Order Module 구현 (TypeORM + Outbox Pattern)
- **Admin Orders API** (주문 삭제 기능)
  - `DELETE /admin/orders/:id` - Soft delete with Outbox event
  - X-Admin-Id header 필수 (감사 추적용)
- Outbox Relay Service (Cron 5초 폴링 → Kafka Producer)
- Kafka Consumer (Event Transformer - OrderCreated/OrderDeleted)

### ⏳ Phase 3-5: Analytics & Frontend (예정)
- Analytics API (ClickHouse 쿼리)
- Grafana 대시보드 구성
- React Frontend (Optional)

## Key Configuration Files

- `docker-compose.yml`: 전체 인프라 정의 (Kafka 3-node cluster, MySQL, ClickHouse, Grafana, Kafka Connect)
- `scripts/init-mysql.sql`: MySQL 스키마 초기화 (outbox 테이블, `orders.deleted_at` 포함)
- `scripts/init-clickhouse.sql`: ClickHouse 스키마 및 Materialized Views (**삭제 지원 필드 및 TTL 포함**)
- `scripts/test-deletion-flow.sh`: **주문 삭제 플로우 E2E 테스트 스크립트**
- `kafka-connect/clickhouse-sink.json`: Kafka Connect ClickHouse Sink 설정
- `grafana/provisioning/`: Grafana 자동 프로비저닝 설정
- `backend/src/order/admin/admin-orders.controller.ts`: **Admin 주문 삭제 API**
- `backend/src/order/events/order-deleted.event.ts`: **OrderDeleted 이벤트 DTO**
- `backend/src/kafka/kafka-consumer.service.ts`: **OrderDeleted 이벤트 변환 핸들러**

## Important Notes

### Kafka 3-Node Cluster
- KRaft 모드 (ZooKeeper 없음)
- Replication Factor: 3
- Min ISR: 2
- Node IDs: kafka-local1 (1), kafka-local2 (2), kafka-local3 (3)
- Internal ports: 29092 (broker), 29093 (controller)
- External ports: 19092, 19093, 19094

### Outbox Processing
- Polling interval: 5초 (Cron expression: `*/5 * * * * *`)
- Batch size: 100 events per cycle
- Status tracking: `processed` boolean flag
- Order: created_at ASC

### Order Deletion (Soft Delete with TTL)
- **Event Types**: `OrderCreated`, `OrderDeleted` (Outbox에 저장)
- **Version Control**: Unix timestamp (milliseconds) - ReplacingMergeTree 버전 필드
- **Soft Delete**: MySQL `deleted_at` 설정 + ClickHouse `is_deleted=1` INSERT
- **TTL Physical Delete**: ClickHouse에서 7일 후 자동 물리 삭제
- **MV Filtering**: 모든 Materialized Views는 `WHERE is_deleted=0` 필터 적용
- **Admin API**: `DELETE /admin/orders/:id` (X-Admin-Id header 필수)
- **Test Command**: `./scripts/test-deletion-flow.sh`

### Data Latency Target
- Outbox → Kafka: ~5-10초 (polling interval)
- Kafka → ClickHouse: 실시간 (Kafka Connect)
- ClickHouse Query: <100ms (Materialized Views)

### Troubleshooting Commands
```bash
# 서비스별 로그 확인
docker-compose logs -f mysql-local
docker-compose logs -f kafka-local1
docker-compose logs -f clickhouse-local
docker-compose logs -f kafka-connect

# Kafka Connect 재시작
curl -X POST http://localhost:8083/connectors/clickhouse-sink-orders/restart

# Connector 삭제
curl -X DELETE http://localhost:8083/connectors/clickhouse-sink-orders
```

## Performance Targets (MVP)

| Metric | Target | Note |
|--------|--------|------|
| Event Delivery Latency | 5-10초 | Polling + Kafka + ClickHouse |
| ClickHouse Query | <100ms | Materialized Views 사용 |
| Order Throughput | ~100 orders/min | 단일 인스턴스 |
| Kafka Lag | <1000 messages | 정상 동작 기준 |

## Reference Documentation

- `README.md`: 전체 프로젝트 설명 및 빠른 시작
- `MAKEFILE_GUIDE.md`: Make 명령어 상세 가이드
- `docs/architecture/system-architecture-diagram.md`: 시스템 아키텍처
- `docs/architecture/ADR-001-event-driven-architecture.md`: 아키텍처 결정 기록
- `docs/architecture/IMPLEMENTATION_GUIDE.md`: 구현 가이드 및 트러블슈팅
- `docs/architecture/database-schema-design.md`: 데이터베이스 스키마 설계
