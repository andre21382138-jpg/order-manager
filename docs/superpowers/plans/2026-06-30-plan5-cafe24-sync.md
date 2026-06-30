# Plan 5 — 카페24 sync 구현 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 4의 sync 인프라 위에 카페24 어댑터의 `refreshToken` / `syncOrders` / `syncProducts` 메서드를 실 구현한다. 기존 `order-manager/api/cafe24.js`의 카페24 API 호출 패턴과 `order-manager/server/sync.js`의 Supabase upsert 패턴을 합성해 가상서버 sync-worker의 `lib/adapters.js`에 채워 넣는다. 기존 cron은 그대로 유지(병행 운영). 컷오버는 Plan 5b.

**Architecture:** 가상서버 sync-worker가 `pick_pending_job` → cafe24 adapter method 호출 → fetch + parse + Supabase upsert → `markCompleted`. `token_refresh` 결과는 worker에서 `update_vault_secret` RPC + `brand_credentials.metadata.expires_at` 갱신. Vercel cafe24.ts는 sync 메서드 시그니처만 추가(no-op throw — 가상서버 외 호출 차단). Plan 2 OAuth callback이 `metadata.expires_at`을 INSERT 시점에 채워서 token_refresh cron 정확도 ↑.

**Tech Stack:** Node 20 (가상서버), CommonJS, `@supabase/supabase-js` (Vault wrapper + DB), 카페24 API v2 (`*.cafe24api.com`, `X-Cafe24-Api-Version: 2025-12-01`), Next.js 16 + TypeScript (Vercel — 시그니처만), Supabase Vault.

**Spec:** `docs/superpowers/specs/2026-06-30-plan5-cafe24-sync-design.md`

**참조 코드** (implementer가 직접 read해서 패턴 추출):
- `c:\Users\Jangkwon\Desktop\order-manager\api\cafe24.js` — 카페24 OAuth refresh + orders/products fetch URL/headers/pagination
- `c:\Users\Jangkwon\Desktop\order-manager\server\sync.js` — Supabase REST upsert 패턴 (orders/order_items, catalog_products의 upsert key + 컬럼 매핑)

## Global Constraints

- **레포 위치 (로컬)**: `C:\Users\Jangkwon\Desktop\order-manager-saas`
- **가상서버**: `203.245.41.105`, `/root/sync-worker/`
- **신규 PM2 변경 없음** — 기존 sync-worker + validate-proxy 그대로 + reload만
- **카페24 API base**: `https://{mallId}.cafe24api.com`
- **카페24 API version 헤더**: `X-Cafe24-Api-Version: 2025-12-01`
- **토큰 endpoint**: `POST /api/v2/oauth/token` — Basic auth `base64({appId}:{appSecret})` + body `grant_type=refresh_token&refresh_token={refreshToken}`
- **orders endpoint**: `GET /api/v2/admin/orders?shop_no=1&start_date={s}&end_date={e}&limit=100&offset={o}&embed=items` — Bearer
- **products endpoint**: `GET /api/v2/admin/products?shop_no=1&limit=100&offset={o}` — Bearer
- **페이지네이션 종료 조건**: `!response.links?.some(l => l.rel === 'next')`
- **데이터 범위 default**: 어제·오늘 KST (sync.js의 `yesterdayKST()` + `todayKST()` 패턴 참조)
- **upsert 패턴**: sync.js 라인 174~206 그대로 차용 — orders는 `on_conflict=order_no,brand_id`, order_items는 DELETE + INSERT
- **카페24 응답 → 컬럼 매핑**: implementer가 sync.js의 스마트스토어 매핑(라인 174~206) + cafe24.js의 카페24 응답 형식을 보고 합성. 알려진 컬럼: `orders(brand_id, order_no, order_date, ...)`, `order_items(brand_id, order_id, product_no, quantity, price, ...)`, `catalog_products(brand_id, product_no, product_name, selling_price, retail_price, ...)`.
- **자동 테스트 무** — Plan 4와 동일, 빌드 통과 + 운영자 수동 검증
- **TypeScript strict 유지** (Vercel 측)
- **CommonJS** (가상서버 측)
- **Vault payload 평문 로깅 금지** (Plan 2·4와 동일)

## File Structure (Plan 5 완료 시점)

```
order-manager-saas/
├── app/
│   └── auth/cafe24/callback/route.ts          # ★ 변경 — metadata.expires_at 추가
├── lib/
│   └── adapters/
│       └── cafe24.ts                          # ★ 변경 — sync 메서드 시그니처 (throw)
├── supabase/migrations/
│   └── 013_vault_update_wrapper.sql           # ★ 신규
└── server/
    └── sync-worker/
        ├── lib/
        │   └── adapters.js                    # ★ 변경 — cafe24 stub → 실 구현
        ├── worker.js                          # ★ 변경 — token_refresh 분기 추가
        └── (기타 Plan 4 그대로)
```

---

### Task 1: `013_vault_update_wrapper.sql` 마이그레이션 + 사용자 실행

**Files:**
- Create: `supabase/migrations/013_vault_update_wrapper.sql`

**Interfaces:**
- Produces: `public.update_vault_secret(secret_id uuid, new_secret text) RETURNS void` RPC — service_role 전용

- [ ] **Step 1: `013_vault_update_wrapper.sql` 작성**

```sql
-- Plan 5 / Task 1 — vault.update_secret을 public schema에서 service_role로 호출

CREATE OR REPLACE FUNCTION public.update_vault_secret(
  secret_id uuid,
  new_secret text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  PERFORM vault.update_secret(secret_id, new_secret);
END;
$$;

REVOKE ALL ON FUNCTION public.update_vault_secret(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_vault_secret(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_vault_secret(uuid, text) TO service_role;
```

- [ ] **Step 2: 사용자가 Supabase SQL Editor에서 실행**

Supabase 대시보드 → SQL Editor → 위 파일 내용 통째로 복사 → Run.

- [ ] **Step 3: 검증 쿼리**

```sql
SELECT proname, pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'update_vault_secret';
```

기대: 1행, args = `secret_id uuid, new_secret text`

- [ ] **Step 4: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add supabase/migrations/013_vault_update_wrapper.sql
git commit -m "feat(db): update_vault_secret public wrapper (Plan 5)"
git push
```

---

### Task 2: Vercel `lib/adapters/cafe24.ts`에 sync 메서드 시그니처 추가

**Files:**
- Modify: `lib/adapters/cafe24.ts`

**Interfaces:**
- Consumes: `RefreshResult`, `SyncResult`, `SyncContext`, `CredentialPayload` (Plan 4 _types.ts에 이미 정의)
- Produces: cafe24Adapter에 `refreshToken`, `syncOrders`, `syncProducts` 메서드 등장 — 단 Vercel은 호출 안 함. 호출 시 throw로 가상서버 외 호출 차단.

- [ ] **Step 1: `lib/adapters/cafe24.ts` 끝부분(adapter export 직전)에 추가**

기존 코드를 찾기 — 다음과 같은 형태로 끝남:

```typescript
export const cafe24Adapter: ChannelAdapter = {
  channel: 'cafe24',
  category: 'shop',
  authType: 'oauth',
  getAuthUrl,
  handleCallback,
  validate,
}
```

이 export 직전에 세 함수 정의 추가:

```typescript
async function refreshToken(
  _creds: CredentialPayload
): Promise<{ ok: false; error: string }> {
  throw new Error('refreshToken must run on virtual server sync-worker (not Vercel)')
}

async function syncOrders(
  _creds: CredentialPayload,
  _ctx: SyncContext
): Promise<{ ok: false; error: string; retryable: boolean }> {
  throw new Error('syncOrders must run on virtual server sync-worker (not Vercel)')
}

async function syncProducts(
  _creds: CredentialPayload,
  _ctx: SyncContext
): Promise<{ ok: false; error: string; retryable: boolean }> {
  throw new Error('syncProducts must run on virtual server sync-worker (not Vercel)')
}
```

그리고 adapter export 객체에 추가:

```typescript
export const cafe24Adapter: ChannelAdapter = {
  channel: 'cafe24',
  category: 'shop',
  authType: 'oauth',
  getAuthUrl,
  handleCallback,
  validate,
  refreshToken,
  syncOrders,
  syncProducts,
}
```

> 첫 줄에 `import type { SyncContext } from './_types'`가 빠져있을 수 있음 — 추가 필요. 기존 import에 `SyncContext` 누락이면 한 줄 보강.

- [ ] **Step 2: import 확인**

파일 상단의 import 라인이 다음을 포함해야 함:

```typescript
import type {
  ChannelAdapter,
  GetAuthUrlInput,
  HandleCallbackInput,
  CredentialPayload,
  ValidateResult,
  SyncContext,  // Plan 5 신규
} from './_types'
```

`SyncContext`가 없으면 추가.

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음.

- [ ] **Step 4: 커밋**

```powershell
git add lib/adapters/cafe24.ts
git commit -m "feat(adapters): cafe24.ts에 sync 메서드 시그니처 추가 (throw — 가상서버 전용)"
git push
```

---

### Task 3: Plan 2 OAuth callback에 `metadata.expires_at` 추가

**Files:**
- Modify: `app/auth/cafe24/callback/route.ts`

**Interfaces:**
- Consumes: `payload.expiresAt` (Plan 2 cafe24 어댑터의 handleCallback이 이미 채움)
- Produces: `brand_credentials.metadata`에 `expires_at` 키 자동 채워짐. pg_cron `enqueue_token_refresh`가 정확히 만료 임박 자격증명만 큐잉.

- [ ] **Step 1: `app/auth/cafe24/callback/route.ts` 수정**

기존 INSERT 부분을 찾기 — 대략 다음과 같은 형태:

```typescript
const { error: insertErr } = await admin
  .from('brand_credentials')
  .insert({
    brand_id: stateData.brandId,
    channel: 'cafe24',
    channel_account: stateData.mallId,
    secret_id: secretId,
    status: 'active',
    metadata: { scope: 'mall.read_order,mall.write_order,mall.read_analytics,mall.read_product,mall.read_category' },
  })
```

`metadata` 객체에 `expires_at` 추가:

```typescript
const { error: insertErr } = await admin
  .from('brand_credentials')
  .insert({
    brand_id: stateData.brandId,
    channel: 'cafe24',
    channel_account: stateData.mallId,
    secret_id: secretId,
    status: 'active',
    metadata: {
      scope: 'mall.read_order,mall.write_order,mall.read_analytics,mall.read_product,mall.read_category',
      expires_at: payload.expiresAt,
    },
  })
```

> `payload`는 같은 함수 위쪽에서 `adapter.handleCallback(...)` 결과로 얻은 `CredentialPayload`. 이미 `expiresAt` 필드를 포함하고 있음 (Plan 2 검증 시 vault.decrypted_secrets에 확인됨).

- [ ] **Step 2: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음.

- [ ] **Step 3: 커밋**

```powershell
git add app/auth/cafe24/callback/route.ts
git commit -m "feat(callback): cafe24 brand_credentials.metadata.expires_at 채움 (Plan 5)"
git push
```

---

### Task 4: 가상서버 `lib/adapters.js` — refreshToken 구현

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Produces: cafe24Adapter.refreshToken(creds) — 카페24 oauth/token endpoint 호출, 새 토큰 + expiresAt 반환

**참조**: `c:\Users\Jangkwon\Desktop\order-manager\api\cafe24.js`의 `action === "refresh"` 분기 (대략 line 58~74). 같은 URL + Basic auth 패턴 그대로.

- [ ] **Step 1: `lib/adapters.js`의 cafe24 stub을 다음으로 교체**

기존 (Plan 4):
```javascript
const cafe24Adapter = {
  channel: 'cafe24',
  // syncOrders/syncProducts/syncAdUnits/refreshToken — Plan 5에서 구현
}
```

Plan 5 변경 — 동일 파일 상단에 `https` import 추가 + cafe24Adapter에 refreshToken 함수:

```javascript
const https = require('https')

function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = { _raw: data } }
        resolve({ status: res.statusCode, data: parsed })
      })
    })
    req.on('error', reject)
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

const cafe24Adapter = {
  channel: 'cafe24',

  async refreshToken(creds) {
    const { appId, appSecret, mallId, refreshToken } = creds
    if (!appId || !appSecret || !mallId || !refreshToken) {
      return { ok: false, error: 'cafe24 자격증명 필수 필드 누락' }
    }
    const credBasic = Buffer.from(`${appId}:${appSecret}`).toString('base64')
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    let r
    try {
      r = await httpsRequest(
        `https://${mallId}.cafe24api.com/api/v2/oauth/token`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credBasic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        body
      )
    } catch (e) {
      return { ok: false, error: `네트워크 실패: ${e.message}` }
    }
    if (r.status !== 200 || !r.data?.access_token) {
      // 카페24 refresh_token 자체가 만료/회수된 경우 - retryable=false
      return {
        ok: false,
        error: `카페24 refresh 실패 (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`,
      }
    }
    return {
      ok: true,
      newPayload: {
        appId,
        appSecret,
        mallId,
        accessToken: r.data.access_token,
        refreshToken: r.data.refresh_token,
        expiresAt: r.data.expires_at,
      },
    }
  },

  // syncOrders / syncProducts — Task 5, 6에서 추가
}
```

- [ ] **Step 2: 로컬에서 syntax 확인**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node -e "require('./lib/adapters'); console.log('ok')"
```

기대: `ok` 출력. syntax error 없음.

> 이 명령은 .env 없이 실행하므로 사용 시 SUPABASE_URL/KEY 검증을 안 하는 createAdminClient를 직접 require하지 않음 (adapters.js만 require). lib/supabase는 외부 호출 시점에만 throw하므로 require 자체는 OK.

- [ ] **Step 3: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): cafe24 refreshToken 구현"
git push
```

---

### Task 5: 가상서버 `lib/adapters.js` — syncProducts 구현

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: `httpsRequest` (Task 4), 카페24 access_token (creds), `ctx.brandId`, Supabase admin client (worker.js에서 주입은 아니므로 어댑터 안에서 createAdminClient 호출 — Plan 4 lib/supabase.js의 패턴)
- Produces: cafe24Adapter.syncProducts(creds, ctx) — 카페24 products 페이지네이션 fetch + catalog_products upsert

**참조**:
- `c:\Users\Jangkwon\Desktop\order-manager\api\cafe24.js`의 products 호출 패턴 (시간 들여서 grep — `admin/products` 검색)
- `c:\Users\Jangkwon\Desktop\order-manager\server\sync.js` 라인 96~206 — supabaseQuery upsert 패턴 (orders + order_items이지만 catalog_products도 동일 구조)

- [ ] **Step 1: lib/adapters.js에 syncProducts 메서드 추가**

cafe24Adapter 객체 안에 (refreshToken 다음에):

```javascript
  async syncProducts(creds, ctx) {
    const { mallId, accessToken } = creds
    const brandId = ctx.brandId
    if (!mallId || !accessToken || !brandId) {
      return { ok: false, error: 'syncProducts: 필수 인자 누락', retryable: false }
    }

    const { createAdminClient } = require('./supabase')
    const admin = createAdminClient()

    let totalUpserted = 0
    let offset = 0
    const limit = 100

    while (true) {
      let r
      try {
        r = await httpsRequest(
          `https://${mallId}.cafe24api.com/api/v2/admin/products?shop_no=1&limit=${limit}&offset=${offset}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'X-Cafe24-Api-Version': '2025-12-01',
            },
          }
        )
      } catch (e) {
        return { ok: false, error: `카페24 products 호출 실패: ${e.message}`, retryable: true }
      }

      if (r.status === 401) {
        return { ok: false, error: 'access_token 만료 (401)', retryable: true }
      }
      if (r.status !== 200) {
        return {
          ok: false,
          error: `카페24 products API 에러 (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`,
          retryable: true,
        }
      }

      const products = Array.isArray(r.data?.products) ? r.data.products : []
      if (products.length === 0) break

      // 카페24 product → catalog_products row 매핑
      // 컬럼: brand_id, product_no, product_name, selling_price, supply_price, retail_price (Plan 1 마이그레이션 시 추가됨), display, selling
      const rows = products.map((p) => ({
        brand_id: brandId,
        product_no: String(p.product_no ?? p.product_code ?? ''),
        product_name: String(p.product_name ?? ''),
        selling_price: Number(p.price ?? 0),
        supply_price: Number(p.supply_price ?? 0),
        retail_price: Number(p.retail_price ?? 0),
        display: p.display === 'T',
        selling: p.selling === 'T',
        synced_at: new Date().toISOString(),
      }))

      const { error: upsertErr, count } = await admin
        .from('catalog_products')
        .upsert(rows, { onConflict: 'brand_id,product_no', count: 'exact' })

      if (upsertErr) {
        return {
          ok: false,
          error: `catalog_products upsert 실패: ${upsertErr.message}`,
          retryable: true,
        }
      }

      totalUpserted += count ?? rows.length

      const hasNext = Array.isArray(r.data?.links) && r.data.links.some((l) => l.rel === 'next')
      if (!hasNext) break
      offset += limit
    }

    return { ok: true, rowsUpserted: totalUpserted }
  },
```

> 정확한 카페24 product 필드(`p.product_no` vs `p.product_code`, `p.price` vs `p.selling_price`)는 implementer가 카페24 docs + api/cafe24.js 응답 형식을 보고 확인. 일반적인 카페24 응답이 `product_no`/`price`라 위 매핑 사용.

- [ ] **Step 2: 로컬 syntax 확인**

```powershell
node -e "require('./lib/adapters'); console.log('ok')"
```

- [ ] **Step 3: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): cafe24 syncProducts 구현 (catalog_products upsert)"
git push
```

---

### Task 6: 가상서버 `lib/adapters.js` — syncOrders 구현

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: httpsRequest, createAdminClient, ctx.dateRangeStart/dateRangeEnd (default 어제·오늘 KST)
- Produces: cafe24Adapter.syncOrders(creds, ctx) — orders + order_items 동기화. order_items는 DELETE + INSERT 패턴 (sync.js 라인 197~207과 동일)

- [ ] **Step 1: lib/adapters.js 상단에 KST 헬퍼 + cafe24Adapter에 syncOrders 추가**

`https` require 옆에 헬퍼 추가:

```javascript
function yesterdayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - 86400000)
  return d.toISOString().slice(0, 10)
}

function todayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}
```

cafe24Adapter 객체 안에 (syncProducts 다음에):

```javascript
  async syncOrders(creds, ctx) {
    const { mallId, accessToken } = creds
    const brandId = ctx.brandId
    if (!mallId || !accessToken || !brandId) {
      return { ok: false, error: 'syncOrders: 필수 인자 누락', retryable: false }
    }

    const startDate = ctx.dateRangeStart || yesterdayKST()
    const endDate = ctx.dateRangeEnd || todayKST()

    const { createAdminClient } = require('./supabase')
    const admin = createAdminClient()

    let totalOrdersUpserted = 0
    let totalItemsInserted = 0
    let offset = 0
    const limit = 100

    while (true) {
      let r
      try {
        r = await httpsRequest(
          `https://${mallId}.cafe24api.com/api/v2/admin/orders?shop_no=1&start_date=${startDate}&end_date=${endDate}&limit=${limit}&offset=${offset}&embed=items`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'X-Cafe24-Api-Version': '2025-12-01',
            },
          }
        )
      } catch (e) {
        return { ok: false, error: `카페24 orders 호출 실패: ${e.message}`, retryable: true }
      }

      if (r.status === 401) {
        return { ok: false, error: 'access_token 만료 (401)', retryable: true }
      }
      if (r.status !== 200) {
        return {
          ok: false,
          error: `카페24 orders API 에러 (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`,
          retryable: true,
        }
      }

      const orders = Array.isArray(r.data?.orders) ? r.data.orders : []
      if (orders.length === 0) break

      // orders upsert (sync.js의 on_conflict=order_no,brand_id 패턴)
      const orderRows = orders.map((o) => ({
        brand_id: brandId,
        order_no: String(o.order_id ?? ''),
        order_date: o.order_date ?? null,
        payment_date: o.payment_date ?? null,
        member_id: o.member_id ?? null,
        total_amount: Number(o.actual_payment_amount ?? o.order_price_amount ?? 0),
        status: o.order_status ?? '',
        synced_at: new Date().toISOString(),
      }))

      const { data: savedOrders, error: upsertErr } = await admin
        .from('orders')
        .upsert(orderRows, { onConflict: 'brand_id,order_no' })
        .select('id, order_no')

      if (upsertErr) {
        return {
          ok: false,
          error: `orders upsert 실패: ${upsertErr.message}`,
          retryable: true,
        }
      }

      totalOrdersUpserted += savedOrders?.length ?? 0

      // order_items: DELETE + INSERT (sync.js 패턴)
      for (const saved of (savedOrders ?? [])) {
        const orig = orders.find((o) => String(o.order_id) === saved.order_no)
        if (!orig || !Array.isArray(orig.items)) continue

        await admin.from('order_items').delete().eq('order_id', saved.id)

        const itemRows = orig.items.map((it) => ({
          order_id: saved.id,
          product_no: String(it.product_no ?? it.product_code ?? ''),
          variant_code: String(it.variants_code ?? ''),
          product_name: String(it.product_name ?? ''),
          quantity: Number(it.quantity ?? 0),
          price: Number(it.product_price ?? 0),
        }))

        if (itemRows.length > 0) {
          const { error: itemErr } = await admin.from('order_items').insert(itemRows)
          if (itemErr) {
            return {
              ok: false,
              error: `order_items INSERT 실패: ${itemErr.message}`,
              retryable: true,
            }
          }
          totalItemsInserted += itemRows.length
        }
      }

      const hasNext = Array.isArray(r.data?.links) && r.data.links.some((l) => l.rel === 'next')
      if (!hasNext) break
      offset += limit
    }

    return {
      ok: true,
      rowsUpserted: totalOrdersUpserted,
      meta: { items_inserted: totalItemsInserted },
    }
  },
```

- [ ] **Step 2: 로컬 syntax 확인**

```powershell
node -e "require('./lib/adapters'); console.log('ok')"
```

- [ ] **Step 3: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): cafe24 syncOrders 구현 (orders upsert + order_items DELETE/INSERT)"
git push
```

---

### Task 7: 가상서버 `worker.js`에 token_refresh result 분기

**Files:**
- Modify: `server/sync-worker/worker.js`

**Interfaces:**
- Consumes: `admin.rpc('update_vault_secret', { secret_id, new_secret })` (Task 1 SQL), `cred.metadata` (이미 SELECT 함)
- Produces: token_refresh가 성공하면 Vault payload가 갱신되고 brand_credentials.metadata.expires_at도 새 값으로 동기화

- [ ] **Step 1: `worker.js`의 `result.ok` 분기를 찾기 + 확장**

기존 코드(대략):

```javascript
    if (result.ok) {
      await markCompleted(job.id, {
        rowsUpserted: result.rowsUpserted ?? 0,
        ...(result.meta ?? {}),
      })
      await admin
        .from('brand_credentials')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', cred.id)
      log('INFO', `job ${job.id} completed (rows: ${result.rowsUpserted ?? 0})`)
    } else {
      await markFailed(job.id, job.retry_count, result.error, result.retryable)
      log('WARN', `job ${job.id} failed`, { error: result.error })
    }
```

다음으로 교체:

```javascript
    if (result.ok) {
      // Plan 5: token_refresh 결과면 Vault + metadata 갱신
      if (job.job_type === 'token_refresh') {
        const { error: vaultUpdErr } = await admin.rpc('update_vault_secret', {
          secret_id: cred.secret_id,
          new_secret: JSON.stringify(result.newPayload),
        })
        if (vaultUpdErr) {
          await markFailed(job.id, job.retry_count, `vault update failed: ${vaultUpdErr.message}`, true)
          log('ERROR', `job ${job.id} vault update failed`, { msg: vaultUpdErr.message })
          return
        }
        const newMetadata = {
          ...(cred.metadata ?? {}),
          expires_at: result.newPayload.expiresAt,
        }
        await admin
          .from('brand_credentials')
          .update({ metadata: newMetadata })
          .eq('id', cred.id)
        await markCompleted(job.id, { refreshed: true, ...(result.meta ?? {}) })
        await admin
          .from('brand_credentials')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', cred.id)
        log('INFO', `job ${job.id} token refreshed (expires_at: ${result.newPayload.expiresAt})`)
      } else {
        await markCompleted(job.id, {
          rowsUpserted: result.rowsUpserted ?? 0,
          ...(result.meta ?? {}),
        })
        await admin
          .from('brand_credentials')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', cred.id)
        log('INFO', `job ${job.id} completed (rows: ${result.rowsUpserted ?? 0})`)
      }
    } else {
      await markFailed(job.id, job.retry_count, result.error, result.retryable)
      log('WARN', `job ${job.id} failed`, { error: result.error })
    }
```

- [ ] **Step 2: 로컬 syntax 확인**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node -e "require('./worker'); console.log('ok')"
```

> 이건 worker.js를 require하므로 createAdminClient 실행됨. SUPABASE_URL/KEY 없으면 throw → 정상 (require 시점에는 createAdminClient 호출 안 하는 패턴이라야 OK). 만약 throw 되면 worker.js 상단 `const admin = createAdminClient()` 라인을 lazy 로딩 패턴으로 변경 필요. 대안: `node --check worker.js`로 syntax만:

```powershell
node --check ./worker.js
```

기대: 출력 없음 (= syntax OK).

- [ ] **Step 3: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/worker.js
git commit -m "feat(sync-worker): token_refresh result 분기 (vault update + metadata 동기화)"
git push
```

---

### Task 8: 가상서버 deploy + 통합 검증 (사용자 직접)

**Files:** 외부 작업 (가상서버 SSH + Supabase SQL Editor + 브라우저)

**Interfaces:**
- Produces: spec §8의 12 검증 시나리오 모두 통과

이 task는 사용자가 직접 진행.

- [ ] **Step 1: 가상서버에 코드 동기화**

방법 A — rsync (Windows에서 git-bash):
```bash
rsync -av --exclude='.env' --exclude='node_modules' --exclude='*.log' \
  /c/Users/Jangkwon/Desktop/order-manager-saas/server/sync-worker/ \
  root@203.245.41.105:/root/sync-worker/
```

방법 B — git pull (가상서버에서 직접):
```bash
ssh root@203.245.41.105
cd /tmp
rm -rf order-manager-saas
git clone https://github.com/andre21382138-jpg/order-manager-saas.git
cp -r order-manager-saas/server/sync-worker/lib/adapters.js /root/sync-worker/lib/adapters.js
cp -r order-manager-saas/server/sync-worker/worker.js /root/sync-worker/worker.js
rm -rf order-manager-saas
```

방법 C — scp (가장 단순):
```powershell
scp C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker\lib\adapters.js root@203.245.41.105:/root/sync-worker/lib/adapters.js
scp C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker\worker.js root@203.245.41.105:/root/sync-worker/worker.js
```

- [ ] **Step 2: PM2 reload**

가상서버 SSH:

```bash
cd /root/sync-worker
pm2 reload sync-worker
pm2 logs sync-worker --lines 10 --nostream
```

기대: `sync-worker starting` 로그 + 큐 비었으면 추가 로그 없음.

- [ ] **Step 3: callback 수정 확인 (시나리오 2)**

Vercel 프로덕션은 push 후 자동 빌드. Vercel Deployments 탭에서 Ready 확인.

`https://order-manager-saas-bay.vercel.app` 시크릿 창 → 로그인 → 임시 브랜드 "Plan 5 검증" → 카페24 mall 등록 (팔레오 mall_id + PALEO_APP_ID/SECRET) → ✅ 표시

Supabase SQL Editor:
```sql
SELECT metadata FROM brand_credentials WHERE channel = 'cafe24' ORDER BY created_at DESC LIMIT 1;
```

기대: `{"scope":"...", "expires_at":"2026-..."}` — expires_at이 NULL 아님

- [ ] **Step 4: refreshToken 동작 확인 (시나리오 3)**

방금 등록한 자격증명의 metadata.expires_at을 강제로 임박하게:

```sql
UPDATE brand_credentials
SET metadata = jsonb_set(metadata, '{expires_at}', to_jsonb((now() + interval '10 minutes')::text))
WHERE channel = 'cafe24' ORDER BY created_at DESC LIMIT 1;
```

5분 후 `enqueue_token_refresh` cron이 잡 INSERT → worker picking → refreshToken 호출.

확인:
```sql
SELECT status, channel, job_type, result_summary, completed_at
FROM sync_jobs
WHERE job_type = 'token_refresh' AND channel = 'cafe24'
ORDER BY completed_at DESC LIMIT 5;
```

기대: `status='completed'`, `result_summary={"refreshed":true}`.

Vault payload 갱신 확인:
```sql
SELECT (decrypted_secret::jsonb)->>'expiresAt' AS new_expires_at
FROM vault.decrypted_secrets
WHERE name LIKE 'cafe24:%' ORDER BY created_at DESC LIMIT 1;
```

기대: 새 시간 (refreshToken 호출 후 카페24가 준 만료 시각).

metadata 동기화:
```sql
SELECT metadata->>'expires_at' FROM brand_credentials WHERE channel='cafe24' ORDER BY created_at DESC LIMIT 1;
```

기대: 위 vault의 expiresAt과 같음.

- [ ] **Step 5: syncProducts 동작 확인 (시나리오 6)**

수동 enqueue:
```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'products', now()
FROM brand_credentials
WHERE channel = 'cafe24' AND status = 'active'
LIMIT 1;
```

1~2분 후:
```sql
SELECT status, result_summary FROM sync_jobs WHERE job_type='products' ORDER BY created_at DESC LIMIT 3;
SELECT count(*) FROM catalog_products WHERE brand_id = '<검증 brand id>';
```

기대: 잡 completed + result_summary `{rowsUpserted: N}`. catalog_products에 행 N개.

- [ ] **Step 6: syncOrders 동작 확인 (시나리오 8)**

수동 enqueue:
```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'orders', now()
FROM brand_credentials
WHERE channel = 'cafe24' AND status = 'active'
LIMIT 1;
```

1~2분 후:
```sql
SELECT status, result_summary FROM sync_jobs WHERE job_type='orders' AND channel='cafe24' ORDER BY created_at DESC LIMIT 3;
SELECT count(*) FROM orders WHERE brand_id = '<검증 brand id>' AND synced_at > now() - interval '5 minutes';
SELECT count(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.brand_id = '<검증 brand id>';
```

기대: 잡 completed + orders + order_items 행 들어옴.

- [ ] **Step 7: 401 retry 시뮬 (시나리오 10)**

vault accessToken을 의도적으로 무효한 값으로:
```sql
-- 현재 payload 백업
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name LIKE 'cafe24:%' ORDER BY created_at DESC LIMIT 1;
```

vault payload를 변조 (테스트 후 복구를 위해 백업 필수). 또는 더 안전하게: brand_credentials.metadata.expires_at을 5분 전 시각으로 → 다음 sync 잡 picking 시 worker가 토큰 사용 → 카페24가 401 응답 → 자동 token_refresh → 다음 30분에 재시도.

- [ ] **Step 8: 자동 흐름 (시나리오 12)**

마지막 30분 boundary 후 자동 `enqueue_cafe24_orders` 실행되는지 SQL로 5~10분 간 모니터:
```sql
SELECT count(*), max(created_at) FROM sync_jobs WHERE job_type='orders' AND channel='cafe24' AND created_at > now() - interval '30 minutes';
```

기대: 1+ 행, max created_at이 cron boundary와 일치.

- [ ] **Step 9: 1~2시간 병행 운영 후 비교 (시나리오 11)**

기존 sync.js cron이 같은 mall을 별도로 처리. 시간 두고 두 시스템이 같은 데이터를 upsert.

```sql
SELECT count(*) AS total, max(synced_at) AS latest FROM catalog_products WHERE brand_id = '<검증>';
SELECT count(*) AS total, max(synced_at) AS latest FROM orders WHERE brand_id = '<검증>';
```

`latest` 시각이 새 sync-worker 마지막 picking 시각이면 정상.

- [ ] **Step 10: cleanup (선택)**

```sql
DELETE FROM brands WHERE name = 'Plan 5 검증';
DELETE FROM vault.secrets WHERE id NOT IN (SELECT secret_id FROM brand_credentials WHERE secret_id IS NOT NULL);
DELETE FROM sync_jobs WHERE created_at < now() - interval '2 hours';
```

이 task는 모두 외부 작업이라 커밋 없음.

---

## Plan 5 완료 기준 체크리스트

- [ ] `013_vault_update_wrapper.sql` 적용 + RPC 등록 확인
- [ ] `cafe24.ts` sync 메서드 시그니처 추가
- [ ] `callback/route.ts` metadata.expires_at 추가 + 빌드 통과
- [ ] 가상서버 `lib/adapters.js`에 refreshToken/syncOrders/syncProducts 실 구현
- [ ] 가상서버 `worker.js`에 token_refresh 분기
- [ ] 가상서버 deploy + PM2 reload + log 정상
- [ ] 검증 시나리오 12개 통과 (특히 시나리오 3 refreshToken, 6 syncProducts, 8 syncOrders, 11 병행 비교)

## Plan 5 이후 — Plan 5b / Plan 6 / Plan 7 예고

- **Plan 5b**: 팔레오 카페24 컷오버 — 1주 안정 운영 후 기존 sync.js cron 제거
- **Plan 6**: 스마트스토어 sync 메서드 (Plan 5와 같은 패턴, 어댑터 안에 fetch + upsert)
- **Plan 7**: 네이버광고 sync 메서드 (HMAC 서명 + ad_units/ad_stats 테이블 upsert)

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| sync.js와 컬럼 매핑 불일치 → 새 sync가 잘못된 컬럼에 NULL upsert | implementer가 sync.js의 매핑(라인 174~206)을 정확히 참조. 검증 시 데이터 비교 |
| 카페24 응답 product_no/order_id 필드명 다름 | 위 plan에서 fallback (`p.product_no ?? p.product_code`) 처리. 실제 응답 확인 후 정정 |
| order_items DELETE + INSERT 도중 race condition | 같은 order_id 동시 처리 가능성. retry_count 안전망 + SKIP LOCKED 큐로 한 worker만 처리 |
| token_refresh가 동시 두 번 실행 → 첫 refresh가 두 번째 refresh의 token을 invalidate | `pick_pending_job`의 SKIP LOCKED로 같은 잡 동시 X. 단 5분마다 enqueue되니까 한 cycle에 한 번만 |
| Vault update 실패 시 token_refresh 잡이 status='failed' 고정 — 그 후 sync도 401로 막힘 | 운영자가 수동으로 vault payload 갱신 또는 brand_credentials.status='active'로 재인증 안내 |
| Plan 5b 컷오버 전에 기존 sync.js가 새 sync-worker보다 오래된 데이터 덮어쓰기 | sync.js의 upsert도 idempotent. 마지막 쓰기가 이김. 데이터 손실은 없음 |
| 가상서버 `pm2 reload` 시 중간 잡 끊김 | reload는 graceful drain. 미완료 잡은 stale_running cleanup이 회수 |
