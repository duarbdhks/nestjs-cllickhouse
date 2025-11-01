-- ==============================
-- MVP E-Commerce ClickHouse Schema
-- ==============================

-- Create analytics database
CREATE DATABASE IF NOT EXISTS analytics;

-- ==============================
-- 1. Orders Analytics Table
-- ==============================
CREATE TABLE IF NOT EXISTS analytics.orders_analytics (
  order_id       String,
  user_id        String,
  user_email     String,
  order_date     DateTime,
  total_amount   Decimal(10, 2),
  items_count    UInt32,
  status         String,
  payment_method String,
  payment_status String,
  created_at     DateTime DEFAULT now(),

  -- Deletion support fields
  version        UInt64,                     -- Event version for ReplacingMergeTree (Unix timestamp in milliseconds)
  event_type     String   DEFAULT 'CREATED', -- Event type: CREATED, UPDATED, DELETED
  deleted_at     Nullable(DateTime),         -- Soft delete timestamp
  is_deleted     UInt8    DEFAULT 0          -- Soft delete flag (0=active, 1=deleted)
)
  ENGINE = ReplacingMergeTree(version)
    PARTITION BY toYYYYMM(order_date)
    ORDER BY (order_date, user_id, order_id)
    TTL assumeNotNull(deleted_at) + INTERVAL 7 DAY DELETE WHERE is_deleted = 1;
-- Physical deletion 7 days after soft delete

-- ==============================
-- 2. Materialized Views
-- ==============================
-- IMPORTANT: MVs with ReplacingMergeTree source tables have limitations:
-- - MV aggregates on INSERT, before FINAL deduplication
-- - When OrderDeleted arrives, previous CREATED aggregation remains in MV
-- - Solution: Rebuild MVs periodically with FINAL query (see scripts/rebuild-mvs.sql)
-- - For accurate real-time stats, query orders_analytics FINAL directly

-- Daily Sales Summary
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.daily_sales_mv
          ENGINE = SummingMergeTree()
            PARTITION BY toYYYYMM(order_date)
            ORDER BY order_date
          -- Note: POPULATE doesn't use FINAL, so initial data may be inconsistent
          -- Run scripts/rebuild-mvs.sql after migrations or deletions
AS
SELECT toDate(order_date) as order_date,
       count()            as order_count,
       sum(total_amount)  as total_revenue,
       avg(total_amount)  as avg_order_value,
       uniq(user_id)      as unique_customers
FROM analytics.orders_analytics
WHERE status NOT IN ('cancelled', 'refunded')
  AND is_deleted = 0 -- Exclude soft-deleted orders
GROUP BY order_date;

-- Hourly Sales Summary
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.hourly_sales_mv
          ENGINE = SummingMergeTree()
            PARTITION BY toYYYYMM(order_hour)
            ORDER BY order_hour
AS
SELECT toStartOfHour(order_date) as order_hour,
       count()                   as order_count,
       sum(total_amount)         as total_revenue,
       avg(total_amount)         as avg_order_value
FROM analytics.orders_analytics
WHERE status NOT IN ('cancelled', 'refunded')
  AND is_deleted = 0 -- Exclude soft-deleted orders
GROUP BY order_hour;

-- User Analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.user_analytics_mv
          ENGINE = AggregatingMergeTree()
            PARTITION BY toYYYYMM(order_date)
            ORDER BY (user_id, order_date)
AS
SELECT user_id,
       user_email,
       toDate(order_date) as order_date,
       count()            as order_count,
       sum(total_amount)  as total_spent,
       avg(total_amount)  as avg_order_value
FROM analytics.orders_analytics
WHERE is_deleted = 0 -- Exclude soft-deleted orders
GROUP BY user_id, user_email, order_date;

-- Status Distribution (shows all statuses including cancelled/refunded)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.order_status_mv
          ENGINE = SummingMergeTree()
            PARTITION BY toYYYYMM(order_date)
            ORDER BY (order_date, status)
AS
SELECT toDate(order_date) as order_date,
       status,
       count()            as order_count,
       sum(total_amount)  as total_amount
FROM analytics.orders_analytics
WHERE is_deleted = 0 -- Exclude soft-deleted orders
GROUP BY order_date, status;

-- ==============================
-- Success message
-- ==============================
SELECT 'ClickHouse schema initialized successfully!' as status;
