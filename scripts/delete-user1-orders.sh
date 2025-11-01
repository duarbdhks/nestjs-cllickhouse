#!/bin/bash

# ======================================
# user-1 주문 삭제 스크립트
# ======================================
# 목적: user-1의 모든 주문을 AdminOrdersController로 soft delete
# API: DELETE /api/admin/orders/:id
# ======================================

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Admin ID 설정
ADMIN_ID="09d5f0cf-7881-4f6a-bbf1-ba328750d857"
API_BASE="http://localhost:3000/api"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  user-1 주문 삭제 프로세스 시작${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Step 1: user-1의 주문 목록 조회
echo -e "${YELLOW}📌 Step 1: user-1의 주문 목록 조회${NC}"
ORDER_IDS=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT id FROM orders WHERE user_id = 'user-1' AND deleted_at IS NULL;" 2>/dev/null)

# 배열로 변환
ORDER_ARRAY=($ORDER_IDS)
TOTAL_ORDERS=${#ORDER_ARRAY[@]}

echo "  • 삭제 대상 주문 수: $TOTAL_ORDERS"
echo ""

if [ $TOTAL_ORDERS -eq 0 ]; then
  echo -e "${YELLOW}⚠️  삭제할 주문이 없습니다.${NC}"
  exit 0
fi

# Step 2: 삭제 확인
echo -e "${YELLOW}⚠️  Warning: $TOTAL_ORDERS개의 주문을 삭제하려고 합니다.${NC}"
echo -e "${YELLOW}   계속하시겠습니까? (y/N)${NC}"
read -r CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo -e "${YELLOW}삭제가 취소되었습니다.${NC}"
  exit 0
fi

echo ""

# Step 3: 각 주문 삭제
echo -e "${YELLOW}📌 Step 2: API를 통한 주문 삭제${NC}"
echo ""

SUCCESS_COUNT=0
FAIL_COUNT=0

for ORDER_ID in "${ORDER_ARRAY[@]}"; do
  # API 호출
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE \
    -H "X-Admin-Id: $ADMIN_ID" \
    "$API_BASE/admin/orders/$ORDER_ID")

  if [ "$HTTP_CODE" -eq 204 ]; then
    echo -e "  ✅ Order $ORDER_ID deleted (HTTP $HTTP_CODE)"
    ((SUCCESS_COUNT++))
  else
    echo -e "  ${RED}❌ Order $ORDER_ID failed (HTTP $HTTP_CODE)${NC}"
    ((FAIL_COUNT++))
  fi
done

echo ""

# Step 4: 결과 요약
echo -e "${YELLOW}📌 Step 3: 삭제 결과 요약${NC}"
echo "  • 성공: $SUCCESS_COUNT"
echo "  • 실패: $FAIL_COUNT"
echo "  • 총계: $TOTAL_ORDERS"
echo ""

# Step 5: DB 검증
echo -e "${YELLOW}📌 Step 4: 데이터베이스 검증${NC}"
echo ""

# MySQL 검증
REMAINING_ORDERS=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT COUNT(*) FROM orders WHERE user_id = 'user-1' AND deleted_at IS NULL;" 2>/dev/null)
DELETED_ORDERS=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT COUNT(*) FROM orders WHERE user_id = 'user-1' AND deleted_at IS NOT NULL;" 2>/dev/null)

echo "  MySQL:"
echo "    • 남은 활성 주문: $REMAINING_ORDERS"
echo "    • 삭제된 주문: $DELETED_ORDERS"
echo ""

# Outbox 확인
UNPROCESSED=$(docker exec mysql-local mysql -uadmin -ptest123 -D ecommerce -Nse "SELECT COUNT(*) FROM outbox WHERE processed = 0 AND event_type = 'OrderDeleted';" 2>/dev/null)
echo "  Outbox:"
echo "    • 미처리 OrderDeleted 이벤트: $UNPROCESSED"
echo ""

if [ $REMAINING_ORDERS -eq 0 ] && [ $DELETED_ORDERS -eq $TOTAL_ORDERS ]; then
  echo -e "${GREEN}✅ 모든 주문이 성공적으로 삭제되었습니다!${NC}"
else
  echo -e "${YELLOW}⚠️  Warning: 일부 주문이 삭제되지 않았을 수 있습니다.${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 삭제 프로세스 완료!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "  1. Outbox Relay가 5초마다 이벤트를 Kafka로 전송합니다"
echo "  2. Kafka Consumer가 ClickHouse로 전송합니다"
echo "  3. 삭제가 완료된 후 Materialized Views 재구축:"
echo "     ${GREEN}docker exec -i clickhouse-local clickhouse-client --user admin --password test123 < scripts/rebuild-mvs.sql${NC}"
echo ""
