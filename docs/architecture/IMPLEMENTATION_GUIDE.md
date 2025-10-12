# MVP 구현 가이드

이 문서는 **Kafka-ClickHouse MVP E-Commerce Analytics Pipeline** 프로젝트의 구현 가이드입니다.

## 📋 구현 체크리스트

### Phase 1: 인프라 구축 (완료 ✅)

- [x] Docker Compose 파일 작성
- [x] MySQL 8.0 컨테이너 설정
- [x] Kafka + ZooKeeper 설정
- [x] Kafka Connect 설정
- [x] ClickHouse 컨테이너 설정
- [x] Grafana 컨테이너 설정
- [x] 초기화 스크립트 작성
  - [x] `scripts/init-mysql.sql`
  - [x] `scripts/init-clickhouse.sql`
- [x] Kafka Connect Sink 설정
  - [x] `kafka-connect/clickhouse-sink.json`
- [x] Grafana 데이터 소스 설정
  - [x] `grafana/provisioning/datasources/clickhouse.yml`

### Phase 2: 백엔드 구현 (예정 ⏳)

- [ ] NestJS 프로젝트 생성
- [ ] TypeORM MySQL 연동
- [ ] Order Module 구현
  - [ ] Order Entity
  - [ ] Order Service (with Outbox)
  - [ ] Order Controller
- [ ] Outbox Relay Service (Cron)
  - [ ] `@Cron('*/5 * * * * *')` 폴링 로직
  - [ ] Kafka Producer 통합
  - [ ] 재시도 로직
- [ ] Kafka Consumer (Event Transformer)
  - [ ] `order.events` 소비
  - [ ] `analytics.orders` 발행

### Phase 3: 분석 파이프라인 (예정 ⏳)

- [ ] ClickHouse 스키마 검증
- [ ] Materialized Views 동작 확인
- [ ] Kafka Connect Sink 등록
- [ ] 데이터 적재 테스트

### Phase 4: 모니터링 (예정 ⏳)

- [ ] Grafana 데이터 소스 연결
- [ ] Dashboard 생성
  - [ ] 일별 매출
  - [ ] 시간별 주문
  - [ ] 상태별 분포
- [ ] 실시간 데이터 검증

### Phase 5: 프론트엔드 (Optional)

- [ ] React 프로젝트 생성
- [ ] 주문 생성 폼
- [ ] API 연동
- [ ] 주문 내역 조회

---

## 🚀 로컬 환경 실행

### 1. 인프라 시작

```bash
# 전체 서비스 시작
make setup

# 또는
docker-compose up -d
make init-db
```

### 2. 서비스 확인

```bash
# 서비스 상태 확인
make ps

# 로그 확인
make logs

# 특정 서비스 로그
docker-compose logs -f mysql
docker-compose logs -f kafka
docker-compose logs -f clickhouse
```

### 3. Kafka Connector 등록

```bash
# Connector 등록
make register-connector

# 상태 확인
make connector-status
```

---

## 🧪 파이프라인 테스트

### 수동 테스트 시나리오

#### 1. MySQL 데이터 생성

```sql
-- MySQL shell 접속
make mysql-shell

-- 샘플 주문 생성
INSERT INTO orders (id, user_id, total_amount, status, shipping_address)
VALUES (UUID(), 'user-1', 99.99, 'PENDING', '123 Main St');

-- Outbox 이벤트 생성 (같은 트랜잭션)
INSERT INTO outbox (aggregate_id, aggregate_type, event_type, payload)
VALUES (
  LAST_INSERT_ID(),
  'Order',
  'OrderCreated',
  JSON_OBJECT(
    'orderId', LAST_INSERT_ID(),
    'userId', 'user-1',
    'totalAmount', 99.99,
    'status', 'PENDING'
  )
);
```

#### 2. Outbox 처리 확인

```bash
# 미처리 이벤트 확인
docker exec -it mysql mysql -u root -ppassword -e \
  "SELECT * FROM ecommerce.outbox WHERE processed = false;"

# 5초 대기 (Cron 폴링 간격)
sleep 5

# 처리 완료 확인
docker exec -it mysql mysql -u root -ppassword -e \
  "SELECT processed FROM ecommerce.outbox ORDER BY created_at DESC LIMIT 1;"
```

#### 3. Kafka 토픽 확인

```bash
# 토픽 목록
make kafka-topics

# 메시지 소비 (테스트)
docker exec -it kafka kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic order.events \
  --from-beginning \
  --max-messages 5
```

#### 4. ClickHouse 적재 확인

```bash
# ClickHouse shell 접속
make clickhouse-shell

# 데이터 확인
SELECT * FROM analytics.orders_analytics ORDER BY created_at DESC LIMIT 5;

# 집계 확인
SELECT * FROM analytics.daily_sales_mv ORDER BY order_date DESC LIMIT 5;
```

---

## 📊 Grafana 대시보드 구성

### 1. 데이터 소스 설정

```bash
# Grafana 접속
make grafana

# 로그인: admin / test123
```

**ClickHouse 데이터 소스가 자동으로 프로비저닝됩니다:**
- Configuration → Data Sources → ClickHouse 확인

### 2. 샘플 쿼리

#### 일별 매출 (Time Series)

```sql
SELECT
    toDateTime(order_date) as time,
    total_revenue as value
FROM analytics.daily_sales_mv
WHERE $__timeFilter(order_date)
ORDER BY order_date
```

#### 오늘 주문 수 (Stat Panel)

```sql
SELECT sum(order_count) as value
FROM analytics.daily_sales_mv
WHERE order_date = today()
```

#### 시간별 트렌드 (Bar Chart)

```sql
SELECT
    toHour(order_hour) as hour,
    sum(order_count) as orders
FROM analytics.hourly_sales_mv
WHERE order_hour >= now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour
```

#### 상태별 분포 (Pie Chart)

```sql
SELECT
    status as label,
    sum(order_count) as value
FROM analytics.order_status_mv
WHERE order_date >= today() - INTERVAL 7 DAY
GROUP BY status
```

---

## 🔍 트러블슈팅

### MySQL 연결 실패

```bash
# 서비스 재시작
docker-compose restart mysql

# 연결 테스트
docker exec -it mysql mysql -u root -ptest123 -e "SELECT 1;"
```

### Kafka 메시지가 전송되지 않음

```bash
# Kafka 로그 확인
docker logs kafka

# ZooKeeper 상태 확인
docker exec -it zookeeper zkServer.sh status
```

### Kafka Connect 실패

```bash
# Connector 로그 확인
docker logs kafka-connect

# Connector 삭제 후 재등록
curl -X DELETE http://localhost:8083/connectors/clickhouse-sink-orders
make register-connector
```

### ClickHouse 데이터 누락

```bash
# Kafka Connect 상태 확인
curl http://localhost:8083/connectors/clickhouse-sink-orders/status | jq

# ClickHouse 로그 확인
docker logs clickhouse

# 테이블 확인
docker exec -it clickhouse clickhouse-client --query \
  "SELECT COUNT(*) FROM analytics.orders_analytics;"
```

### Grafana 대시보드가 데이터를 표시하지 않음

1. ClickHouse 데이터 소스 테스트
   - Configuration → Data Sources → ClickHouse → Test
2. 쿼리 디버깅
   - Panel Edit → Query Inspector → Query
3. ClickHouse에 데이터 존재 확인
   ```bash
   make clickhouse-shell
   # 또는
   docker exec -it clickhouse clickhouse-client --user admin --password test123 --database analytics
   SELECT COUNT(*) FROM analytics.orders_analytics;
   ```

---

## 🧹 정리 및 재시작

### 전체 재시작

```bash
# 서비스 중지
make down

# 데이터 유지하고 재시작
make up

# 완전 초기화 (데이터 삭제)
make clean
make setup
```

### 특정 서비스 재시작

```bash
docker-compose restart mysql
docker-compose restart kafka
docker-compose restart clickhouse
```

---

## 📈 성능 모니터링

### MySQL

```sql
-- Connection count
SHOW STATUS LIKE 'Threads_connected';

-- Slow queries
SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;

-- Outbox 테이블 크기
SELECT
    table_name,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
FROM information_schema.tables
WHERE table_schema = 'ecommerce' AND table_name = 'outbox';
```

### Kafka

```bash
# Consumer Lag
make kafka-consumer-lag

# Broker 메트릭 (Kafka UI에서 확인)
make kafka-ui
```

### ClickHouse

```sql
-- 테이블 크기
SELECT
    table,
    formatReadableSize(sum(bytes)) as size,
    sum(rows) as rows
FROM system.parts
WHERE database = 'analytics' AND active
GROUP BY table
ORDER BY sum(bytes) DESC;

-- 쿼리 성능 분석
SELECT
    query,
    elapsed,
    read_rows,
    formatReadableSize(memory_usage) as memory
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY elapsed DESC
LIMIT 10;
```

---

## 🔐 보안 고려사항 (프로덕션)

MVP는 로컬 개발 환경으로 설계되었으며, 프로덕션 배포 시 다음 사항을 고려해야 합니다:

1. **인증 및 권한**
   - MySQL: 강력한 비밀번호 사용
   - Kafka: SASL/SSL 인증 활성화
   - ClickHouse: 사용자 권한 관리

2. **네트워크 보안**
   - Docker 네트워크 격리
   - 방화벽 규칙 설정
   - TLS/SSL 암호화

3. **데이터 보안**
   - 민감 정보 암호화
   - 백업 및 복구 전략
   - 접근 로그 모니터링

---

## 📚 다음 단계

1. ✅ **인프라 구축 완료**
2. ⏳ **NestJS 백엔드 구현**
   - Order Module
   - Outbox Relay Service
   - Kafka Consumer
3. ⏳ **데이터 파이프라인 검증**
4. ⏳ **Grafana 대시보드 구성**
5. ⏳ **성능 테스트 및 최적화**

---

## 🔗 참고 자료

- [시스템 아키텍처 다이어그램](./system-architecture-diagram.md)
- [ADR-001: Event-Driven Architecture](./ADR-001-event-driven-architecture.md)
- [Database Schema Design](./database-schema-design.md)
- [프로젝트 README](../../README.md)
