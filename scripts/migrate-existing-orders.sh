#!/bin/bash

# ======================================
# 기존 주문 마이그레이션 스크립트
# ======================================
# 목적: ClickHouse 테이블 재생성 후 MySQL의 기존 주문 데이터를 마이그레이션
# 방식: Outbox 재처리 (Outbox → Kafka → Consumer → ClickHouse)
#
# 실행: ./scripts/migrate-existing-orders.sh
# ======================================

set -e  # 에러 발생 시 즉시 중단

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  기존 주문 마이그레이션 프로세스 시작${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ======================================
# Step 1: 사전 검증
# ======================================
echo -e "${YELLOW}📌 Step 1: 사전 검증${NC}"

# MySQL 주문 수 확인
MYSQL_ORDERS=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT COUNT(*) FROM orders;" 2>/dev/null)
echo "  • MySQL 주문 수: $MYSQL_ORDERS"

# ClickHouse 현재 데이터 확인
CH_ORDERS=$(docker exec clickhouse-local clickhouse-client --user admin --password test123 -q "SELECT COUNT(*) FROM analytics.orders_analytics;" 2>/dev/null)
echo "  • ClickHouse 현재 데이터: $CH_ORDERS"

if [ "$MYSQL_ORDERS" -eq 0 ]; then
  echo -e "${RED}❌ MySQL에 주문 데이터가 없습니다. 마이그레이션을 중단합니다.${NC}"
  exit 1
fi

echo -e "${GREEN}✅ 사전 검증 완료${NC}"
echo ""

# ======================================
# Step 2: Kafka Connect Connector 등록
# ======================================
echo -e "${YELLOW}📌 Step 2: Kafka Connect Connector 등록${NC}"

# Connector 삭제 (기존 Connector가 있을 경우)
curl -s -X DELETE http://localhost:8083/connectors/clickhouse-sink-orders >/dev/null 2>&1 || true
sleep 2

# Connector 등록
CONNECTOR_RESPONSE=$(curl -s -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @kafka-connect/clickhouse-sink.json)

# 등록 결과 확인
if echo "$CONNECTOR_RESPONSE" | grep -q "clickhouse-sink-orders"; then
  echo -e "${GREEN}✅ Kafka Connect Connector 등록 완료${NC}"
else
  echo -e "${RED}❌ Connector 등록 실패:${NC}"
  echo "$CONNECTOR_RESPONSE"
  exit 1
fi

sleep 5

# Connector 상태 확인
CONNECTOR_STATE=$(curl -s http://localhost:8083/connectors/clickhouse-sink-orders/status | python3 -c "import sys, json; print(json.load(sys.stdin)['connector']['state'])" 2>/dev/null || echo "UNKNOWN")
echo "  • Connector 상태: $CONNECTOR_STATE"

if [ "$CONNECTOR_STATE" != "RUNNING" ]; then
  echo -e "${YELLOW}⚠️  Warning: Connector가 RUNNING 상태가 아닙니다. 계속 진행합니다...${NC}"
fi

echo ""

# ======================================
# Step 3: Outbox processed 플래그 리셋
# ======================================
echo -e "${YELLOW}📌 Step 3: Outbox processed 플래그 리셋${NC}"

# OrderCreated와 OrderDeleted 이벤트 리셋
docker exec -i mysql-local mysql -uadmin -ptest123 ecommerce <<EOF
UPDATE outbox SET processed = 0 WHERE event_type IN ('OrderCreated', 'OrderDeleted');
EOF

# 리셋된 이벤트 수 확인
UNPROCESSED=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT COUNT(*) FROM outbox WHERE processed = 0;" 2>/dev/null)
echo -e "${GREEN}✅ Outbox 리셋 완료: ${UNPROCESSED}개 이벤트${NC}"

# 이벤트 타입별 카운트
echo ""
echo "  이벤트 타입별 분포:"
docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -e "
SELECT
  event_type,
  COUNT(*) as count
FROM outbox
WHERE processed = 0
GROUP BY event_type;
" 2>/dev/null

echo ""

# ======================================
# Step 4: 처리 진행 모니터링
# ======================================
echo -e "${YELLOW}📌 Step 4: 마이그레이션 진행 모니터링${NC}"
echo ""
echo "  Outbox Relay가 5초마다 이벤트를 Kafka로 전송합니다..."
echo "  진행 상황을 10초마다 확인합니다."
echo ""
echo "  시간        | Outbox 미처리 | ClickHouse 레코드"
echo "  -----------|---------------|------------------"

START_TIME=$(date +%s)
TIMEOUT=600  # 10분 타임아웃

for i in {1..60}; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))

  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo ""
    echo -e "${RED}❌ 타임아웃: 10분 초과. 수동 확인이 필요합니다.${NC}"
    exit 1
  fi

  UNPROCESSED=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT COUNT(*) FROM outbox WHERE processed = 0;" 2>/dev/null)
  CH_COUNT=$(docker exec clickhouse-local clickhouse-client --user admin --password test123 -q "SELECT COUNT(*) FROM analytics.orders_analytics;" 2>/dev/null)

  TIMESTAMP=$(date +'%H:%M:%S')
  printf "  %-10s | %-13s | %-17s\n" "$TIMESTAMP" "$UNPROCESSED" "$CH_COUNT"

  # 모든 이벤트가 처리되면 종료
  if [ "$UNPROCESSED" -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ 모든 이벤트가 처리되었습니다!${NC}"
    break
  fi

  sleep 10
done

echo ""

# ======================================
# Step 5: 최종 검증
# ======================================
echo -e "${YELLOW}📌 Step 5: 최종 검증${NC}"
echo ""

# ClickHouse 데이터 검증
docker exec clickhouse-local clickhouse-client --user admin --password test123 <<EOF
SELECT
  'Total Orders' as metric,
  COUNT(*) as count
FROM analytics.orders_analytics
UNION ALL
SELECT
  'Active Orders (is_deleted=0)',
  COUNT(*)
FROM analytics.orders_analytics
WHERE is_deleted = 0
UNION ALL
SELECT
  'Deleted Orders (is_deleted=1)',
  COUNT(*)
FROM analytics.orders_analytics
WHERE is_deleted = 1
UNION ALL
SELECT
  'OrderCreated Events',
  COUNT(*)
FROM analytics.orders_analytics
WHERE event_type = 'CREATED'
UNION ALL
SELECT
  'OrderDeleted Events',
  COUNT(*)
FROM analytics.orders_analytics
WHERE event_type = 'DELETED'
FORMAT PrettyCompact;
EOF

echo ""

# MySQL vs ClickHouse 비교
echo "📊 MySQL vs ClickHouse 데이터 일치성 검증:"
echo ""

MYSQL_TOTAL=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT COUNT(*) FROM orders;" 2>/dev/null)
CH_TOTAL=$(docker exec clickhouse-local clickhouse-client --user admin --password test123 -q "SELECT COUNT(DISTINCT order_id) FROM analytics.orders_analytics;" 2>/dev/null)

echo "  • MySQL 주문 수: $MYSQL_TOTAL"
echo "  • ClickHouse 주문 수: $CH_TOTAL"

if [ "$MYSQL_TOTAL" -eq "$CH_TOTAL" ]; then
  echo -e "${GREEN}✅ 데이터 일치 확인!${NC}"
else
  echo -e "${YELLOW}⚠️  Warning: 데이터 수가 일치하지 않습니다. 추가 확인이 필요합니다.${NC}"
fi

echo ""

# Materialized View 확인
echo "📊 Materialized Views 상태:"
echo ""

docker exec clickhouse-local clickhouse-client --user admin --password test123 <<EOF
SELECT
  'Daily Sales MV' as view_name,
  COUNT(*) as row_count
FROM analytics.daily_sales_mv
UNION ALL
SELECT
  'Hourly Sales MV',
  COUNT(*)
FROM analytics.hourly_sales_mv
UNION ALL
SELECT
  'Order Status MV',
  COUNT(*)
FROM analytics.order_status_mv
UNION ALL
SELECT
  'User Analytics MV',
  COUNT(*)
FROM analytics.user_analytics_mv
FORMAT PrettyCompact;
EOF

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 마이그레이션 완료!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
