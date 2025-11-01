# Materialized Views와 삭제된 주문 처리 - 문제 분석 및 해결

## 🔍 발견된 문제

### 1. ClickHouseService getOverallStats() 부정확한 집계
**증상**: 삭제된 주문이 집계에 포함됨
- 기대: 92개 주문 (MySQL active orders)
- 실제: 96개 주문 (삭제된 주문 4개 포함)

**원인**: ReplacingMergeTree의 버전 관리 메커니즘을 이해하지 못함
```sql
-- 잘못된 쿼리
SELECT count() FROM analytics.orders_analytics WHERE is_deleted = 0
-- 96개 반환 (CREATED 버전 4개 + 활성 주문 92개)

-- 올바른 쿼리
SELECT count() FROM analytics.orders_analytics FINAL WHERE is_deleted = 0
-- 92개 반환 (FINAL이 최신 버전만 선택)
```

**데이터 구조 분석**:
- 107 total rows:
  - 92 orders: CREATED 버전만 (활성 주문)
  - 7 orders: DELETED 버전만 (마이그레이션 전 삭제)
  - 4 orders: CREATED + DELETED 버전 모두 (마이그레이션 후 삭제)
- 103 unique order_ids
- FINAL 적용 시: 92 active orders

**해결**: backend/src/clickhouse/clickhouse.service.ts:132
```typescript
// Before
FROM analytics.orders_analytics
WHERE is_deleted = 0

// After
FROM analytics.orders_analytics FINAL
WHERE is_deleted = 0
```

### 2. Materialized Views 구조적 한계
**증상**: MV가 103개 주문을 표시 (92개여야 함)

**근본 원인**: ReplacingMergeTree와 Materialized Views의 불일치
1. OrderCreated 이벤트 INSERT → MV가 집계에 추가 (is_deleted=0 통과)
2. OrderDeleted 이벤트 INSERT → `WHERE is_deleted = 0` 필터에 걸려 MV 업데이트 안 됨
3. 이전 CREATED 집계가 MV에 그대로 남음
4. SummingMergeTree는 이전 집계를 "취소"할 수 없음

**시도한 해결책들**:
- ❌ POPULATE with FINAL: POPULATE는 FINAL을 무시함
- ❌ MV 재생성: 내부 .inner 테이블이 남아있음
- ❌ .inner 테이블 삭제 후 재생성: 여전히 잘못된 데이터

**최종 해결책**: 수동 재구축 스크립트
- `scripts/rebuild-mvs.sql` 생성
- MV 삭제 → 재생성 → FINAL 쿼리로 수동 INSERT
- 결과: 모든 MV가 92개 주문으로 정확히 일치

## ✅ 적용된 수정사항

### 1. backend/src/clickhouse/clickhouse.service.ts
```typescript
async getOverallStats(): Promise<any> {
  const query = `
      SELECT count()           as total_orders,
             sum(total_amount) as total_revenue,
             avg(total_amount) as avg_order_value,
             uniq(user_id)     as unique_customers
      FROM analytics.orders_analytics FINAL  // ← FINAL 추가
      WHERE is_deleted = 0
  `;
  // ... rest of code
}
```

### 2. scripts/init-clickhouse.sql
- MV와 ReplacingMergeTree 한계 문서화
- POPULATE의 동작 방식 경고 추가
- `scripts/rebuild-mvs.sql` 참조 추가

### 3. scripts/rebuild-mvs.sql (신규 생성)
- 모든 MV 삭제 및 재생성
- FINAL 쿼리로 올바른 데이터 초기화
- 자동 검증 포함

## 📊 검증 결과

### 직접 쿼리 (올바른 방법)
```sql
SELECT COUNT(*) FROM analytics.orders_analytics FINAL WHERE is_deleted = 0;
-- Result: 92 orders, 69,485,004.05 revenue
```

### Materialized Views (재구축 후)
```
Daily Sales MV:     92 orders, 69,485,004.05 revenue ✅
Hourly Sales MV:    92 orders, 69,485,004.05 revenue ✅
Order Status MV:    92 orders, 69,485,004.05 revenue ✅
User Analytics MV:  92 orders, 69,485,004.05 revenue ✅
```

### MySQL 비교
```sql
SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL;
-- Result: 92 orders ✅
```

## 🔧 사용 가이드

### MV 재구축이 필요한 시점
1. 주문 삭제 후 MV가 잘못된 집계를 보일 때
2. 데이터 마이그레이션 후
3. 정기적인 데이터 정합성 확인 필요 시

### 실행 방법
```bash
docker exec -i clickhouse-local clickhouse-client --user admin --password test123 < scripts/rebuild-mvs.sql
```

### 예상 소요 시간
- 데이터 100개 기준: ~1-2초
- 데이터 10,000개 기준: ~10-30초

## 📝 향후 개선 방안

### Option 1: 정기적 재구축 (현재 권장)
- Cron job으로 daily/weekly 재구축
- 간단하고 안정적
- 약간의 데이터 지연 허용

### Option 2: Consumer Layer 개선
- OrderDeleted 이벤트 시 "negative aggregation" 전송
- MV가 이전 집계를 차감
- 복잡하지만 실시간 정확도 유지

### Option 3: Event Sourcing 재설계
- CREATED/DELETED 대신 final state만 전송
- MV 문제 근본 해결
- 감사 추적(audit trail) 기능 상실

### Option 4: Regular Table + Scheduled Refresh
- MV 대신 일반 테이블 사용
- Scheduled job으로 FINAL 쿼리 결과 저장
- 더 예측 가능하지만 "Materialized View"는 아님

## 🎯 핵심 교훈

1. **ReplacingMergeTree는 항상 FINAL과 함께 사용**
   - 버전 관리된 데이터는 FINAL 없이 쿼리하면 중복 발생

2. **MV는 INSERT 시점에 집계, FINAL 적용 전**
   - MV + ReplacingMergeTree = 구조적 불일치

3. **MVP에서는 단순한 솔루션 우선**
   - 복잡한 실시간 동기화보다 정기적 재구축이 실용적

4. **문서화가 중요**
   - 한계를 명확히 문서화하여 향후 혼란 방지

## 📌 관련 파일

- `backend/src/clickhouse/clickhouse.service.ts:126-143` - getOverallStats() 수정
- `scripts/init-clickhouse.sql:35-60` - MV 한계 문서화
- `scripts/rebuild-mvs.sql` - MV 재구축 스크립트
- `scripts/migrate-existing-orders.sh` - 기존 주문 마이그레이션 스크립트
