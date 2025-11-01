# user-1 주문 삭제 작업 완료 보고서

## 📋 작업 개요

**목적**: user-1의 모든 주문을 AdminOrdersController의 deleteOrder API를 통해 soft delete 처리

**실행 일시**: 2025-10-31
**담당 Admin ID**: 09d5f0cf-7881-4f6a-bbf1-ba328750d857

## ✅ 작업 결과

### 삭제 실행 결과
- **삭제 대상**: user-1의 활성 주문 37개
- **성공**: 37개 (100%)
- **실패**: 0개
- **API 엔드포인트**: `DELETE /api/admin/orders/:id`
- **인증 헤더**: `X-Admin-Id: 09d5f0cf-7881-4f6a-bbf1-ba328750d857`

### user-1 주문 현황
```
전체 주문:      41개
├─ 활성 주문:   0개 ✅
└─ 삭제 주문:   41개
   ├─ 기존 삭제: 4개 (마이그레이션 전)
   └─ 금일 삭제: 37개 (AdminOrdersController 사용)
```

## 📊 시스템 전체 상태

### MySQL (Source of Truth)
```
전체 주문:      103개
├─ 활성 주문:   55개
└─ 삭제 주문:   48개
```

### ClickHouse (Analytics)
```
orders_analytics FINAL:
├─ 활성 주문:   55개 ✅
└─ 삭제 주문:   48개 ✅

Materialized Views (재구축 완료):
├─ Daily Sales MV:    55 orders, 50,823,512.42원 ✅
├─ Hourly Sales MV:   55 orders, 50,823,512.42원 ✅
├─ Order Status MV:   55 orders, 50,823,512.42원 ✅
└─ User Analytics MV: 55 orders, 50,823,512.42원 ✅
```

### user별 분포
| User ID | 전체 주문 | 활성 주문 | 삭제 주문 |
|---------|-----------|-----------|-----------|
| user-1  | 41        | 0         | 41        |
| user-2  | 28        | 24        | 4         |
| user-3  | 34        | 31        | 3         |
| **합계** | **103**   | **55**    | **48**    |

## 🔄 데이터 파이프라인 처리 흐름

### 1. API 호출 → MySQL (즉시)
```
DELETE /api/admin/orders/:id (37회)
→ orders.deleted_at = NOW()
→ outbox.event_type = 'OrderDeleted' (37개 이벤트 생성)
```

### 2. Outbox → Kafka (<5초)
```
Outbox Relay (Cron 5초)
→ 37개 OrderDeleted 이벤트
→ Kafka topic: order.events
→ outbox.processed = 1
```

### 3. Kafka → ClickHouse (실시간)
```
Kafka Consumer
→ OrderDeleted 이벤트 변환
  {
    order_id, user_id, event_type: 'DELETED',
    is_deleted: 1, deleted_at, version: timestamp
  }
→ analytics.orders_analytics 테이블 INSERT
```

### 4. Materialized Views 재구축 (수동)
```bash
docker exec -i clickhouse-local clickhouse-client --user admin --password test123 \
  < scripts/rebuild-mvs.sql
```

**이유**: ReplacingMergeTree와 MV의 구조적 불일치로 인해 삭제 이벤트가 MV에 제대로 반영되지 않음

## 🛠️ 사용된 도구 및 스크립트

### 1. scripts/delete-user1-orders.sh (신규 생성)
**기능**:
- user-1의 모든 활성 주문 조회
- AdminOrdersController API 호출 (37회)
- 삭제 결과 검증 (MySQL, Outbox)
- 실행 로그 및 결과 요약

**실행 방법**:
```bash
./scripts/delete-user1-orders.sh
# 또는
echo "y" | ./scripts/delete-user1-orders.sh  # 자동 실행
```

### 2. scripts/rebuild-mvs.sql (기존)
**기능**:
- 모든 Materialized Views 삭제
- FINAL 쿼리로 올바른 데이터 초기화
- 자동 검증

**실행 방법**:
```bash
docker exec -i clickhouse-local clickhouse-client --user admin --password test123 \
  < scripts/rebuild-mvs.sql
```

## 📝 작업 단계

1. ✅ **user-1 주문 조회**: MySQL에서 37개 활성 주문 확인
2. ✅ **삭제 스크립트 생성**: `scripts/delete-user1-orders.sh` 작성
3. ✅ **API 호출 실행**: 37개 주문 삭제 (모두 HTTP 204 성공)
4. ✅ **Outbox 처리 확인**: 37개 OrderDeleted 이벤트 Kafka 전송
5. ✅ **ClickHouse 검증**: orders_analytics에 삭제 이벤트 반영
6. ✅ **MV 재구축**: 모든 Materialized Views 정확한 집계 반영
7. ✅ **최종 검증**: MySQL ↔ ClickHouse 데이터 일치 확인

## 🔍 데이터 일치성 검증

### 활성 주문 수 (55개)
```
MySQL:           55 ✅
ClickHouse FINAL: 55 ✅
Daily Sales MV:   55 ✅
Hourly Sales MV:  55 ✅
Order Status MV:  55 ✅
User Analytics MV: 55 ✅
```

### 삭제 주문 수 (48개)
```
MySQL:           48 ✅
ClickHouse FINAL: 48 ✅
```

### 총 매출 (활성 주문만)
```
모든 소스: 50,823,512.42원 ✅
```

## 🎯 핵심 성과

1. **데이터 정합성 100%**: MySQL과 ClickHouse 완전 일치
2. **API 성공률 100%**: 37개 주문 모두 성공적으로 삭제
3. **파이프라인 지연 <5초**: Outbox → Kafka → ClickHouse 실시간 처리
4. **MV 재구축 <2초**: 4개 Materialized Views 정확한 집계 반영
5. **자동화 스크립트**: 향후 유사 작업 재사용 가능

## 📌 중요 참고사항

### ReplacingMergeTree 특성
- user-1의 일부 주문은 **2개 버전** 보유 (CREATED + DELETED)
- FINAL modifier 없이 쿼리 시 중복 집계 발생 가능
- **항상 FINAL 사용 필수**: `FROM orders_analytics FINAL WHERE is_deleted = 0`

### Materialized Views 한계
- MV는 INSERT 시점에 집계 (FINAL 적용 전)
- OrderDeleted 이벤트는 `is_deleted=1`이므로 MV에 반영 안 됨
- **해결**: 대량 삭제 후 `scripts/rebuild-mvs.sql` 실행

### TTL (Time To Live)
- 삭제된 주문은 `deleted_at + 7일` 후 ClickHouse에서 물리 삭제
- MySQL은 영구 보관 (soft delete)

## 🔗 관련 파일

- `scripts/delete-user1-orders.sh` - user-1 주문 삭제 스크립트 (신규)
- `scripts/rebuild-mvs.sql` - Materialized Views 재구축 스크립트
- `backend/src/order/admin/admin-orders.controller.ts` - Admin 삭제 API
- `backend/src/order/order.service.ts:126-165` - deleteOrder 메서드
- `claudedocs/mv-deletion-fix-summary.md` - MV 문제 분석 및 해결 과정

## 📊 삭제된 주문 목록

<details>
<summary>37개 주문 ID 전체 목록 (클릭하여 펼치기)</summary>

1. 00ba5a7d-819a-43bf-bfb6-cbca4aa529bb
2. 03ddc4c0-af3b-423c-9cc5-a65285c6ecd8
3. 123236e5-49d2-401a-a96d-ffa21823af23
4. 12bfefaf-0c6d-43eb-8717-ed73f3439b77
5. 1ba5c65b-87fc-4345-a9e6-538272cc6d16
6. 1e5e5645-3c35-43df-9d6e-04adb404176e
7. 21ea300f-061f-4efb-be8b-381755dd48d3
8. 25947bd4-a086-4afb-b1e9-a3a5e78c5262
9. 2e64d602-8192-4829-91ac-d3b79acc0010
10. 2eeca3a7-ca36-444e-b914-e0dc3306e532
11. 358915c3-aca1-48de-9b0f-6fab70ed15a1
12. 3bbd9717-5397-43f0-8873-c486b6ef2370
13. 45839ab8-9ff9-4a32-be1a-c93252ef69ce
14. 45c67242-5c0d-4e9e-9973-082bd1fcf425
15. 498cec18-9947-4172-a639-1ba44a7016e8
16. 50bcfd86-a8dc-4f6f-9fb9-e7763a85d91e
17. 52e1fe61-a2f4-402f-8cf1-3f3dd7009816
18. 55e1d70c-7806-4784-b703-a3d70a8c56fb
19. 5e20af5e-a091-477d-b3f7-f1e1e52c38b0
20. 5ea0af30-c9f8-482d-9a0f-02a4d6c9bb3f
21. 64ec0795-8ac4-4ac3-96b6-85452d002838
22. 68780690-d54f-4a18-8098-15e8854c8d09
23. 6d08dfda-d114-4e07-8254-08bd7e1fd4f8
24. 76395f7b-66f1-4230-86cd-01890835b7fb
25. 7762c4e3-5ff6-49e9-9a12-34d85786ab98
26. 7a7792d3-b5a9-4c6d-972f-a15940cd1982
27. 7bf75596-c532-4952-b267-12afef0e80dd
28. 7e9faabb-ba93-4a27-abe7-7ff4b0414645
29. 978cb84a-16cb-4991-9553-e8494d165967
30. 9d1153e6-add3-46f2-b779-c1654f6a416e
31. a66c788c-503f-4003-bd40-f46a1710ac79
32. a9d976c2-5a73-4232-af97-b783595507ef
33. aced8261-a3ae-46e1-8aba-67e9ffcb54b8
34. aff19b7c-b6b4-4456-9d46-f8695469b4dd
35. b063919f-1e03-43b2-a1aa-3dafb85b9746
36. b222baf4-5820-4753-a6a7-c8e84c121d54
37. d63afd83-0b24-42c3-bc8b-cbc7acb180be

</details>
