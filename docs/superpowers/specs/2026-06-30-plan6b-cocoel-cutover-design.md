# Plan 6b — 코코엘 스마트스토어 sync.js → sync-worker 컷오버 디자인 문서

> SaaS sync-worker가 코코엘 스마트스토어 운영을 인수. 옛 `order-manager/server/sync.js`의 COCOEL 분기 disable. 팔레오는 Plan 5b까지 옛 sync.js로 유지.

## 1. 목표 & 범위

- **목표**: 코코엘 스마트스토어 운영을 옛 sync.js cron → SaaS sync-worker로 단일화. 옛 sync.js의 COCOEL 분기만 disable, 팔레오/도깨비나라(PALEO/DOKEBI)는 유지.
- **범위 (In)**:
  - SaaS UI에서 코코엘 자격증명 등록 (별칭 `스마트스토어` + COCOEL_APP_ID/SECRET)
  - 검증 sync (manual enqueue + 옛 데이터와 일치 확인)
  - 옛 `server/sync.js`의 SMARTSTORE_TARGETS 배열에서 COCOEL 행 주석 + 가상서버 반영
  - 가상서버에서 옛 sync.js cron/PM2 잡 종료 (코코엘 한정 또는 전체)
- **범위 (Out)**:
  - 팔레오 카페24/스마트스토어 컷오버 (Plan 5b)
  - 옛 sync.js 파일 자체 삭제 (팔레오 컷오버 후 별도)
  - SaaS sync-worker 코드 변경 (Plan 6에서 이미 완성)

## 2. 핵심 결정 (확정)

| 항목 | 값 |
|---|---|
| 종료 방식 | `SMARTSTORE_TARGETS` 배열에서 COCOEL 행 주석 처리 + git 커밋 + 가상서버 scp 반영 |
| 시점 | 즉시 (자격증명 등록 + manual enqueue 검증 통과 직후) |
| 병행 운영 | 없음 — 컷오버 직후 SaaS 단독 |
| SaaS 자격증명 별칭 | `스마트스토어` (기존 mall_type 값 그대로) |
| SaaS 채널 | `smartstore` (Plan 6 어댑터) |
| 옛 sync.js cron 종료 | 가상서버 SSH에서 crontab 또는 PM2 잡 정지 (현 상태 파악 후 결정) |
| 데이터 보존 | Supabase orders/order_items는 same — idempotent라 두 시스템 다 안전 |
| 코코엘 brand_id | `0a37b281-f262-4402-979c-e63a739bee53` |
| 코코엘 env 변수 | `COCOEL_APP_ID`, `COCOEL_APP_SECRET` (가상서버 .env) |

## 3. 데이터 흐름

```
[현재]
  옛 sync.js cron (가상서버) → COCOEL_APP_ID/SECRET → 네이버 commerce API → Supabase orders/order_items

[Plan 6b 완료 시점]
  pg_cron 30분 → enqueue_smartstore_orders → sync-worker pickup → SaaS smartstoreAdapter.syncOrders
  → Vault 코코엘 자격증명 → 네이버 commerce API → 같은 Supabase orders/order_items (mall_type='스마트스토어')

[옛 sync.js]
  COCOEL 분기 주석 처리. PALEO/DOKEBI는 계속.
  cron/PM2에서 sync.js 잡 자체는 유지 (PALEO/DOKEBI 위해)
```

## 4. 컴포넌트 변경

### 4.1 `c:\Users\Jangkwon\Desktop\order-manager\server\sync.js`

`SMARTSTORE_TARGETS` 배열(라인 16~20):

기존:
```javascript
const SMARTSTORE_TARGETS = [
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "브랜드스토어", credAlias: "PALEO" },
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "도깨비나라",   credAlias: "DOKEBI" },
  { brandId: "0a37b281-f262-4402-979c-e63a739bee53", mallType: "스마트스토어",  credAlias: "COCOEL" },
];
```

변경:
```javascript
const SMARTSTORE_TARGETS = [
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "브랜드스토어", credAlias: "PALEO" },
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "도깨비나라",   credAlias: "DOKEBI" },
  // { brandId: "0a37b281-f262-4402-979c-e63a739bee53", mallType: "스마트스토어",  credAlias: "COCOEL" }, // Plan 6b 컷오버: SaaS sync-worker로 이관
];
```

### 4.2 SaaS UI (코드 변경 없음, 데이터만)

- 코코엘 브랜드(`0a37b281...`) 페이지에서 "+ 스마트스토어 계정 추가" → 별칭 `스마트스토어` + COCOEL_APP_ID/SECRET 입력 → ✅
- brand_credentials 1행 + vault.secrets 1행 추가됨

### 4.3 가상서버 옛 sync.js

scp로 새 sync.js 반영. 그 외 어떤 코드도 안 건드림.

## 5. 검증 시나리오

1. **자격증명 등록 ✅**: SaaS UI에서 코코엘 스마트스토어 등록 → 즉시 ✅ 표시
2. **manual sync 검증**:
   ```sql
   INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
   SELECT brand_id, id, channel, 'orders', now()
   FROM brand_credentials
   WHERE channel='smartstore'
     AND brand_id='0a37b281-f262-4402-979c-e63a739bee53'
   LIMIT 1;
   ```
   1~2분 후 `result_summary={rowsUpserted:N, items_inserted:M}`. 옛 sync.js가 이미 동기화한 데이터와 일치 (idempotent upsert).
3. **옛 코드 disable + 반영**:
   - 로컬에서 sync.js 주석 처리 + 커밋
   - `scp server/sync.js root@203.245.41.105:/root/order-manager-server/sync.js` (정확한 가상서버 경로는 task 1에서 확인)
4. **옛 cron 종료**:
   - 가상서버에서 옛 sync.js cron/PM2 잡 상태 확인 (`crontab -l`, `pm2 list`)
   - 단순화 옵션: sync.js 자체는 그대로 (PALEO/DOKEBI sync 위해), 코드 주석만으로 충분
5. **다음 cron 자동 sync**:
   - SaaS sync-worker가 다음 30분 cron에 코코엘 brand의 sync_jobs를 enqueue
   - sync_jobs.completed 결과 row count > 0
6. **옛 sync.js 코코엘 sync 멈춤 확인**:
   - 옛 sync.js 로그에서 "COCOEL" 또는 "스마트스토어" 분기 라인 안 보임 (env 그대로 두고 코드 주석만으로 skip)
7. **cleanup**: 검증용 잡 + 옛 sync.js 로그 확인 후 작업 종료

## 6. 위험 + 완화

| 위험 | 완화 |
|---|---|
| 옛 sync.js cron이 어디서 도는지 모름 (crontab vs PM2) | Task 1에서 확인 (사용자 SSH 작업) |
| 옛 sync.js 코드 주석 처리만으로 cron 자체는 계속 → 다른 의도 없는 영향 | PALEO/DOKEBI 분기는 그대로 유지. COCOEL만 skip. 영향 X |
| SaaS sync-worker가 코코엘 등록 후 첫 30분 cron까지 sync 지연 | manual enqueue로 즉시 sync 가능 (Step 2 검증) |
| 옛 sync.js의 COCOEL 분기를 다른 코드가 의존 | sync.js 라인 18 SMARTSTORE_TARGETS만 사용. 다른 모듈 의존 X (grep 확인) |
| SMARTSTORE_TARGETS 미사용 import 경고 | 단일 파일 내 use라 영향 무 |
| 컷오버 직후 SaaS sync-worker가 buggy하면 코코엘 sync 멈춤 | Plan 6 안정 운영 중 + idempotent 검증 통과 시 컷오버. 옛 코드는 git에 남아 있어 롤백 즉시 가능 |

## 7. 의존성

- Plan 6 (smartstore syncOrders) 완료 + 안정 운영
- 가상서버 sync-worker 실행 중 + pg_cron `enqueue_smartstore_orders` 등록됨
- 코코엘 브랜드가 SaaS에 등록됨 (없으면 새로 생성)

## 8. Plan 6b 이후 작업

- **Plan 5b**: 팔레오 카페24 컷오버 (1~2주 안정 후)
- **Plan 5c (가칭)**: 팔레오/도깨비나라 스마트스토어 컷오버 (Plan 5b와 묶거나 별도)
- **옛 order-manager-server 종료**: 모든 brand 컷오버 후 가상서버에서 옛 sync.js + 관련 cron 완전 삭제
- **광고 분석 뷰**: ad_units + ad_stats 시각화 (Plan 7 완료 후 별도)
