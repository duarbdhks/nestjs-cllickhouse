.PHONY: help up down restart logs clean init-db test-pipeline

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Start all services
	docker-compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 10
	@echo "Services are up! Check status with 'make ps'"

down: ## Stop all services
	docker-compose down

restart: ## Restart all services
	docker-compose restart

logs: ## Show logs from all services
	docker-compose logs -f

ps: ## Show status of all services
	docker-compose ps

clean: ## Stop services and remove volumes
	docker-compose down -v
	@echo "All services stopped and volumes removed"

init-db: ## Initialize MySQL and ClickHouse schemas
	@echo "Initializing MySQL..."
	docker compose exec -T mysql-local mysql -u root -ptest123 < scripts/init-mysql.sql
	@echo "MySQL initialized successfully!"
	@echo ""
	@echo "Initializing ClickHouse..."
	docker compose exec -T clickhouse-local clickhouse-client --user admin --password test123 --multiquery < scripts/init-clickhouse.sql
	@echo "ClickHouse initialized successfully!"

register-connector: ## Register Kafka Connect ClickHouse Sink
	@echo "Registering ClickHouse Sink Connector..."
	curl -X POST http://localhost:8083/connectors \
	  -H "Content-Type: application/json" \
	  -d @kafka-connect/clickhouse-sink.json
	@echo ""
	@echo "Connector registered! Check status with 'make connector-status'"

connector-status: ## Check Kafka Connect connector status
	curl -s http://localhost:8083/connectors/clickhouse-sink-orders/status | jq

test-pipeline: ## Test the full data pipeline
	@echo "Testing MySQL..."
	docker compose exec mysql-local mysql -u root -ptest123 -e "SELECT COUNT(*) as order_count FROM ecommerce.orders;"
	@echo ""
	@echo "Testing Outbox..."
	docker compose exec mysql-local mysql -u root -ptest123 -e "SELECT COUNT(*) as pending FROM ecommerce.outbox WHERE processed = false;"
	@echo ""
	@echo "Testing ClickHouse..."
	docker compose exec clickhouse-local clickhouse-client --user admin --password test123 --query "SELECT COUNT(*) as count FROM analytics.orders_analytics;"
	@echo ""
	@echo "Testing Materialized Views..."
	docker compose exec clickhouse-local clickhouse-client --user admin --password test123 --query "SELECT * FROM analytics.daily_sales_mv ORDER BY order_date DESC LIMIT 5;"

kafka-topics: ## List all Kafka topics
	docker compose exec kafka-local1 kafka-topics --list --bootstrap-server kafka-local1:29092

kafka-consumer-groups: ## List all Kafka consumer groups
	docker compose exec kafka-local1 kafka-consumer-groups --list \
	  --bootstrap-server kafka-local1:29092

kafka-consumer-lag: ## Check Kafka consumer lag (usage: make kafka-consumer-lag GROUP=my-group)
	@if [ -z "$(GROUP)" ]; then \
		echo "Available consumer groups:"; \
		docker compose exec kafka-local1 kafka-consumer-groups --list --bootstrap-server kafka-local1:29092; \
		echo ""; \
		echo "Usage: make kafka-consumer-lag GROUP=<group-name>"; \
	else \
		docker compose exec kafka-local1 kafka-consumer-groups \
		  --bootstrap-server kafka-local1:29092,kafka-local2:29092,kafka-local3:29092 \
		  --group $(GROUP) --describe; \
	fi

kafka-cluster-info: ## Show Kafka cluster information
	@echo "Kafka Cluster Status:"
	@echo "====================="
	docker compose exec kafka-local1 kafka-broker-api-versions --bootstrap-server kafka-local1:29092,kafka-local2:29092,kafka-local3:29092 | grep -E "^kafka-local"

kafka-create-topic: ## Create a new Kafka topic (usage: make kafka-create-topic TOPIC=my-topic PARTITIONS=3)
	docker compose exec kafka-local1 kafka-topics --create \
	  --bootstrap-server kafka-local1:29092 \
	  --topic $(TOPIC) \
	  --partitions $(PARTITIONS) \
	  --replication-factor 3

kafka-describe-topic: ## Describe a Kafka topic (usage: make kafka-describe-topic TOPIC=my-topic)
	docker compose exec kafka-local1 kafka-topics --describe \
	  --bootstrap-server kafka-local1:29092 \
	  --topic $(TOPIC)

mysql-shell: ## Open MySQL shell
	docker compose exec mysql-local mysql -u root -ptest123 ecommerce

clickhouse-shell: ## Open ClickHouse shell
	docker compose exec clickhouse-local clickhouse-client --user admin --password test123 --database analytics

kafka-ui: ## Open Kafka UI in browser
	@echo "Opening Kafka UI at http://localhost:8080"
	@open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 2>/dev/null || echo "Please open http://localhost:8080 manually"

grafana: ## Open Grafana in browser
	@echo "Opening Grafana at http://localhost:3001 (admin/test123)"
	@open http://localhost:3001 2>/dev/null || xdg-open http://localhost:3001 2>/dev/null || echo "Please open http://localhost:3001 manually"

setup: up init-db ## Complete setup (start services + initialize databases)
	@echo ""
	@echo "=========================================="
	@echo "Setup complete!"
	@echo "=========================================="
	@echo "MySQL:          localhost:3306"
	@echo "Kafka Cluster:  localhost:19092, localhost:19093, localhost:19094"
	@echo "Kafka UI:       http://localhost:8080"
	@echo "Kafka Connect:  http://localhost:8083"
	@echo "ClickHouse:     localhost:8123 (admin/test123)"
	@echo "Grafana:        http://localhost:3001 (admin/test123)"
	@echo ""
	@echo "Grafana Dashboards:"
	@echo "  - E-Commerce Sales Analytics"
	@echo "  - Real-time Order Monitoring"
	@echo ""
	@echo "Next steps:"
	@echo "1. Register Kafka Connector: make register-connector"
	@echo "2. Test pipeline: make test-pipeline"
	@echo "3. Open Grafana: make grafana"
