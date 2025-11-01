-- ======================================
-- Materialized Views 재구축 스크립트
-- ======================================
-- 목적: ReplacingMergeTree와 MV의 불일치 해결
-- 실행: docker exec clickhouse-local clickhouse-client --user admin --password test123 < scripts/rebuild-mvs.sql
--
-- 필요 시점:
-- - 주문 삭제 후 MV가 잘못된 집계를 보일 때
-- - 데이터 마이그레이션 후
-- - 정기적인 데이터 정합성 확인 필요 시
-- ======================================

-- Step 1: 기존 MV 삭제
DROP TABLE IF EXISTS analytics.daily_sales_mv;
DROP TABLE IF EXISTS analytics.hourly_sales_mv;
DROP TABLE IF EXISTS analytics.order_status_mv;
DROP TABLE IF EXISTS analytics.user_analytics_mv;

-- Step 2: Daily Sales MV 재생성 및 FINAL 데이터로 초기화
CREATE MATERIALIZED VIEW analytics.daily_sales_mv
          ENGINE = SummingMergeTree()
            PARTITION BY toYYYYMM(order_date)
            ORDER BY order_date
AS
SELECT toDate(order_date) as order_date,
       count()            as order_count,
       sum(total_amount)  as total_revenue,
       avg(total_amount)  as avg_order_value,
       uniq(user_id)      as unique_customers
FROM analytics.orders_analytics
WHERE status NOT IN ('cancelled', 'refunded')
  AND is_deleted = 0
GROUP BY order_date;

-- 올바른 데이터로 초기화 (FINAL 사용)
INSERT INTO analytics.daily_sales_mv
SELECT toDate(order_date) as order_date,
       count()            as order_count,
       sum(total_amount)  as total_revenue,
       avg(total_amount)  as avg_order_value,
       uniq(user_id)      as unique_customers
FROM analytics.orders_analytics FINAL
WHERE status NOT IN ('cancelled', 'refunded')
  AND is_deleted = 0
GROUP BY order_date;

-- Step 3: Hourly Sales MV 재생성
CREATE MATERIALIZED VIEW analytics.hourly_sales_mv
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
  AND is_deleted = 0
GROUP BY order_hour;

INSERT INTO analytics.hourly_sales_mv
SELECT toStartOfHour(order_date) as order_hour,
       count()                   as order_count,
       sum(total_amount)         as total_revenue,
       avg(total_amount)         as avg_order_value
FROM analytics.orders_analytics FINAL
WHERE status NOT IN ('cancelled', 'refunded')
  AND is_deleted = 0
GROUP BY order_hour;

-- Step 4: Order Status MV 재생성
CREATE MATERIALIZED VIEW analytics.order_status_mv
          ENGINE = SummingMergeTree()
            PARTITION BY toYYYYMM(order_date)
            ORDER BY (order_date, status)
AS
SELECT toDate(order_date) as order_date,
       status,
       count()            as order_count,
       sum(total_amount)  as total_amount
FROM analytics.orders_analytics
WHERE is_deleted = 0
GROUP BY order_date, status;

INSERT INTO analytics.order_status_mv
SELECT toDate(order_date) as order_date,
       status,
       count()            as order_count,
       sum(total_amount)  as total_amount
FROM analytics.orders_analytics FINAL
WHERE is_deleted = 0
GROUP BY order_date, status;

-- Step 5: User Analytics MV 재생성
CREATE MATERIALIZED VIEW analytics.user_analytics_mv
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
WHERE is_deleted = 0
GROUP BY user_id, user_email, order_date;

INSERT INTO analytics.user_analytics_mv
SELECT user_id,
       user_email,
       toDate(order_date) as order_date,
       count()            as order_count,
       sum(total_amount)  as total_spent,
       avg(total_amount)  as avg_order_value
FROM analytics.orders_analytics FINAL
WHERE is_deleted = 0
GROUP BY user_id, user_email, order_date;

-- Step 6: 검증
SELECT '=== Materialized Views 재구축 완료 ===' as status;
SELECT '' as blank;

SELECT 'Daily Sales MV' as view_name, SUM(order_count) as total_orders, SUM(total_revenue) as total_revenue
FROM analytics.daily_sales_mv
UNION ALL
SELECT 'Hourly Sales MV', SUM(order_count), SUM(total_revenue)
FROM analytics.hourly_sales_mv
UNION ALL
SELECT 'Order Status MV', SUM(order_count), SUM(total_amount)
FROM analytics.order_status_mv
UNION ALL
SELECT 'User Analytics MV', SUM(order_count), SUM(total_spent)
FROM analytics.user_analytics_mv
  FORMAT PrettyCompact;

SELECT '' as blank;
SELECT 'Expected (from orders_analytics FINAL):' as comparison;
SELECT COUNT(*)          as total_orders,
       SUM(total_amount) as total_revenue
FROM analytics.orders_analytics FINAL
WHERE is_deleted = 0
  FORMAT PrettyCompact;
