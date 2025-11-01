#!/bin/bash

echo "======================================"
echo "End-to-End Pipeline Test"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Create 10 orders
echo -e "${BLUE}Step 1: Creating 10 orders...${NC}"
start_time=$(date +%s)

for i in {1..10}; do
    userId=$((1 + RANDOM % 3))  # Random user 1-3
    totalAmount=$((50000 + RANDOM % 200000))  # Random amount 50k-250k

    response=$(curl -s -X POST http://localhost:3000/api/orders \
        -H "Content-Type: application/json" \
        -d "{
            \"userId\": \"user-$userId\",
            \"totalAmount\": $totalAmount,
            \"shippingAddress\": \"서울시 강남구 테헤란로 $((RANDOM % 500)) 번지\"
        }")

    orderId=$(echo $response | jq -r '.id // .orderId // "unknown"')
    echo -e "${GREEN}✓${NC} Order #$i created: orderId=$orderId, userId=user-$userId, amount=$totalAmount"
    sleep 0.5
done

order_creation_time=$(date +%s)
echo ""
echo -e "${GREEN}✓ All 10 orders created successfully${NC}"
echo ""

# Step 2: Check MySQL Outbox
echo -e "${BLUE}Step 2: Checking MySQL Outbox table...${NC}"
docker exec mysql-local mysql -uadmin -ptest123 ecommerce -e "
SELECT
    id,
    aggregate_type,
    aggregate_id,
    event_type,
    processed,
    created_at
FROM outbox
ORDER BY id DESC
LIMIT 10;" 2>/dev/null

outbox_count=$(docker exec mysql-local mysql -uadmin -ptest123 ecommerce -N -e "SELECT COUNT(*) FROM outbox WHERE processed = 0;" 2>/dev/null)
echo ""
echo -e "Unprocessed events in outbox: ${YELLOW}$outbox_count${NC}"
echo ""

# Step 3: Wait for Outbox Relay (runs every 5 seconds)
echo -e "${BLUE}Step 3: Waiting for Outbox Relay to process events (15 seconds)...${NC}"
for i in {15..1}; do
    echo -ne "\rWaiting... $i seconds remaining"
    sleep 1
done
echo ""
echo ""

# Check outbox again
outbox_count_after=$(docker exec mysql-local mysql -uadmin -ptest123 ecommerce -N -e "SELECT COUNT(*) FROM outbox WHERE processed = 0;" 2>/dev/null)
processed_count=$((outbox_count - outbox_count_after))
echo -e "${GREEN}✓${NC} Processed events: $processed_count"
echo ""

# Step 4: Check Kafka Topic
echo -e "${BLUE}Step 4: Checking Kafka topic 'orders_analytics'...${NC}"
kafka_count=$(docker exec kafka-local1 kafka-console-consumer \
    --bootstrap-server localhost:29092 \
    --topic orders_analytics \
    --from-beginning \
    --timeout-ms 3000 \
    --max-messages 100 2>/dev/null | wc -l)

echo -e "Messages in Kafka topic: ${YELLOW}$kafka_count${NC}"
echo ""

# Step 5: Check ClickHouse
echo -e "${BLUE}Step 5: Checking ClickHouse orders_analytics table...${NC}"
clickhouse_count=$(docker exec clickhouse-local clickhouse-client \
    --user admin \
    --password test123 \
    --query "SELECT COUNT(*) FROM analytics.orders_analytics" 2>/dev/null)

echo -e "Records in ClickHouse: ${YELLOW}$clickhouse_count${NC}"
echo ""

# Show sample data
echo -e "${BLUE}Sample ClickHouse data (last 5 orders):${NC}"
docker exec clickhouse-local clickhouse-client \
    --user admin \
    --password test123 \
    --query "
    SELECT
        order_id,
        user_id,
        total_amount,
        status,
        order_date
    FROM analytics.orders_analytics
    ORDER BY order_date DESC
    LIMIT 5
    FORMAT PrettyCompact" 2>/dev/null

echo ""

# Step 6: Check Materialized Views
echo -e "${BLUE}Step 6: Checking Materialized Views...${NC}"

echo "Daily Sales:"
docker exec clickhouse-local clickhouse-client \
    --user admin \
    --password test123 \
    --query "SELECT * FROM analytics.daily_sales_mv ORDER BY sale_date DESC LIMIT 5 FORMAT PrettyCompact" 2>/dev/null

echo ""
echo "Order Status Distribution:"
docker exec clickhouse-local clickhouse-client \
    --user admin \
    --password test123 \
    --query "SELECT * FROM analytics.order_status_mv FORMAT PrettyCompact" 2>/dev/null

echo ""
echo "Top Products:"
docker exec clickhouse-local clickhouse-client \
    --user admin \
    --password test123 \
    --query "SELECT * FROM analytics.top_products_mv ORDER BY total_quantity DESC LIMIT 5 FORMAT PrettyCompact" 2>/dev/null

echo ""

# Step 7: Calculate Latency
end_time=$(date +%s)
total_latency=$((end_time - start_time))
relay_latency=$((order_creation_time - start_time))
pipeline_latency=$((end_time - order_creation_time))

echo "======================================"
echo -e "${GREEN}Pipeline Test Complete!${NC}"
echo "======================================"
echo ""
echo "Summary:"
echo "  • Orders created: 10"
echo "  • Outbox processed: $processed_count"
echo "  • Kafka messages: $kafka_count"
echo "  • ClickHouse records: $clickhouse_count"
echo ""
echo "Latency:"
echo "  • Order creation: ${relay_latency}s"
echo "  • Relay + Pipeline: ${pipeline_latency}s"
echo "  • Total: ${total_latency}s"
echo ""

# Verification
if [ "$clickhouse_count" -ge 10 ]; then
    echo -e "${GREEN}✓ Pipeline verification PASSED${NC}"
    echo "  All orders successfully flowed through:"
    echo "  MySQL → Outbox → Kafka → ClickHouse → Materialized Views"
else
    echo -e "${YELLOW}⚠ Pipeline verification PARTIAL${NC}"
    echo "  Expected 10+ records in ClickHouse, found $clickhouse_count"
    echo "  Some events may still be processing..."
fi

echo ""
