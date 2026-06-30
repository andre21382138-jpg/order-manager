# Plan 6 — 스마트스토어 sync 구현 디자인 문서

- **작성일**: 2026-06-30
- **상태**: 디자인 합의 완료 → 구현 계획 작성 예정
- **대상 레포**: `order-manager-saas` + 가상서버 `/root/sync-worker/`
- **상위 spec**: [2026-06-29-order-manager-saas-design.md](./2026-06-29-order-manager-saas-design.md)
- **이전 plan들**:
  - Plan 4 (sync 인프라, 완료)
  - Plan 5 (카페24 sync 구현, 완료) — 패턴 거의 동일

---

## 1. 배경과 범위

Plan 5로 카페24 sync 흐름이 프로덕션 검증 완료(orders 25, items 38, products 100 실 데이터 확인). 이제 같은 패턴을 스마트스토어 어댑터에 적용. 가상서버 `lib/adapters.js`의 smartstore stub만 채우면 worker.js / pg_cron / sync_jobs / validate-proxy 모두 변경 없이 작동.

기존 `order-manager/server/sync.js` 라인 174~206에 스마트스토어 orders 동기화 코드가 이미 검증된 형태로 존재. Plan 6은 그 매핑을 가상서버 sync-worker로 옮긴다.

### 범위 (In Scope)

1. **TypeScript `lib/adapters/smartstore.ts`** — `syncOrders` 시그니처 추가 (Plan 5 패턴, throw로 가상서버 외 호출 차단). refreshToken은 무관(client_credentials grant). syncProducts는 sync.js에 없어 별도 plan.
2. **가상서버 `server/sync-worker/lib/adapters.js`** — smartstore stub을 실 구현으로 교체:
   - `smartstoreTokenCache` Map (모듈 스코프)
   - `getSmartstoreToken(clientId, clientSecret, mallId)` helper
   - `smartstoreAdapter.syncOrders(creds, ctx)` 페이지네이션 + orders upsert + order_items DELETE+INSERT
3. **Plan 5 mall_type hotfix** — cafe24Adapter.syncOrders의 `mall_type: 'cafe24'` 고정 → `mall_type: ctx.channelAccount`로 변경. 카페24 한 brand에 mall 여러 개 등록 시 같은 order_no가 다른 mall에서 충돌하던 위험 해소.

### Out of Scope

| 항목 | 다룰 plan |
|---|---|
| 스마트스토어 syncProducts (catalog_products 또는 channel_products 동기화) | 별도 plan (사용자 결정 후) |
| 코코엘 스마트스토어 컷오버 (기존 sync.js cron 제거) | Plan 5b 또는 Plan 6b 시점 |
| product_category_map JOIN해서 order_items.category 채우기 | Plan 8+ (UI 작업 시점) |
| 자동 테스트 인프라 | 별도 plan |

---

## 2. 의사결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| Token 캐시 전략 | in-process Map, key=`${mallId}:${clientId}`, 만료 5분 이내면 재발급 | client_credentials는 expires_in 기본 1시간, 30분 cron에 1회 정도 발급. 매번 발급보다 1회 절약 |
| Token 발급 패턴 | bcrypt 서명 + POST `/external/v1/oauth2/token` (Plan 4 validate-server.js와 동일) | 같은 로직 두 곳 — 향후 helper 추출 가능하지만 Plan 6는 복사 |
| Orders API endpoint | `GET https://api.commerce.naver.com/external/v1/pay-order/seller/last-changed-statuses` 또는 기존 sync.js와 동일한 endpoint | 기존 sync.js 코드 확인 후 정확한 path 추출 |
| mall_type 컬럼 값 | `ctx.channelAccount` (사용자 별칭 — 예: "브랜드스토어", "도깨비나라") | 기존 sync.js와 일치 + 한 brand의 mall 여러 개 구분 |
| 카페24도 같은 패턴으로 hotfix | 포함 | 일관성 + 데이터 충돌 위험 해소 |
| order_items.category | 빈 문자열 또는 null | Plan 5와 동일 단순화. JOIN은 Plan 8+ |
| 데이터 범위 default | 어제·오늘 KST (Plan 5와 동일) | 30분 cron에 충분 |
| 401 / 토큰 만료 처리 | 캐시 무효화 + retryable:true 반환 | client_credentials는 만료 시 다음 호출에 새 발급으로 자동 복구 |

---

## 3. 아키텍처

```
pg_cron enqueue_smartstore_orders (매 30분)
  ↓ SELECT brand_credentials WHERE channel='smartstore' AND status='active'
sync_jobs (channel='smartstore', job_type='orders')
  ↓ sync-worker (5초 polling, SKIP LOCKED LIMIT 1)
worker.js
  ↓ adapter = getAdapter('smartstore'); method = adapter.syncOrders
가상서버 adapters.js smartstoreAdapter.syncOrders
  ↓ 1. getSmartstoreToken(clientId, clientSecret, mallId)
     → Map cache 확인 → 만료 5분 이내면 재발급
     → bcrypt 서명 + POST oauth2/token → access_token, expires_in
  ↓ 2. 페이지네이션 fetch orders (어제·오늘 KST)
     → GET /pay-order/seller/last-changed-statuses 또는 sync.js와 같은 endpoint
     → Bearer token 헤더
  ↓ 3. orders upsert
     → orderRows: brand_id, mall_type=channelAccount, order_no, date,
                  total_amount, original_amount, is_cancelled, is_new,
                  total_qty, note=`${channelAccount} 자동수집`
     → admin.from('orders').upsert(orderRows, { onConflict: 'brand_id,order_no' }).select('id, order_no')
  ↓ 4. order_items DELETE + INSERT (per saved order)
     → DELETE FROM order_items WHERE order_id = saved.id
     → INSERT itemRows: order_id, product_name, category='', qty, amount
  ↓ 5. return { ok:true, rowsUpserted, meta:{items_inserted} }
worker.js markCompleted + last_synced_at update + log
```

---

## 4. Token 캐시 helper

`server/sync-worker/lib/adapters.js` 모듈 스코프:

```javascript
const bcrypt = require('bcryptjs')

const smartstoreTokenCache = new Map() // key = `${mallId}:${clientId}`, value = { accessToken, expiresAt (ms epoch) }

async function getSmartstoreToken(clientId, clientSecret, mallId) {
  const key = `${mallId}:${clientId}`
  const cached = smartstoreTokenCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.accessToken
  }
  const timestamp = Date.now()
  const password = `${clientId}_${timestamp}`
  const hashed = bcrypt.hashSync(password, clientSecret)
  const sign = Buffer.from(hashed).toString('base64')
  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: sign,
    grant_type: 'client_credentials',
    type: 'SELF',
  }).toString()

  const r = await httpsRequest(
    'https://api.commerce.naver.com/external/v1/oauth2/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    body
  )

  if (r.status !== 200 || !r.data?.access_token) {
    throw new Error(`smartstore token 발급 실패 (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`)
  }
  const expiresIn = Number(r.data.expires_in ?? 3600)
  const expiresAt = Date.now() + expiresIn * 1000
  smartstoreTokenCache.set(key, { accessToken: r.data.access_token, expiresAt })
  return r.data.access_token
}
```

> `mallId` 인자는 Map key 구성용. 스마트스토어는 OAuth가 아니라 별도 mall_id 개념 없음 — credentials의 식별자로 사용자 별칭(`channelAccount`)을 키에 포함해도 됨. 단순화: `key = clientId` (한 client_id는 한 SELF mall과 연결).

---

## 5. smartstoreAdapter.syncOrders

```javascript
async syncOrders(creds, ctx) {
  const { clientId, clientSecret } = creds
  const brandId = ctx.brandId
  const channelAccount = ctx.channelAccount
  if (!clientId || !clientSecret || !brandId || !channelAccount) {
    return { ok: false, error: 'syncOrders: 필수 인자 누락', retryable: false }
  }

  const { createAdminClient } = require('./supabase')
  const admin = createAdminClient()

  let accessToken
  try {
    accessToken = await getSmartstoreToken(clientId, clientSecret, channelAccount)
  } catch (e) {
    return { ok: false, error: e.message, retryable: true }
  }

  const startDate = ctx.dateRangeStart || yesterdayKST()
  const endDate = ctx.dateRangeEnd || todayKST()

  // 페이지네이션 fetch — 기존 sync.js의 정확한 endpoint와 query 파라미터 그대로 차용
  // (implementer가 sync.js 라인 100~170에서 추출)
  // 응답: { data: [{ order_id, order_date, items: [...], canceled, first_order, ... }] }

  let totalOrdersUpserted = 0
  let totalItemsInserted = 0
  const allOrders = []

  // ... (페이지네이션 로직 — sync.js 참조)

  // 그룹화 (sync.js 패턴: 같은 order_id의 여러 item을 한 order로 묶음)
  // const groupedOrders = ... (sync.js 100~170에서 추출)

  // upsert
  const BATCH = 50
  for (let i = 0; i < groupedOrders.length; i += BATCH) {
    const batch = groupedOrders.slice(i, i + BATCH)
    const orderRows = batch.map((o) => {
      const isCancelled = o.canceled === 'T'
      const isNew = o.first_order === 'T'
      return {
        brand_id: brandId,
        mall_type: channelAccount,
        order_no: String(o.order_id),
        date: o.order_date,
        total_amount: isCancelled ? o.initial_amount : o.actual_amount,
        original_amount: isCancelled ? o.initial_original : o.actual_original,
        is_cancelled: isCancelled,
        is_new: isNew,
        total_qty: o.items.reduce((s, it) => s + Number(it.quantity ?? 0), 0) || 1,
        note: `${channelAccount} 자동수집`,
      }
    })

    const { data: savedOrders, error: upsertErr } = await admin
      .from('orders')
      .upsert(orderRows, { onConflict: 'brand_id,order_no' })
      .select('id, order_no')
    if (upsertErr) return { ok: false, error: `orders upsert 실패: ${upsertErr.message}`, retryable: true }

    totalOrdersUpserted += savedOrders?.length ?? 0

    for (const saved of (savedOrders ?? [])) {
      const orig = batch.find((o) => String(o.order_id) === saved.order_no)
      if (!orig) continue

      await admin.from('order_items').delete().eq('order_id', saved.id)

      const items = orig.items.length > 0
        ? orig.items
        : [{ product_name: '상품', quantity: 1, order_price_amount: 0 }]

      const itemRows = items.map((it) => ({
        order_id: saved.id,
        product_name: String(it.product_name ?? ''),
        category: '',
        qty: Number(it.quantity ?? 0),
        amount: Number(it.order_price_amount ?? 0),
      }))

      if (itemRows.length > 0) {
        const { error: itemErr } = await admin.from('order_items').insert(itemRows)
        if (itemErr) return { ok: false, error: `order_items INSERT 실패: ${itemErr.message}`, retryable: true }
        totalItemsInserted += itemRows.length
      }
    }
  }

  return {
    ok: true,
    rowsUpserted: totalOrdersUpserted,
    meta: { items_inserted: totalItemsInserted },
  }
}
```

> 페이지네이션 로직과 정확한 orders endpoint URL은 implementer가 `c:\Users\Jangkwon\Desktop\order-manager\server\sync.js` 라인 96~170에서 그대로 추출. naver commerce API는 changed-from/changed-to 같은 쿼리 파라미터 사용 (last_changed_statuses endpoint).

---

## 6. Plan 5 mall_type hotfix

`server/sync-worker/lib/adapters.js`의 cafe24Adapter.syncOrders 내부 orderRows 매핑:

```javascript
// 변경 전 (Plan 5)
mall_type: 'cafe24',

// 변경 후 (Plan 6)
mall_type: channelAccount,
```

`channelAccount`는 함수 본문 위쪽에 `const channelAccount = ctx.channelAccount`로 destructure 추가.

---

## 7. TypeScript 측 cafe24.ts / smartstore.ts

`lib/adapters/smartstore.ts`에 Plan 5 cafe24.ts 패턴으로 시그니처만 추가:

```typescript
async function syncOrders(
  _creds: CredentialPayload,
  _ctx: SyncContext
): Promise<{ ok: false; error: string; retryable: boolean }> {
  throw new Error('syncOrders must run on virtual server sync-worker (not Vercel)')
}

// adapter export
export const smartstoreAdapter: ChannelAdapter = {
  // ... 기존 (channel, category, authType, credentialFields, buildPayload, validate)
  syncOrders,
}
```

> `import type` 줄에 `SyncContext` 추가 필요 (Plan 4 _types.ts에서 export 중).

---

## 8. 검증 시나리오 (Plan 6 완료 기준 — 7개)

### 인프라 (1)

1. ✅ 가상서버 reload 후 sync-worker `pm2 logs`에 `sync-worker starting` + 추가 에러 없음

### Token 캐시 (2)

2. ✅ 수동 enqueue 2회 빠르게 실행 → log에 token 발급 1회만 (2번째는 캐시 hit)
3. ✅ `SELECT cron.alter_job` 시뮬로 30분 간격 가까이 두 잡 실행 → 캐시 유효해서 재발급 안 함

### syncOrders (3)

4. ✅ 임시 브랜드 + 본인 스마트스토어 credential 등록 → "+ 스마트스토어 계정 추가" 별칭 "테스트" → validate 통과
5. ✅ 수동 enqueue → 1~2분 후 `sync_jobs.status='completed'`, `result_summary={rowsUpserted:N, items_inserted:M}`
6. ✅ `SELECT count(*) FROM orders WHERE mall_type='테스트'` → N행, `order_items` JOIN → M행

### mall_type hotfix 검증 (1)

7. ✅ 카페24 mall도 다시 수동 enqueue syncOrders → orders.mall_type = mall_id 값 (예: "paleo") — 'cafe24' 고정값이 아님

---

## 9. 보안 가드레일

| 항목 | 처리 |
|---|---|
| token 캐시 메모리 | in-process라 worker crash 시 자연 정리. 외부 dump 없음 |
| client_secret이 로그에 남음 | bcrypt 서명 후 사용. log에 client_secret 출력 금지 |
| getSmartstoreToken 호출 시점 자격증명 노출 | helper 함수 안에서만 처리. 결과 access_token만 반환 |
| 매체별 access_token 격리 | Map key가 `${channelAccount}` 또는 `${clientId}`로 다른 자격증명과 분리 |

---

## 10. 위험 + 완화

| 위험 | 완화 |
|---|---|
| naver commerce API 응답 포맷이 sync.js와 다름 (시간 경과로 변경된 경우) | 같은 endpoint 사용하니 영향 동일. 검증 시 catch |
| 캐시된 토큰이 발급은 됐지만 만료 직전 사용 → 401 | 만료 5분 마진으로 사실상 회피. 만약 401이면 retryable=true로 다음 polling에서 재시도 |
| 같은 brand에 같은 mall_type 두 번 등록 (UNIQUE에 channel_account까지 있어서 brand_credentials는 OK, orders는?) | orders는 `on_conflict='brand_id,order_no'`라 mall_type 다르면 같은 order_no면 덮어씀. 한 brand의 mall 여러 개 운영 시 발생 가능. 한 mall=한 brand_credentials 권장 |
| Plan 5 hotfix가 적용된 후 기존 카페24 orders.mall_type='cafe24' 행 존재 | 새 sync 시 같은 brand_id + 같은 order_no면 upsert가 mall_type 새 값으로 덮어씀. 자연 마이그레이션 |
| 가상서버 PM2 reload 시 캐시 비워짐 → 다음 호출 1번 추가 발급 | 30분 cron 단위라 영향 작음 |

---

## 11. 산출물 (코드 변경 요약)

| 파일 | 변경 |
|---|---|
| `lib/adapters/smartstore.ts` | syncOrders 시그니처 추가 (throw) + SyncContext import |
| `server/sync-worker/lib/adapters.js` | bcrypt require + smartstoreTokenCache Map + getSmartstoreToken helper + smartstoreAdapter.syncOrders 실 구현 + cafe24Adapter.syncOrders의 mall_type을 channelAccount로 변경 |

추가 파일 없음. DB 변경 없음. 환경변수 변경 없음.

---

## 12. Plan 6 이후

| Plan | 내용 |
|---|---|
| Plan 7 | 네이버광고 syncAdStats + syncAdUnits |
| Plan 5b | 팔레오 카페24 컷오버 (Plan 5+6 1주 안정 운영 후) |
| Plan 6b | 코코엘 스마트스토어 컷오버 |
| Plan 8+ | UI (대시보드, 광고/주문 조회 화면, sync 모니터링) |

---

## 13. 다음 단계

이 spec이 사용자 리뷰 후 확정되면 `writing-plans`로 Task 단위 plan 작성. 예상 Task 흐름:

1. cafe24Adapter mall_type hotfix + 카페24 sync 재시도 (단순)
2. TypeScript smartstore.ts syncOrders 시그니처
3. 가상서버 adapters.js에 bcrypt require + smartstoreTokenCache + getSmartstoreToken
4. 가상서버 smartstoreAdapter.syncOrders 실 구현
5. 가상서버 deploy + PM2 reload
6. 통합 검증 (7 시나리오)
