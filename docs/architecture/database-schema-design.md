# Database Schema Design (MVP)

## Overview

MVP 시스템의 데이터베이스 스키마를 정의합니다.

**데이터베이스 구성**:
- **MySQL 8.0 (OLTP)**: 트랜잭션 데이터 및 Outbox 테이블
- **ClickHouse (OLAP)**: 분석 데이터 및 실시간 집계

**설계 원칙**:
- Outbox Pattern으로 데이터 일관성 보장
- MySQL → Kafka → ClickHouse 파이프라인
- Cron Polling 최적화를 위한 인덱스 설계

---

## MySQL Schema (OLTP)

### Database 생성

```sql
CREATE DATABASE IF NOT EXISTS ecommerce
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ecommerce;
```

---

### 1. Users Table

```sql
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,

    INDEX idx_email (email),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 2. Products Table

```sql
CREATE TABLE products (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    category VARCHAR(100),
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,

    INDEX idx_category (category),
    INDEX idx_is_active (is_active),
    INDEX idx_price (price),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 3. Inventory Table

```sql
CREATE TABLE inventory (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    product_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    reserved INT NOT NULL DEFAULT 0,
    available INT GENERATED ALWAYS AS (quantity - reserved) STORED,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX idx_product_id (product_id),
    INDEX idx_available (available),

    CONSTRAINT fk_inventory_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT check_quantity_positive CHECK (quantity >= 0),
    CONSTRAINT check_reserved_positive CHECK (reserved >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**설계 포인트**:
- `available`: Generated Column으로 자동 계산 (quantity - reserved)
- 재고는 음수가 될 수 없도록 CHECK 제약

---

### 4. Orders Table

```sql
CREATE TABLE orders (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id VARCHAR(36) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    status ENUM(
        'PENDING',
        'PAYMENT_PROCESSING',
        'PAYMENT_CONFIRMED',
        'PREPARING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED'
    ) DEFAULT 'PENDING',
    shipping_address TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at DESC),
    INDEX idx_user_created (user_id, created_at DESC),

    CONSTRAINT fk_order_user
        FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 5. Order Items Table

```sql
CREATE TABLE order_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL, -- 주문 당시 가격 (스냅샷)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_order_id (order_id),
    INDEX idx_product_id (product_id),

    CONSTRAINT fk_order_item_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_item_product
        FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT check_quantity_positive CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 6. Payments Table

```sql
CREATE TABLE payments (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    order_id VARCHAR(36) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED') DEFAULT 'PENDING',
    method ENUM('CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'PAYPAL', 'CASH') NOT NULL,
    transaction_id VARCHAR(255), -- 외부 결제 시스템 ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_order_id (order_id),
    INDEX idx_status (status),
    INDEX idx_transaction_id (transaction_id),

    CONSTRAINT fk_payment_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

### 7. Outbox Table (Transactional Outbox Pattern)

```sql
CREATE TABLE outbox (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_id VARCHAR(36) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP NULL,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Cron Polling 최적화 인덱스 (핵심!)
    INDEX idx_processed_created (processed, created_at),
    INDEX idx_aggregate (aggregate_id, aggregate_type),
    INDEX idx_event_type (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**설계 포인트 (Cron Polling 최적화)**:
- `idx_processed_created`: WHERE processed=false ORDER BY created_at 쿼리 최적화
- `processed`: Debezium 대신 Cron이 처리 완료를 마킹
- `retry_count`: 재시도 횟수 추적 (실패 시 증가)

**Outbox Relay 쿼리**:
```sql
-- Cron Job에서 5초마다 실행
SELECT * FROM outbox
WHERE processed = FALSE
ORDER BY created_at ASC
LIMIT 100;
```

---

### 8. Sample Data (Development)

```sql
-- 샘플 사용자
INSERT INTO users (id, email, password_hash, name, phone) VALUES
('user-1', 'john@example.com', '$2b$10$...hashed...', 'John Doe', '010-1234-5678'),
('user-2', 'jane@example.com', '$2b$10$...hashed...', 'Jane Smith', '010-9876-5432');

-- 샘플 상품
INSERT INTO products (id, name, description, price, category) VALUES
('prod-1', 'Laptop', '15-inch powerful laptop', 1299.99, 'Electronics'),
('prod-2', 'Wireless Mouse', 'Ergonomic wireless mouse', 29.99, 'Electronics'),
('prod-3', 'Coffee Maker', 'Automatic coffee maker', 89.99, 'Home & Kitchen'),
('prod-4', 'Running Shoes', 'Comfortable running shoes', 79.99, 'Sports');

-- 샘플 재고
INSERT INTO inventory (product_id, quantity, reserved)
SELECT id, 100, 0 FROM products;
```

---

### 9. MySQL Indexes Performance Analysis

```sql
-- 인덱스 사용 통계
SELECT
    table_name,
    index_name,
    cardinality,
    seq_in_index
FROM information_schema.statistics
WHERE table_schema = 'ecommerce'
ORDER BY table_name, seq_in_index;

-- Outbox 폴링 쿼리 실행 계획
EXPLAIN SELECT * FROM outbox
WHERE processed = FALSE
ORDER BY created_at ASC
LIMIT 100;
```

**Expected Output**:
```
+----+-------------+--------+-------+-----------------------+
| id | select_type | table  | type  | key                   |
+----+-------------+--------+-------+-----------------------+
|  1 | SIMPLE      | outbox | ref   | idx_processed_created |
+----+-------------+--------+-------+-----------------------+
```

---

## ClickHouse Schema (OLAP)

### Database 생성

```sql
CREATE DATABASE IF NOT EXISTS analytics;
```

---

### 1. Orders Analytics Table

```sql
CREATE TABLE analytics.orders_analytics (
    order_id String,
    user_id String,
    user_email String,
    order_date DateTime,
    total_amount Decimal(10, 2),
    items_count UInt32,
    status String,
    payment_method String,
    payment_status String,
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(order_date)
ORDER BY (order_date, user_id, order_id);
```

**설계 포인트**:
- `ReplacingMergeTree`: 중복 제거 (같은 order_id의 최신 버전 유지)
- `PARTITION BY toYYYYMM`: 월별 파티션으로 쿼리 성능 최적화
- `ORDER BY`: 정렬 키 = Primary Index 역할

---

### 2. Materialized Views (실시간 집계)

#### Daily Sales Summary

```sql
CREATE MATERIALIZED VIEW analytics.daily_sales_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(order_date)
ORDER BY order_date
POPULATE
AS SELECT
    toDate(order_date) as order_date,
    count() as order_count,
    sum(total_amount) as total_revenue,
    avg(total_amount) as avg_order_value,
    uniq(user_id) as unique_customers
FROM analytics.orders_analytics
WHERE status IN ('PAYMENT_CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED')
GROUP BY order_date;
```

**설계 포인트**:
- `SummingMergeTree`: 자동 합산 엔진
- `POPULATE`: 기존 데이터도 집계에 포함
- `uniq()`: 고유 사용자 수 계산

---

#### Hourly Sales Summary

```sql
CREATE MATERIALIZED VIEW analytics.hourly_sales_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(order_hour)
ORDER BY order_hour
AS SELECT
    toStartOfHour(order_date) as order_hour,
    count() as order_count,
    sum(total_amount) as total_revenue,
    avg(total_amount) as avg_order_value
FROM analytics.orders_analytics
WHERE status IN ('PAYMENT_CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED')
GROUP BY order_hour;
```

---

#### Product Ranking (Top Sellers)

```sql
CREATE MATERIALIZED VIEW analytics.product_ranking_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(order_date)
ORDER BY (order_date, product_id)
AS SELECT
    toDate(order_date) as order_date,
    JSONExtractString(payload, 'product_id') as product_id,
    JSONExtractString(payload, 'product_name') as product_name,
    JSONExtractUInt(payload, 'quantity') as quantity,
    JSONExtractFloat(payload, 'price') as price,
    JSONExtractFloat(payload, 'price') * JSONExtractUInt(payload, 'quantity') as revenue
FROM analytics.orders_analytics;
```

---

### 3. Analytical Queries

#### Today's Sales Dashboard

```sql
SELECT
    order_count,
    total_revenue,
    avg_order_value,
    unique_customers
FROM analytics.daily_sales_mv
WHERE order_date = today();
```

---

#### Last 24 Hours Trend

```sql
SELECT
    toHour(order_hour) as hour,
    sum(order_count) as orders,
    sum(total_revenue) as revenue
FROM analytics.hourly_sales_mv
WHERE order_hour >= now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour;
```

---

#### Top 10 Products (Last 7 Days)

```sql
SELECT
    product_name,
    sum(quantity) as total_sold,
    sum(revenue) as total_revenue
FROM analytics.product_ranking_mv
WHERE order_date >= today() - INTERVAL 7 DAY
GROUP BY product_name
ORDER BY total_revenue DESC
LIMIT 10;
```

---

#### Sales Comparison (This Month vs Last Month)

```sql
SELECT
    toStartOfMonth(order_date) as month,
    sum(total_revenue) as revenue,
    sum(order_count) as orders
FROM analytics.daily_sales_mv
WHERE order_date >= today() - INTERVAL 2 MONTH
GROUP BY month
ORDER BY month;
```

---

## MVP Setup Scripts

### 1. MySQL Initialization

`scripts/init-mysql.sql`:
```sql
-- Drop database if exists (for clean start)
DROP DATABASE IF EXISTS ecommerce;

-- Create database
CREATE DATABASE ecommerce
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ecommerce;

-- Create all tables (copy from above)
SOURCE /path/to/mysql-schema.sql;

-- Insert sample data
SOURCE /path/to/sample-data.sql;
```

**실행**:
```bash
docker exec -i mysql mysql -u root -ptest123 < scripts/init-mysql.sql
```

---

### 2. ClickHouse Initialization

`scripts/init-clickhouse.sql`:
```sql
-- Create database
CREATE DATABASE IF NOT EXISTS analytics;

-- Create tables
CREATE TABLE analytics.orders_analytics (...);

-- Create materialized views
CREATE MATERIALIZED VIEW analytics.daily_sales_mv (...);
CREATE MATERIALIZED VIEW analytics.hourly_sales_mv (...);
CREATE MATERIALIZED VIEW analytics.product_ranking_mv (...);
```

**실행**:
```bash
docker exec -i clickhouse clickhouse-client --multiquery < scripts/init-clickhouse.sql
```

---

## Data Validation Queries

### MySQL → ClickHouse 일관성 검증

```sql
-- MySQL: 오늘 생성된 주문 수
SELECT COUNT(*) as mysql_count
FROM orders
WHERE DATE(created_at) = CURDATE();

-- ClickHouse: 오늘 적재된 주문 수
SELECT COUNT(*) as clickhouse_count
FROM analytics.orders_analytics
WHERE toDate(order_date) = today();
```

**Expected**: `mysql_count` ≈ `clickhouse_count` (5-10초 지연 허용)

---

### Outbox Processing Status

```sql
-- 미처리 이벤트 수
SELECT COUNT(*) as pending
FROM outbox
WHERE processed = FALSE;

-- 재시도가 많은 이벤트 (문제 있는 이벤트)
SELECT
    id,
    event_type,
    retry_count,
    created_at
FROM outbox
WHERE processed = FALSE AND retry_count > 3
ORDER BY retry_count DESC
LIMIT 10;
```

---

## Performance Optimization

### MySQL Optimization

```sql
-- Outbox 테이블 분석
ANALYZE TABLE outbox;

-- 인덱스 최적화
OPTIMIZE TABLE outbox;

-- 오래된 처리 완료 이벤트 삭제 (선택사항)
DELETE FROM outbox
WHERE processed = TRUE
  AND processed_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
LIMIT 1000;
```

---

### ClickHouse Optimization

```sql
-- 파티션 최적화 (병합)
OPTIMIZE TABLE analytics.orders_analytics FINAL;

-- 오래된 파티션 삭제
ALTER TABLE analytics.orders_analytics
DROP PARTITION '202301';

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

## Monitoring Queries

### MySQL Health Check

```sql
-- Connection count
SHOW STATUS LIKE 'Threads_connected';

-- Slow queries
SELECT * FROM mysql.slow_log
ORDER BY start_time DESC
LIMIT 10;

-- Table sizes
SELECT
    table_name,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
FROM information_schema.tables
WHERE table_schema = 'ecommerce'
ORDER BY size_mb DESC;
```

---

### ClickHouse Health Check

```sql
-- Table row counts
SELECT
    table,
    formatReadableSize(sum(bytes)) as size,
    sum(rows) as rows
FROM system.parts
WHERE database = 'analytics' AND active
GROUP BY table
ORDER BY sum(bytes) DESC;

-- Materialized View lag
SELECT
    name,
    last_refresh_time,
    now() - last_refresh_time as lag_seconds
FROM system.tables
WHERE database = 'analytics' AND engine LIKE '%MaterializedView%';
```

---

## Backup & Recovery

### MySQL Backup

```bash
# Full backup
docker exec mysql mysqldump -u root -ptest123 ecommerce \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# Outbox table only
docker exec mysql mysqldump -u root -ptest123 ecommerce outbox \
  > outbox_backup.sql
```

---

### ClickHouse Backup

```bash
# Freeze partition (snapshot)
docker exec clickhouse clickhouse-client --query \
  "ALTER TABLE analytics.orders_analytics FREEZE PARTITION '202410';"

# Export to file
docker exec clickhouse clickhouse-client --query \
  "SELECT * FROM analytics.orders_analytics FORMAT JSONEachRow" \
  > clickhouse_backup.json
```

---

## Schema Evolution

### Adding New Column to MySQL

```sql
-- Add new column to orders
ALTER TABLE orders
ADD COLUMN discount_amount DECIMAL(10, 2) DEFAULT 0 AFTER total_amount;

-- Update Outbox payload to include new field
-- (No schema change needed in Outbox table)
```

---

### Adding New Column to ClickHouse

```sql
-- Add new column to orders_analytics
ALTER TABLE analytics.orders_analytics
ADD COLUMN discount_amount Decimal(10, 2) DEFAULT 0;

-- Recreate Materialized View
DROP VIEW analytics.daily_sales_mv;
CREATE MATERIALIZED VIEW analytics.daily_sales_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(order_date)
ORDER BY order_date
AS SELECT
    toDate(order_date) as order_date,
    count() as order_count,
    sum(total_amount - discount_amount) as total_revenue, -- Updated
    ...
FROM analytics.orders_analytics
GROUP BY order_date;
```

---

## Troubleshooting

### Outbox 이벤트가 처리되지 않음

```sql
-- 1. 미처리 이벤트 확인
SELECT COUNT(*) FROM outbox WHERE processed = FALSE;

-- 2. Outbox Relay 로그 확인
-- docker logs nestjs-app | grep "Outbox Relay"

-- 3. 수동으로 processed 마킹 (테스트용)
UPDATE outbox SET processed = TRUE WHERE id = 123;
```

---

### ClickHouse에 데이터가 적재되지 않음

```sql
-- 1. Kafka Connect Sink 상태 확인
-- curl http://localhost:8083/connectors/clickhouse-sink-orders/status

-- 2. ClickHouse 테이블 확인
SELECT COUNT(*) FROM analytics.orders_analytics;

-- 3. 최근 적재 시간 확인
SELECT MAX(created_at) FROM analytics.orders_analytics;
```

---

## Next Steps

1. **로컬 실행**: `docker-compose up -d mysql clickhouse`
2. **스키마 초기화**: `./scripts/init-mysql.sh && ./scripts/init-clickhouse.sh`
3. **데이터 생성**: API로 주문 생성
4. **검증**: MySQL → Outbox → Kafka → ClickHouse 흐름 확인

---

## References

- [MySQL 8.0 Documentation](https://dev.mysql.com/doc/refman/8.0/en/)
- [ClickHouse Documentation](https://clickhouse.com/docs/en/)
- [ReplacingMergeTree Engine](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/replacingmergetree)
- [Materialized Views Guide](https://clickhouse.com/docs/en/guides/developer/cascading-materialized-views)
