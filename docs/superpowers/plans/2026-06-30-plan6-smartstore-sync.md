# Plan 6 — 스마트스토어 sync 구현 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가상서버 sync-worker의 smartstore stub을 실 구현으로 교체 (token 캐시 + syncOrders) + Plan 5 cafe24의 `mall_type` hotfix. 기존 `server/sync.js` 라인 78~210의 검증된 매핑·페이지네이션 패턴을 그대로 옮긴다.

**Architecture:** `lib/adapters.js` 모듈 스코프에 `smartstoreTokenCache` Map과 `getSmartstoreToken(clientId, clientSecret, channelAccount)` helper 추가. smartstoreAdapter.syncOrders가 sync.js와 동일하게 일별로 `GET commerce.naver.com/external/v1/pay-order/seller/product-orders?from={day}&to={day}&limitCount=300`을 호출 + 응답을 orderId로 그룹핑 + orders + order_items upsert. Plan 5 cafe24의 `mall_type: 'cafe24'` 고정 → `ctx.channelAccount`로 변경.

**Tech Stack:** Node 20 (가상서버 CommonJS), `bcryptjs` (이미 설치), node `https` 내장. Supabase REST upsert. naver commerce API v1.

**Spec:** `docs/superpowers/specs/2026-06-30-plan6-smartstore-sync-design.md`

**참조 코드** (implementer가 read):
- `c:\Users\Jangkwon\Desktop\order-manager\server\sync.js` 라인 78~210 — 일별 페이지네이션, orderId 그룹핑, total_amount 계산, items 추출, orders/order_items upsert 패턴
- `c:\Users\Jangkwon\Desktop\order-manager\server\proxy.js` 라인 58~150 — bcrypt + naver commerce token endpoint, orders endpoint path

## Global Constraints

- **레포 위치 (로컬)**: `C:\Users\Jangkwon\Desktop\order-manager-saas`
- **가상서버**: `203.245.41.105` `/root/sync-worker/`
- **naver commerce API base**: `https://api.commerce.naver.com`
- **token endpoint**: `POST /external/v1/oauth2/token` — form-urlencoded body `client_id, timestamp, client_secret_sign, grant_type=client_credentials, type=SELF`
- **bcrypt 서명**: `password = "${clientId}_${timestamp}"` → `bcrypt.hashSync(password, clientSecret)` → base64 → `client_secret_sign`
- **orders endpoint**: `GET /external/v1/pay-order/seller/product-orders?from={ISO+KST}&to={ISO+KST}&limitCount=300`
- **응답 from / to format**: `${day}T00:00:00.000+09:00` (URL-encode 시 `+` → `%2B`)
- **응답 데이터 경로**: `data.contents` 배열 (각 item의 `content.productOrder` + `content.order`)
- **CANCEL_STATUSES**: `["CANCEL_DONE", "RETURN_DONE", "EXCHANGE_DONE", "CANCEL_NOSHIPPING", "CANCELED_BY_NOPAYMENT", "CANCELED"]`
- **token 캐시**: in-process Map. key = clientId. value = `{accessToken, expiresAt: ms epoch}`. 만료 5분 마진
- **orders 컬럼 매핑**: brand_id, mall_type=`ctx.channelAccount`, order_no, date, total_amount, original_amount, is_cancelled, is_new, total_qty, note=`${channelAccount} 자동수집`
- **order_items 컬럼 매핑**: order_id, product_name, category='' (빈 문자열), qty, amount
- **데이터 범위 default**: 어제·오늘 KST (Plan 5 헬퍼 재사용)
- **자동 테스트 무** — `node --check` + 운영자 수동 검증
- **CommonJS** (가상서버)

## File Structure (Plan 6 완료 시점)

```
order-manager-saas/
├── lib/adapters/smartstore.ts              # ★ 변경 — syncOrders 시그니처 추가
└── server/sync-worker/
    └── lib/adapters.js                     # ★ 변경 — bcrypt require + smartstoreTokenCache + getSmartstoreToken + smartstoreAdapter.syncOrders 실 구현 + cafe24 mall_type → channelAccount
```

---

### Task 1: cafe24Adapter.syncOrders mall_type을 channelAccount로 (Plan 5 hotfix)

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: `ctx.channelAccount` (Plan 4 SyncContext에 이미 있음)
- Produces: cafe24 orders.mall_type이 'cafe24' 고정 대신 실제 mall_id (예: 'paleo', 'dokebi')로 채워짐

- [ ] **Step 1: Edit cafe24Adapter.syncOrders 내부**

`server/sync-worker/lib/adapters.js`의 cafe24Adapter.syncOrders 함수 본문에서 다음 부분 찾기 — 함수 시작 근처에 `const brandId = ctx.brandId`가 있는 영역, 그리고 orderRows.map 내부:

기존:
```javascript
async syncOrders(creds, ctx) {
    const { mallId, accessToken } = creds
    const brandId = ctx.brandId
    if (!mallId || !accessToken || !brandId) {
      return { ok: false, error: 'syncOrders: 필수 인자 누락', retryable: false }
    }
    // ...

    const orderRows = orders.map((o) => {
      // ...
      return {
        brand_id: brandId,
        mall_type: 'cafe24',
        // ...
      }
    })
```

변경:
```javascript
async syncOrders(creds, ctx) {
    const { mallId, accessToken } = creds
    const brandId = ctx.brandId
    const channelAccount = ctx.channelAccount
    if (!mallId || !accessToken || !brandId || !channelAccount) {
      return { ok: false, error: 'syncOrders: 필수 인자 누락', retryable: false }
    }
    // ...

    const orderRows = orders.map((o) => {
      // ...
      return {
        brand_id: brandId,
        mall_type: channelAccount,
        // ...
      }
    })
```

> 즉 (1) `channelAccount = ctx.channelAccount` 추가, (2) 가드에 `channelAccount` 추가, (3) orderRows의 `mall_type: 'cafe24'`를 `mall_type: channelAccount`로 변경.

- [ ] **Step 2: 로컬 syntax check**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node --check lib/adapters.js
```

기대: 출력 없음 (syntax OK).

- [ ] **Step 3: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "fix(sync-worker): cafe24 mall_type 고정값 → ctx.channelAccount (Plan 5 hotfix, Plan 6 일관)"
git push
```

---

### Task 2: TypeScript `lib/adapters/smartstore.ts`에 syncOrders 시그니처 추가

**Files:**
- Modify: `lib/adapters/smartstore.ts`

**Interfaces:**
- Consumes: `SyncContext`, `CredentialPayload` (Plan 4 _types.ts에 존재)
- Produces: smartstoreAdapter.syncOrders 시그니처 (throw — Vercel 외 호출 차단)

- [ ] **Step 1: smartstore.ts 상단 import에 SyncContext 추가**

기존:
```typescript
import 'server-only'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
} from './_types'
```

변경:
```typescript
import 'server-only'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
  SyncContext,
} from './_types'
```

- [ ] **Step 2: smartstoreAdapter export 직전에 syncOrders 함수 추가**

기존 파일 끝부분이 다음과 같음 (대략):

```typescript
export const smartstoreAdapter: ChannelAdapter = {
  channel: 'smartstore',
  category: 'shop',
  authType: 'api_key',
  credentialFields: [...],
  buildPayload,
  validate,
}
```

export 직전(adapter 객체 정의 위)에 다음 함수 추가:

```typescript
async function syncOrders(
  _creds: CredentialPayload,
  _ctx: SyncContext
): Promise<{ ok: false; error: string; retryable: boolean }> {
  throw new Error('syncOrders must run on virtual server sync-worker (not Vercel)')
}
```

그리고 adapter export 객체에 `syncOrders` 추가:

```typescript
export const smartstoreAdapter: ChannelAdapter = {
  channel: 'smartstore',
  category: 'shop',
  authType: 'api_key',
  credentialFields: [...],
  buildPayload,
  validate,
  syncOrders,
}
```

- [ ] **Step 3: Vercel 빌드 확인**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
npm run build
```

기대: 타입 에러 없음. 빌드 성공.

- [ ] **Step 4: 커밋**

```powershell
git add lib/adapters/smartstore.ts
git commit -m "feat(adapters): smartstore.ts에 syncOrders 시그니처 추가 (throw — 가상서버 전용)"
git push
```

---

### Task 3: 가상서버 `lib/adapters.js` 상단에 bcrypt + smartstoreTokenCache + getSmartstoreToken

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: 기존 `httpsRequest` helper (Plan 5 Task 4에서 추가됨)
- Produces:
  - `smartstoreTokenCache: Map<string, {accessToken: string, expiresAt: number}>` (모듈 스코프)
  - `getSmartstoreToken(clientId, clientSecret, cacheKey): Promise<string>` — 캐시 lookup → 만료 5분 이내면 재발급, 결과 access_token 반환

- [ ] **Step 1: adapters.js 상단(`https` require 옆)에 `bcrypt` require 추가**

기존:
```javascript
const https = require('https')
```

변경:
```javascript
const https = require('https')
const bcrypt = require('bcryptjs')
```

> bcryptjs는 Plan 3에서 Vercel용으로 설치했지만 가상서버 sync-worker `package.json`에는 이미 있음 (Plan 4 Task 5에서 추가됨). 별도 설치 불필요.

- [ ] **Step 2: KST 헬퍼(`yesterdayKST`, `todayKST`) 다음 라인에 캐시 Map + helper 함수 추가**

```javascript
// 스마트스토어 access_token in-process 캐시 (Plan 6)
const smartstoreTokenCache = new Map() // key = clientId, value = { accessToken, expiresAt (ms epoch) }

async function getSmartstoreToken(clientId, clientSecret) {
  const cached = smartstoreTokenCache.get(clientId)
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
  smartstoreTokenCache.set(clientId, { accessToken: r.data.access_token, expiresAt })
  return r.data.access_token
}
```

- [ ] **Step 3: 로컬 syntax check**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node --check lib/adapters.js
```

기대: 출력 없음.

- [ ] **Step 4: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): smartstoreTokenCache + getSmartstoreToken (bcrypt 서명 + 캐시 5분 마진)"
git push
```

---

### Task 4: 가상서버 smartstoreAdapter.syncOrders 실 구현

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: `getSmartstoreToken` (Task 3), `httpsRequest`, `yesterdayKST`, `todayKST`, KST CANCEL_STATUSES 상수
- Produces: smartstoreAdapter.syncOrders가 일별 페이지네이션 → orderId 그룹핑 → orders/order_items upsert. 반환 `{ok, rowsUpserted, meta:{items_inserted}}`

- [ ] **Step 1: 모듈 스코프에 CANCEL_STATUSES 상수 추가 (KST 헬퍼 다음)**

```javascript
const CANCEL_STATUSES = ['CANCEL_DONE', 'RETURN_DONE', 'EXCHANGE_DONE', 'CANCEL_NOSHIPPING', 'CANCELED_BY_NOPAYMENT', 'CANCELED']
```

- [ ] **Step 2: smartstoreAdapter stub 교체**

기존:
```javascript
const smartstoreAdapter = {
  channel: 'smartstore',
  // syncOrders/syncProducts — Plan 6에서 구현
}
```

다음으로 교체:

```javascript
const smartstoreAdapter = {
  channel: 'smartstore',

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
      accessToken = await getSmartstoreToken(clientId, clientSecret)
    } catch (e) {
      return { ok: false, error: e.message, retryable: true }
    }

    const startDate = ctx.dateRangeStart || yesterdayKST()
    const endDate = ctx.dateRangeEnd || todayKST()

    // 일별 chunk 생성
    const chunks = []
    let cursor = new Date(startDate)
    const endD = new Date(endDate)
    while (cursor <= endD) {
      chunks.push(cursor.toISOString().slice(0, 10))
      cursor = new Date(cursor.getTime() + 86400000)
    }

    const allDetails = []
    for (const day of chunks) {
      const fromRaw = `${day}T00:00:00.000+09:00`
      const toRaw = `${day}T23:59:59.999+09:00`
      const from = encodeURIComponent(fromRaw).replace(/%2B/g, '%2B') // ensure + is encoded
      const to = encodeURIComponent(toRaw)
      const uri = `/external/v1/pay-order/seller/product-orders?from=${from}&to=${to}&limitCount=300`
      let r
      try {
        r = await httpsRequest(
          `https://api.commerce.naver.com${uri}`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        )
      } catch (e) {
        return { ok: false, error: `smartstore orders 호출 실패 (${day}): ${e.message}`, retryable: true }
      }

      if (r.status === 401) {
        // 캐시 무효화 → 다음 polling에서 재발급
        smartstoreTokenCache.delete(clientId)
        return { ok: false, error: 'smartstore access_token 만료 (401)', retryable: true }
      }
      if (r.status !== 200) {
        return {
          ok: false,
          error: `smartstore API 에러 (${r.status}, ${day}): ${JSON.stringify(r.data).slice(0, 200)}`,
          retryable: true,
        }
      }

      const items = Array.isArray(r.data?.data?.contents) ? r.data.data.contents
                  : Array.isArray(r.data?.data) ? r.data.data
                  : []
      allDetails.push(...items)
      // 다음 day fetch 전 짧은 sleep (rate limit 안전)
      await new Promise((resolve) => setTimeout(resolve, 300))
    }

    if (allDetails.length === 0) {
      return { ok: true, rowsUpserted: 0, meta: { items_inserted: 0 } }
    }

    // orderId로 그룹핑 (sync.js 라인 117~167 패턴)
    const orderMap = new Map()
    for (const detail of allDetails) {
      const po = detail.content?.productOrder || detail.productOrder
      const order = detail.content?.order || detail.order
      if (!po || !order) continue
      const orderId = order.orderId
      const isCancelled = CANCEL_STATUSES.includes(po.productOrderStatus)
      const paymentDate = (order.paymentDate || '').slice(0, 10)

      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, {
          order_id: orderId,
          order_date: paymentDate,
          canceled: 'F',
          first_order: order.firstOrderYn === 'Y' ? 'T' : 'F',
          actual_amount: 0,
          initial_amount: 0,
          actual_original: 0,
          initial_original: 0,
          items: [],
        })
      }

      const grp = orderMap.get(orderId)
      const qty = Number(po.quantity || 1)
      const unitPrice = Number(po.unitPrice || 0)
      const totalPayAmt = Number(po.totalPaymentAmount || 0)
      const sellerStoreDc = Number(po.sellerBurdenStoreDiscountAmount || 0)
      const naverProdDc = Math.max(
        0,
        Number(po.productProductDiscountAmount || 0) - Number(po.sellerBurdenProductDiscountAmount || 0)
      )
      const totalAmt = totalPayAmt + sellerStoreDc + naverProdDc

      grp.items.push({
        product_no: String(po.productId || ''),
        product_name: po.productName || '상품',
        quantity: qty,
        order_price_amount: unitPrice,
      })

      if (isCancelled) {
        grp.initial_amount += totalAmt
        grp.initial_original += unitPrice * qty
        grp.canceled = 'T'
      } else {
        grp.actual_amount += totalAmt
        grp.actual_original += unitPrice * qty
      }
    }

    const groupedOrders = Array.from(orderMap.values())

    // upsert (sync.js 라인 174~210 패턴)
    let totalOrdersUpserted = 0
    let totalItemsInserted = 0
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

      if (upsertErr) {
        return { ok: false, error: `orders upsert 실패: ${upsertErr.message}`, retryable: true }
      }

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
          if (itemErr) {
            return { ok: false, error: `order_items INSERT 실패: ${itemErr.message}`, retryable: true }
          }
          totalItemsInserted += itemRows.length
        }
      }
    }

    return {
      ok: true,
      rowsUpserted: totalOrdersUpserted,
      meta: { items_inserted: totalItemsInserted },
    }
  },
}
```

- [ ] **Step 3: 로컬 syntax check**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node --check lib/adapters.js
```

기대: 출력 없음.

- [ ] **Step 4: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): smartstore syncOrders 실 구현 (일별 pagination + orderId 그룹핑 + orders/order_items upsert)"
git push
```

---

### Task 5: 가상서버 deploy + reload (사용자 직접)

**Files:** 외부 작업 (scp + pm2 reload)

**Interfaces:**
- Produces: 가상서버 `/root/sync-worker/lib/adapters.js`가 최신 코드 + PM2 sync-worker 재시작 + 정상 로그

- [ ] **Step 1: 로컬에서 가상서버로 adapters.js 동기화**

로컬 PowerShell:

```powershell
scp C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker\lib\adapters.js root@203.245.41.105:/root/sync-worker/lib/adapters.js
```

- [ ] **Step 2: 가상서버 PM2 reload + 로그 확인**

가상서버 SSH:

```bash
pm2 reload sync-worker
sleep 5
pm2 logs sync-worker --lines 15 --nostream
```

기대: `sync-worker starting` + 추가 에러 없음.

이 task는 외부 작업이라 커밋 없음.

---

### Task 6: 통합 수동 검증 (사용자 직접)

**Files:** 외부 작업 (브라우저 + SSH + SQL Editor)

**Interfaces:**
- Produces: spec §8 검증 시나리오 7개 모두 통과

이 task는 사용자가 직접 진행. 결과를 chat으로 보고.

- [ ] **Step 1: 인프라 (1)**

PM2 list 확인:

```bash
pm2 list
```

기대: `sync-worker` 행의 `↺` 카운트가 reload 이후 안 증가.

- [ ] **Step 2: 스마트스토어 자격증명 등록**

`https://order-manager-saas-bay.vercel.app` 시크릿 창에서:
1. 운영자 로그인 (`ssakwon@kbh.kr`)
2. "+ 브랜드 추가" → 이름 `Plan 6 검증` → 추가
3. "+ 스마트스토어 계정 추가" → 별칭 `테스트` + 본인 PALEO_APP_ID/SECRET → 등록 → ✅ 표시

가상서버 .env에서 `PALEO_APP_ID`/`PALEO_APP_SECRET` 확인:

```bash
grep "^PALEO_APP" /root/naver-proxy/.env
```

- [ ] **Step 3: 수동 enqueue syncOrders**

Supabase SQL Editor:

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'orders', now()
FROM brand_credentials WHERE channel='smartstore' AND status='active' LIMIT 1;
```

- [ ] **Step 4: 1~2분 후 결과 확인**

```sql
-- 잡 결과
SELECT status, result_summary, error_message
FROM sync_jobs WHERE job_type='orders' AND channel='smartstore'
ORDER BY created_at DESC LIMIT 3;

-- orders + order_items 행 수 (mall_type='테스트'로 필터)
SELECT
  (SELECT count(*) FROM orders WHERE mall_type='테스트') AS orders_count,
  (SELECT count(*) FROM order_items oi
   JOIN orders o ON o.id = oi.order_id WHERE o.mall_type='테스트') AS items_count;
```

기대:
- 잡 결과: `status='completed'`, `result_summary={"rowsUpserted":N, "items_inserted":M}`
- orders/items에 N/M 행

> 만약 에러나면 `error_message` 확인 후 같은 패턴으로 fix (Plan 5 catalog_products/orders 경험과 동일).

- [ ] **Step 5: Token 캐시 검증 (2번 빠른 enqueue → 발급 1회)**

빠르게 2번 enqueue:

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'orders', now()
FROM brand_credentials WHERE channel='smartstore' AND status='active' LIMIT 1;
-- 즉시 한 번 더
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'orders', now()
FROM brand_credentials WHERE channel='smartstore' AND status='active' LIMIT 1;
```

5초~10초 후 가상서버 로그:

```bash
pm2 logs sync-worker --lines 30 --nostream | grep -i "token\|picked\|completed"
```

기대: 첫 picked → token 발급 (httpsRequest 출력은 없지만 잡 진행), 두 번째 picked → 캐시 hit (별도 발급 로그 없음 — 같은 token 사용).

> Plan 6의 token 발급은 log() 호출 안 함. 캐시 hit 검증은 응답 시간으로 간접 확인 (또는 console.log 임시 추가).

- [ ] **Step 6: Plan 5 mall_type hotfix 검증 (카페24 재실행)**

기존 또는 새 카페24 자격증명에 대해 수동 enqueue:

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'orders', now()
FROM brand_credentials WHERE channel='cafe24' AND status='active' LIMIT 1;
```

1~2분 후:

```sql
SELECT DISTINCT mall_type FROM orders
WHERE brand_id IN (SELECT brand_id FROM brand_credentials WHERE channel='cafe24');
```

기대: `mall_type`이 mall_id 값 (예: 'paleo', 'dokebi') — `'cafe24'` 고정값 아님.

- [ ] **Step 7: cleanup (선택)**

```sql
DELETE FROM brands WHERE name='Plan 6 검증';
DELETE FROM vault.secrets WHERE id NOT IN (SELECT secret_id FROM brand_credentials WHERE secret_id IS NOT NULL);
DELETE FROM sync_jobs WHERE created_at < now() - interval '1 hour' OR status IN ('completed','failed');

SELECT
  (SELECT count(*) FROM brand_credentials) AS bc,
  (SELECT count(*) FROM vault.secrets) AS vs,
  (SELECT count(*) FROM sync_jobs) AS sj;
```

기대: bc=0, vs=0, sj 작은 수 또는 0.

이 task는 외부 작업이라 커밋 없음.

---

## Plan 6 완료 기준 체크리스트

- [ ] cafe24Adapter.syncOrders의 mall_type을 channelAccount로 (Plan 5 hotfix)
- [ ] TypeScript smartstore.ts에 syncOrders 시그니처 추가
- [ ] 가상서버 adapters.js에 bcrypt require + smartstoreTokenCache + getSmartstoreToken helper
- [ ] 가상서버 smartstoreAdapter.syncOrders 실 구현
- [ ] 가상서버 deploy + PM2 reload + 정상 로그
- [ ] 통합 검증 시나리오 7개 통과 (특히 4 syncOrders 실 데이터 + 6 hotfix 검증)

## Plan 6 이후 — Plan 7 / Plan 5b / Plan 6b 예고

- **Plan 7**: 네이버광고 syncAdStats + syncAdUnits (HMAC 서명 + ad_units/ad_stats 테이블 upsert)
- **Plan 5b**: 팔레오 카페24 컷오버 (Plan 5·6 안정 운영 후)
- **Plan 6b**: 코코엘 스마트스토어 컷오버

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| naver commerce 응답 포맷이 sync.js와 다른 부분 (시간 경과로 API 변경) | 같은 endpoint라 영향 동일. 검증 시 catch |
| 캐시된 토큰이 만료 직전 401 | 만료 5분 마진 + 401 시 `smartstoreTokenCache.delete(clientId)` + retryable=true로 다음 polling에서 재시도 |
| 같은 brand에 같은 client_id 두 번 등록 | brand_credentials UNIQUE(brand_id, channel, channel_account)가 별칭 다르면 허용. 같은 별칭이면 차단. orders는 mall_type(=channelAccount)로 분리됨 |
| Plan 5의 'cafe24' 고정값 → channelAccount 변경 시 기존 orders.mall_type='cafe24' 행 존재 | 새 sync에서 같은 brand_id + 같은 order_no면 upsert가 mall_type 새 값으로 덮어씀. 자연 마이그레이션. 단 새 mall_type과 기존 'cafe24' 행이 같은 (brand_id, order_no) 키면 충돌 — 한 번 upsert 후 정상 |
| 가상서버 sync-worker reload 시 Map 캐시 비워짐 | 다음 호출 1번 추가 발급. 30분 cron 단위라 영향 작음 |
| sync.js와 새 sync-worker 동시 운영 → 같은 mall의 같은 order_no 두 번 upsert | upsert key 동일 (brand_id, order_no), idempotent. 데이터 동일. mall_type만 다를 수 있는데 둘 다 채널 별칭 사용해서 일치 |
| orders 테이블의 컬럼이 spec 가정과 다른 부분 | Plan 5 검증에서 이미 mall_type/total_qty/is_cancelled/is_new 확인됨. order_items는 product_name/category/qty/amount. 일치 |
