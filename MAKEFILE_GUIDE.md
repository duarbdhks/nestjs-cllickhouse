# Makefile 명령어 가이드

## 빠른 시작
```bash
make setup              # 전체 시작 + DB 초기화
make register-connector # Kafka Connector 등록
make test-pipeline      # 파이프라인 테스트
make grafana           # Grafana 열기
```

## 서비스 관리
```bash
make up        # 서비스 시작
make down      # 서비스 중지
make restart   # 재시작
make ps        # 상태 확인
make logs      # 로그 보기
make clean     # 전체 삭제 (볼륨 포함)
```

## 데이터베이스
```bash
make init-db         # MySQL + ClickHouse 초기화
make mysql-shell     # MySQL 쉘 접속
make clickhouse-shell # ClickHouse 쉘 접속
```

## Kafka
```bash
make kafka-topics                              # 토픽 목록
make kafka-consumer-groups                     # 컨슈머 그룹 목록
make kafka-consumer-lag GROUP=그룹명           # Lag 확인
make kafka-cluster-info                        # 클러스터 정보
make kafka-create-topic TOPIC=이름 PARTITIONS=3 # 토픽 생성
make kafka-describe-topic TOPIC=이름           # 토픽 상세
```

## Kafka Connect
```bash
make register-connector # Connector 등록
make connector-status   # 상태 확인
```

## 모니터링
```bash
make kafka-ui  # Kafka UI (localhost:8080)
make grafana   # Grafana (localhost:3001, admin/test123)
```

## 테스트
```bash
make test-pipeline # MySQL → Kafka → ClickHouse 전체 테스트
```

## 접속 정보
- **MySQL**: localhost:3306 (root/test123)
- **Kafka**: localhost:19092, 19093, 19094
- **Kafka UI**: http://localhost:8080
- **Kafka Connect**: http://localhost:8083
- **ClickHouse**: localhost:8123 (admin/test123)
- **Grafana**: http://localhost:3001 (admin/test123)

## Grafana 대시보드
1. **E-Commerce Sales Analytics** - 매출 분석 (30일)
2. **Real-time Order Monitoring** - 실시간 주문 모니터링 (10초 자동 새로고침)

## 전체 워크플로우
```bash
make setup              # 1. 시작
make register-connector # 2. Connector 등록
make connector-status   # 3. 상태 확인
make test-pipeline      # 4. 테스트
make grafana           # 5. 대시보드 확인
```

## 유용한 쿼리

### MySQL
```sql
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;
SELECT * FROM outbox WHERE processed = false;
```

### ClickHouse
```sql
SELECT * FROM orders_analytics ORDER BY order_date DESC LIMIT 10;
SELECT * FROM daily_sales_mv ORDER BY order_date DESC LIMIT 7;
SELECT * FROM hourly_sales_mv WHERE order_hour >= now() - INTERVAL 24 HOUR;
```
