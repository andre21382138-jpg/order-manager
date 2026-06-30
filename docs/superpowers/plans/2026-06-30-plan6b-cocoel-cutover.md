# Plan 6b — 코코엘 스마트스토어 컷오버 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SaaS sync-worker가 코코엘 스마트스토어 운영을 인수. 옛 `order-manager/server/sync.js`의 SMARTSTORE_TARGETS 배열에서 COCOEL 행 주석 처리 + 가상서버 반영. 팔레오/도깨비나라는 그대로 유지 (Plan 5b까지).

**Architecture:** 코드 변경은 Task 4 1개 (sync.js 3줄). 나머지 5개 task는 사용자 운영 작업 (가상서버 SSH, SaaS UI, SQL Editor, scp). 데이터 idempotent라 병행 운영 없이 즉시 컷오버.

**Tech Stack:** 가상서버 sync-worker (Plan 6 완성). Supabase orders/order_items (동일 인스턴스). Vault 자격증명.

**Spec:** `docs/superpowers/specs/2026-06-30-plan6b-cocoel-cutover-design.md`

## Global Constraints

- **옛 sync.js 위치 (로컬)**: `c:\Users\Jangkwon\Desktop\order-manager\server\sync.js`
- **옛 sync.js 위치 (가상서버)**: 가상서버 위치는 Task 1에서 확인 (`/root/` 또는 `/root/order-manager-server/` 등 추정)
- **SaaS sync-worker 위치 (가상서버)**: `/root/sync-worker/` (Plan 4~6에서 deploy)
- **종료 방식**: SMARTSTORE_TARGETS 배열에서 COCOEL 행 주석 처리 (git 커밋)
- **시점**: 즉시 (자격증명 등록 + manual enqueue 검증 통과 직후)
- **코코엘 brand_id**: `0a37b281-f262-4402-979c-e63a739bee53` (sync.js에 하드코딩)
- **코코엘 env 변수**: `COCOEL_APP_ID`, `COCOEL_APP_SECRET` (가상서버 .env)
- **SaaS 자격증명 별칭**: `스마트스토어` (기존 mall_type 값 그대로 — orders 행 키 일관성)
- **SaaS 채널**: `smartstore` (Plan 6 어댑터)
- **유지**: PALEO + DOKEBI 분기는 그대로 (sync.js cron 자체는 종료 X)
- **데이터 보존**: Supabase orders.upsert(onConflict='brand_id,order_no') idempotent — 두 시스템 다 안전
- **자동 테스트 무** — 운영자 수동 검증

## File Structure (Plan 6b 완료 시점)

```
order-manager/
└── server/sync.js                          # ★ SMARTSTORE_TARGETS COCOEL 행 주석 (3줄 영역)
가상서버 (203.245.41.105):
└── (옛 sync.js 경로)/sync.js               # ★ 위 파일을 scp로 동기화
```

SaaS 측 코드 변경 NO (Plan 6에서 완성).

---

### Task 1: 가상서버 옛 sync.js 위치 + cron 등록 상태 확인 (사용자)

**Files:** 외부 작업 (가상서버 SSH)

**Interfaces:**
- Produces: 옛 sync.js 정확한 가상서버 경로 + cron 또는 PM2 잡 등록 정보 → Task 5의 scp 대상 경로 확정 + Task 6의 종료 확인 기준

- [ ] **Step 1: 옛 sync.js 파일 위치 확인**

가상서버 SSH 세션에서:

```bash
ls -la /root/sync-worker/sync.js 2>/dev/null
ls -la /root/order-manager-server/sync.js 2>/dev/null
ls -la /root/sync.js 2>/dev/null
find /root -maxdepth 3 -name "sync.js" -type f 2>/dev/null | head -10
```

기대: 1개 이상의 경로에서 `sync.js` 발견. 그 중 옛 sync.js (Plan 6 이전 코드 — `SMARTSTORE_TARGETS` 배열 포함)인 것 확인:

```bash
# 발견된 경로 각각에 대해
grep -l "SMARTSTORE_TARGETS" <발견된 경로>
```

해당 grep이 hit한 파일이 옛 sync.js. 그 정확한 경로를 다음 task들에서 사용.

> 만약 `/root/sync-worker/sync.js`에 SMARTSTORE_TARGETS가 있다면 그건 새 SaaS sync-worker가 아님 — 옛 sync.js가 그 폴더 안에 있을 수도 있음. 헷갈리지 않게 확인.

- [ ] **Step 2: cron 등록 상태 확인**

```bash
crontab -l 2>/dev/null | grep -i "sync"
```

기대: 옛 sync.js를 등록한 cron 라인이 있으면 출력. 예: `*/30 * * * * cd /root/... && node sync.js >> sync.log 2>&1`

또는 PM2로 등록됐을 수 있음:

```bash
pm2 list
```

`sync-worker` 외에 옛 sync.js 관련 잡 (예: `order-sync`, `sync-job` 등)이 있는지 확인.

- [ ] **Step 3: 사용자가 위 결과를 chat으로 보고**

다음 정보 정리해서 알림:
- 옛 sync.js 정확한 경로 (예: `/root/order-manager-server/sync.js`)
- cron 라인 또는 PM2 잡 이름 (또는 "찾지 못함")
- 최근 sync.js 로그 위치 (예: `/root/sync.log`) — Task 6에서 확인 시 필요

이 task는 외부 작업이라 커밋 없음.

---

### Task 2: SaaS UI에서 코코엘 스마트스토어 자격증명 등록 (사용자)

**Files:** 외부 작업 (브라우저 + Supabase data)

**Interfaces:**
- Consumes: Task 1 확인은 무관 (병렬 가능)
- Produces: SaaS brand_credentials 1행 (channel='smartstore', brand_id=코코엘) + vault.secrets 1행

- [ ] **Step 1: 가상서버에서 COCOEL 값 확인**

가상서버 SSH에서:

```bash
grep "^COCOEL_APP" /root/naver-proxy/.env 2>/dev/null || grep "^COCOEL_APP" /root/sync-worker/.env 2>/dev/null || grep "^COCOEL_APP" <Task 1에서 찾은 옛 sync.js 디렉토리>/.env
```

기대: `COCOEL_APP_ID=...` + `COCOEL_APP_SECRET=...` 두 줄 출력.

- [ ] **Step 2: SaaS UI에서 코코엘 브랜드 확인 또는 추가**

`https://order-manager-saas-bay.vercel.app` 시크릿 창 로그인 (`ssakwon@kbh.kr`).

사이드바에서 코코엘 브랜드 (brand_id `0a37b281-f262-4402-979c-e63a739bee53`) 확인:
- 이미 있으면: 그 브랜드 페이지 클릭
- 없으면: "+ 브랜드 추가" → 이름 `코코엘` → 추가 (단 brand_id가 다르게 할당될 수 있음 — 다음 step에서 확인)

- [ ] **Step 3: 스마트스토어 자격증명 등록**

선택한 코코엘 브랜드 페이지에서 "+ 스마트스토어 계정 추가":
- 별칭 (또는 채널 계정명): `스마트스토어`  ← **기존 mall_type 값과 동일하게**
- App ID: Step 1의 COCOEL_APP_ID 값
- App Secret: Step 1의 COCOEL_APP_SECRET 값
- 등록 → ✅ 표시 확인

- [ ] **Step 4: Supabase SQL Editor로 brand_id 확인**

```sql
SELECT id, name FROM brands WHERE name LIKE '%코코엘%' OR id = '0a37b281-f262-4402-979c-e63a739bee53';
SELECT brand_id, channel, channel_account, status
FROM brand_credentials
WHERE channel = 'smartstore' AND channel_account = '스마트스토어';
```

기대:
- brands 행 확인: id가 `0a37b281...`이어야 함 (옛 sync.js 하드코딩과 일치)
- brand_credentials 행: `status='active'` + `channel_account='스마트스토어'`

> 만약 SaaS에서 새 브랜드를 만들었다면 brand_id가 자동 UUID가 됨 — 옛 sync.js의 `0a37b281...`와 다름. orders 행 키 일관성이 깨짐 (옛 sync.js가 만든 orders와 새 brand_credentials의 brand_id가 다름). 이 경우 다음 step에서 처리.

- [ ] **Step 5 (조건부): brand_id가 옛 sync.js 값과 다르면 manual UPDATE**

만약 SaaS brand가 `0a37b281...`가 아닌 다른 UUID로 생성됐다면, SQL Editor에서:

```sql
-- 기존 orders가 어느 brand_id로 저장되어 있는지 확인
SELECT DISTINCT brand_id, mall_type, count(*)
FROM orders
WHERE mall_type = '스마트스토어'
GROUP BY brand_id, mall_type;
```

만약 `0a37b281...` brand_id로 행이 많이 있고 SaaS brand가 다른 ID라면:
1. 옛 데이터를 새 brand_id로 마이그레이션 OR
2. SaaS brand_id를 옛 값으로 일치시킴 (brands 행 UPDATE — 단 외래키 영향 주의)

**가장 간단**: 기존 코코엘 brand가 SaaS에 없으면 (Step 2에서 새로 만든 경우), SQL Editor에서 brands.id를 옛 값으로 UPDATE:

```sql
UPDATE brands SET id = '0a37b281-f262-4402-979c-e63a739bee53'
WHERE name = '코코엘' AND id != '0a37b281-f262-4402-979c-e63a739bee53';
-- 외래키 영향: brand_credentials, sync_jobs 등 같이 cascade 또는 manual update 필요
```

> 안전: SaaS DB가 새로 시작했다면 brand_credentials/sync_jobs도 새 brand_id 참조라 cascade 자동. 만약 충돌이면 chat으로 보고 후 fix.

- [ ] **Step 6: 사용자가 등록 완료 + brand_id 일치 결과를 chat으로 보고**

이 task는 외부 작업이라 커밋 없음.

---

### Task 3: manual sync 검증 (사용자)

**Files:** 외부 작업 (SQL Editor)

**Interfaces:**
- Consumes: Task 2 완료 (코코엘 brand_credentials 행 + brand_id `0a37b281...`)
- Produces: SaaS sync-worker가 코코엘 데이터를 정상 sync 함을 확인

- [ ] **Step 1: manual orders 잡 enqueue**

Supabase SQL Editor:

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'orders', now()
FROM brand_credentials
WHERE channel='smartstore'
  AND channel_account='스마트스토어'
  AND status='active'
LIMIT 1;
```

기대: "Success. No rows returned" (INSERT 1행).

- [ ] **Step 2: 1~3분 후 결과 확인**

```sql
SELECT status, result_summary, error_message
FROM sync_jobs
WHERE channel='smartstore' AND job_type='orders'
ORDER BY created_at DESC LIMIT 3;
```

기대 (가장 최근 행): `status='completed'`, `result_summary={"rowsUpserted":N, "items_inserted":M}` (N ≥ 0).

만약 에러나면 `error_message` 확인 — Plan 5/6과 같은 패턴으로 fix.

- [ ] **Step 3: 데이터 일치 확인 (옛 sync.js가 만든 행 + 새 sync-worker가 만든 행이 같은지)**

```sql
SELECT
  count(*) AS total,
  count(DISTINCT order_no) AS unique_orders,
  count(*) - count(DISTINCT order_no) AS duplicates,
  max(created_at) AS latest_created,
  count(*) FILTER (WHERE created_at > now() - interval '5 minutes') AS recent_5min
FROM orders
WHERE brand_id = '0a37b281-f262-4402-979c-e63a739bee53' AND mall_type = '스마트스토어';
```

기대:
- `duplicates = 0` (UNIQUE 보장 — upsert idempotent)
- `recent_5min` = manual sync로 갱신된 행 수

- [ ] **Step 4: 사용자가 결과 chat 보고 후 Task 4 진행**

이 task는 외부 작업이라 커밋 없음.

---

### Task 4: 로컬 sync.js의 COCOEL 행 주석 처리 + 커밋

**Files:**
- Modify: `c:\Users\Jangkwon\Desktop\order-manager\server\sync.js` 라인 16~20 (SMARTSTORE_TARGETS 배열)

**Interfaces:**
- Consumes: Task 3 데이터 일치 확인 결과 (sync-worker가 코코엘 정상 sync 함)
- Produces: 옛 sync.js의 COCOEL 분기가 다음 실행부터 skip됨

- [ ] **Step 1: sync.js 수정**

`c:\Users\Jangkwon\Desktop\order-manager\server\sync.js`의 SMARTSTORE_TARGETS 배열을 다음과 같이 수정:

기존 (라인 16~20):
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
  // { brandId: "0a37b281-f262-4402-979c-e63a739bee53", mallType: "스마트스토어",  credAlias: "COCOEL" }, // Plan 6b: SaaS sync-worker로 이관 (2026-06-30)
];
```

> COCOEL 행 자체를 삭제하지 말고 주석 처리 — 컷오버 의도 명시 + git 히스토리에 잔존.

- [ ] **Step 2: 변경 사항 시각적 확인**

수정 후 라인 16~20 영역을 다시 확인 — PALEO/DOKEBI 행은 변경 없고 COCOEL 행만 `//`로 주석 처리됐는지.

- [ ] **Step 3: 다른 코드가 SMARTSTORE_TARGETS COCOEL을 의존하지 않는지 확인**

```powershell
cd c:\Users\Jangkwon\Desktop\order-manager
Select-String -Path "server/*.js" -Pattern "COCOEL"
```

기대: `server/sync.js`의 COCOEL 라인(들)만 출력. 다른 파일 / 다른 위치는 없거나 무관 (예: 별도 sync-ad.js의 광고 관련 COCOEL은 무관).

- [ ] **Step 4: 커밋 + push**

```powershell
cd c:\Users\Jangkwon\Desktop\order-manager
git add server/sync.js
git commit -m "fix(sync): SMARTSTORE_TARGETS COCOEL 행 주석 — Plan 6b SaaS sync-worker 컷오버"
git push
```

---

### Task 5: 가상서버에 sync.js 반영 (사용자)

**Files:** 외부 작업 (scp)

**Interfaces:**
- Consumes: Task 1 확인된 가상서버 옛 sync.js 경로 + Task 4 커밋된 로컬 sync.js
- Produces: 가상서버 옛 sync.js의 COCOEL 분기가 비활성화됨

- [ ] **Step 1: 로컬에서 가상서버로 sync.js scp**

Task 1에서 확인한 경로를 `<가상서버 경로>`로 치환 (예: `/root/order-manager-server/sync.js`):

```powershell
scp C:\Users\Jangkwon\Desktop\order-manager\server\sync.js root@203.245.41.105:<가상서버 경로>
```

- [ ] **Step 2: 가상서버에서 변경 확인**

가상서버 SSH:

```bash
grep -A 2 "SMARTSTORE_TARGETS" <가상서버 경로>
```

기대: COCOEL 라인이 `//`로 시작하는 주석 행으로 출력.

- [ ] **Step 3: 다음 cron 실행 시 효과 (즉시 적용)**

옛 sync.js가 PM2로 도는 경우 reload 필요할 수 있지만, 일반적으로 crontab cron은 매 실행마다 node 새로 띄움 → 다음 cron부터 자동 적용. 별도 reload 없음.

만약 PM2 잡이면:

```bash
pm2 reload <Task 1에서 확인한 PM2 잡 이름>
```

- [ ] **Step 4: 사용자가 반영 결과 chat 보고**

이 task는 외부 작업이라 커밋 없음.

---

### Task 6: 컷오버 후 자동 sync 확인 + cleanup (사용자)

**Files:** 외부 작업 (SQL Editor + 가상서버 로그)

**Interfaces:**
- Produces: SaaS sync-worker가 30분 cron에 코코엘 sync 정상 + 옛 sync.js가 코코엘 sync 안 함을 확인

- [ ] **Step 1: SaaS sync-worker 30~60분 cron 후 자동 sync 확인**

옛 sync.js cron이 동작했을 시각(예: 매 시 30분)이 지난 후 SQL Editor:

```sql
SELECT
  count(*) FILTER (WHERE updated_at > now() - interval '1 hour') AS recent_updates,
  max(updated_at) AS latest_update
FROM orders
WHERE brand_id = '0a37b281-f262-4402-979c-e63a739bee53' AND mall_type = '스마트스토어';
```

기대: `recent_updates > 0` (1시간 내 새 동기화). `latest_update` 시각이 SaaS sync-worker가 도는 시각과 일치.

또는:

```sql
SELECT created_at, status, result_summary
FROM sync_jobs
WHERE channel = 'smartstore' AND job_type = 'orders'
ORDER BY created_at DESC LIMIT 5;
```

기대: 최근 행이 30분 안에 생성됨 (pg_cron `enqueue_smartstore_orders`).

- [ ] **Step 2: 옛 sync.js가 코코엘 sync 안 함 확인**

Task 1에서 확인한 옛 sync.js 로그 위치 (예: `/root/sync.log`)를 확인:

```bash
tail -100 <Task 1에서 확인한 로그 경로> | grep -i "코코엘\|cocoel\|스마트스토어"
```

기대: 최근 로그에 COCOEL/스마트스토어 관련 라인이 없음 (분기 skip). 만약 출력이 있다면 PALEO/DOKEBI 또는 별도 sync 흐름의 메시지인지 확인.

또는 옛 sync.js cron 직후 즉시 확인:

```bash
tail -50 <옛 sync.js 로그>
```

옛 sync.js 코드가 SMARTSTORE_TARGETS 순회 시 COCOEL 행이 주석이라 skip되므로 어떤 로그도 안 찍힘. PALEO/DOKEBI는 정상 sync 로그.

- [ ] **Step 3: cleanup (선택)**

검증용 sync_jobs 정리:

```sql
DELETE FROM sync_jobs
WHERE status IN ('completed','failed') AND created_at < now() - interval '1 hour';
```

- [ ] **Step 4: 사용자가 결과 chat 보고로 Plan 6b 마무리**

이 task는 외부 작업이라 커밋 없음.

---

## Plan 6b 완료 기준 체크리스트

- [ ] Task 1: 가상서버 옛 sync.js 위치 + cron/PM2 등록 확인
- [ ] Task 2: SaaS에 코코엘 스마트스토어 자격증명 등록 (brand_id `0a37b281...` 일치)
- [ ] Task 3: manual orders 잡 실행 → result_summary OK + duplicates=0
- [ ] Task 4: 로컬 sync.js SMARTSTORE_TARGETS COCOEL 행 주석 + 커밋
- [ ] Task 5: 가상서버에 sync.js scp 반영
- [ ] Task 6: 30~60분 후 SaaS sync-worker가 코코엘 자동 sync + 옛 sync.js는 코코엘 sync 안 함

## Plan 6b 이후 작업

- **Plan 5b**: 팔레오 카페24 컷오버 (PALEO + DOKEBI 스마트스토어 동시 또는 분리 결정 후)
- **광고 분석 뷰**: ad_units + ad_stats 시각화 SaaS 페이지
- **옛 order-manager-server 완전 종료**: 모든 brand 컷오버 후 가상서버에서 옛 sync.js + 관련 cron 완전 삭제

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| Task 2에서 SaaS brand_id가 옛 sync.js 하드코딩 값과 불일치 | Task 2 Step 4/5의 SQL 확인 + manual UPDATE로 맞춤 |
| Task 1에서 옛 sync.js 위치를 못 찾음 | grep "SMARTSTORE_TARGETS" 또는 `find` 명령으로 search |
| 옛 sync.js cron 자체 종료가 PALEO 영향 | sync.js 자체는 그대로 유지 (PALEO/DOKEBI 위해). COCOEL 행만 주석 — 영향 X |
| 옛 sync.js와 SaaS가 같은 코코엘 데이터 동시 sync (Task 4~5 사이 짧은 윈도우) | upsert idempotent라 데이터 같음. 단지 API 호출 2번. 무해 |
| 컷오버 직후 SaaS sync-worker가 buggy해서 코코엘 sync 멈춤 | Plan 6 검증 + Task 3 manual 검증 통과 → 위험 낮음. 만약 발생하면 sync.js 주석 해제 + scp로 즉시 롤백 |
| 다른 모듈이 SMARTSTORE_TARGETS COCOEL 의존 | Task 4 Step 3 grep으로 확인 |
| 옛 sync.js .env에 COCOEL 변수 그대로 두면 미래 누군가 주석 해제 시 동시 sync 재개 | 본 plan 범위 외. 추후 cleanup task에서 .env에서도 COCOEL 변수 삭제 검토 |
