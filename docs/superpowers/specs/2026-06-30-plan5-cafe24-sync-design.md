# Plan 5 — 카페24 sync 구현 디자인 문서

- **작성일**: 2026-06-30
- **상태**: 디자인 합의 완료 → 구현 계획 작성 예정
- **대상 레포**: `order-manager-saas` (`C:\Users\Jangkwon\Desktop\order-manager-saas`) + 가상서버 신규 코드 rsync
- **상위 spec**: [2026-06-29-order-manager-saas-design.md](./2026-06-29-order-manager-saas-design.md) §5 동기화 오케스트레이션
- **이전 plan들**:
  - [2026-06-29-plan2-brand-cafe24-design.md](./2026-06-29-plan2-brand-cafe24-design.md) (Plan 2, 완료 — OAuth + Vault)
  - [2026-06-30-plan4-sync-infra-validate-hotfix-design.md](./2026-06-30-plan4-sync-infra-validate-hotfix-design.md) (Plan 4, 완료 — sync 인프라 골격)

---

## 1. 배경과 범위

Plan 4로 sync 인프라(`sync_jobs` 큐 + pg_cron + 가상서버 sync-worker + validate-proxy)가 안정 운영 중. 어댑터 인터페이스에 `refreshToken`/`syncOrders`/`syncProducts`/`syncAdUnits`/`syncAdStats` 옵셔널 메서드 시그니처는 있지만 모두 미구현이라 worker가 picking 후 `skipped:true completed`로 처리.

Plan 5는 **카페24 어댑터의 sync 메서드를 실제로 구현**한다. 데이터가 처음으로 SaaS 큐 흐름을 통해 `orders` / `order_items` / `catalog_products`에 들어오는 milestone.

기존 `order-manager/server/sync.js`가 같은 매체·같은 endpoint로 이미 작동 중이므로, **그 코드를 가상서버 `sync-worker/lib/adapters.js`의 cafe24 stub에 옮긴다.** 기존 cron은 그대로 유지(병행 운영) — 컷오버는 Plan 5b로 분리.

### 범위 (In Scope)

1. **`lib/adapters/cafe24.ts`에 sync 메서드 시그니처 구현 추가** — TypeScript 측 인터페이스 일관성용. 실 실행은 가상서버.
2. **가상서버 `lib/adapters.js`의 cafe24 stub → 실 구현**:
   - `refreshToken(creds)` — 카페24 OAuth refresh_token 엔드포인트 호출, 새 accessToken/refreshToken/expiresAt 반환
   - `syncOrders(creds, ctx)` — 카페24 orders API 페이지네이션 + `orders`/`order_items` upsert
   - `syncProducts(creds, ctx)` — 카페24 products API 페이지네이션 + `catalog_products` upsert
3. **Plan 2 OAuth callback 수정** — `brand_credentials.metadata.expires_at` 채우기. `enqueue_token_refresh` cron이 정확히 30분 이내 자격증명만 큐잉하도록.
4. **`worker.js`에 token_refresh result 분기** — `refreshToken`의 `newPayload`를 Vault에 update + `brand_credentials.metadata.expires_at` 동기화.
5. **SQL 마이그레이션 1개** — `public.update_vault_secret(secret_id uuid, new_secret text)` SECURITY DEFINER RPC.
6. **통합 검증** — 운영자가 실제 팔레오 카페24로 등록 → token_refresh + syncOrders + syncProducts 모두 작동 확인 + 병행 운영 데이터 일치 비교.

### Out of Scope

| 항목 | 다룰 plan |
|---|---|
| 기존 `server/sync.js` cron 제거 (팔레오 컷오버) | Plan 5b (Plan 5 안정 운영 1주 후) |
| 스마트스토어 sync 메서드 구현 | Plan 6 |
| 네이버광고 sync 메서드 구현 | Plan 7 |
| `channel_products` 마이그레이션 | Phase F |
| sync 모니터링 UI | Plan 8+ |
| 사용자가 sync 상태를 볼 수 있는 화면 | Plan 8+ |
| 자동 테스트 인프라 | 별도 plan |

---

## 2. 의사결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| 팔레오 컷오버 | Plan 5 미포함, Plan 5b로 분리 | 1주 병행 운영으로 데이터 일치 비교 후 컷오버. 롤백 즉시 가능 |
| 데이터 테이블 | 기존 그대로 (`orders`, `order_items`, `catalog_products`) | 병행 운영 시 idempotent upsert. `channel_products` 마이그레이션은 Phase F |
| 카페24 sync 코드 위치 | 가상서버 `sync-worker/lib/adapters.js` | Plan 4 stub 자리. Plan 5는 그 자리를 실 코드로 채움 |
| TypeScript 측 cafe24.ts sync 메서드 | 시그니처만 (실제로는 호출 안 됨) | 인터페이스 일관성. 가상서버가 실제 sync 실행 |
| metadata.expires_at 채우기 | Plan 2 callback에서 INSERT 시점에 채움 | 새 등록 흐름에 자연스럽게 통합. 기존 행은 token_refresh 잡이 처음 한 번 실행되면 자동 채워짐 |
| 401 retry 처리 | `{ok:false, error, retryable:true}` 반환 → worker retry | 다음 polling 전에 `token_refresh` 잡이 갱신해주면 자동 복구. 같은 잡 max_retry 3회로 무한 루프 방지 |
| 페이지네이션 패턴 | `d.links?.some(l => l.rel === 'next')` (기존 sync.js 패턴) | 카페24 API 응답에 따라 안전. offset 더하기 |
| 데이터 범위 default | 어제·오늘 KST (기존 sync.js 패턴) | 30분 cron이라 1일 정도 데이터로 충분 |
| Vault update wrapper | 신규 `update_vault_secret(secret_id, new_secret)` SQL | Plan 2의 create/delete wrapper 패턴 일관 |

---

## 3. 카페24 어댑터 메서드 3개 (가상서버 `lib/adapters.js`)

### refreshToken

호출 시점: `token_refresh` 잡 (매 5분 cron이 `metadata.expires_at < now() + 30 min`인 cafe24 credentials를 큐잉).

```
POST https://{mallId}.cafe24api.com/api/v2/oauth/token
  Headers:
    Authorization: Basic base64({appId}:{appSecret})
    Content-Type: application/x-www-form-urlencoded
  Body: grant_type=refresh_token&refresh_token={refreshToken}
  ↓
응답 (200):
  { access_token, refresh_token, expires_at, ... }
  ↓
return {
  ok: true,
  newPayload: {
    appId,
    appSecret,
    mallId,
    accessToken: <new>,
    refreshToken: <new>,
    expiresAt: <new>
  }
}
```

실패:
- 응답 4xx → `{ ok: false, error: '카페24 refresh 실패: ...', retryable: false }` (manual 재인증 필요)
- 네트워크 throw → `{ ok: false, error: '...', retryable: true }`

worker.js의 처리 (다음 §4 참조):
- `result.ok === true` + `job.job_type === 'token_refresh'` 분기에서:
  1. `admin.rpc('update_vault_secret', { secret_id, new_secret: JSON.stringify(newPayload) })`
  2. `brand_credentials` UPDATE — metadata.expires_at = newPayload.expiresAt
- 일반 `markCompleted` 흐름 따로.

### syncOrders

호출 시점: `enqueue_cafe24_orders` (매 30분).

```
ctx.dateRangeStart / dateRangeEnd가 없으면 default:
  startDate = yesterdayKST()
  endDate   = todayKST()

while true:
  GET https://{mallId}.cafe24api.com/api/v2/admin/orders
    ?shop_no=1
    &start_date={startDate}
    &end_date={endDate}
    &limit=100
    &offset={offset}
    &embed=items
    Headers:
      Authorization: Bearer {accessToken}
      X-Cafe24-Api-Version: 2025-12-01
  ↓
  if response.errors → throw or 401 → { ok: false, retryable: true }
  if !response.orders or empty → break loop
  ↓
  각 order:
    upsert orders (
      brand_id, order_id, order_date, payment_date,
      member_id, total_amount, status, ...
    ) on conflict (brand_id, order_id)
    
    각 item in order.items:
      upsert order_items (
        brand_id, order_id, item_no,
        product_no, variant_code, product_name,
        quantity, price, ...
      ) on conflict (brand_id, order_id, item_no)
  ↓
  if !response.links.some(l => l.rel === 'next') → break
  offset += 100
  ↓
return { ok: true, rowsUpserted: ordersCount + itemsCount }
```

upsert 정확한 컬럼은 plan 작성 시 `server/sync.js` 코드에서 그대로 추출.

### syncProducts

호출 시점: `enqueue_cafe24_products` (매일 03시).

```
while true:
  GET https://{mallId}.cafe24api.com/api/v2/admin/products
    ?shop_no=1&limit=100&offset={offset}
    Headers: 동일
  ↓
  if !response.products or empty → break
  ↓
  각 product:
    upsert catalog_products (
      brand_id, product_no, product_name,
      selling_price, supply_price, retail_price,
      display, selling, ...
    ) on conflict (brand_id, product_no)
  ↓
  페이지네이션 동일
  ↓
return { ok: true, rowsUpserted: productsCount }
```

### 공통 — 401 처리

`syncOrders`/`syncProducts`가 401 받으면:
```javascript
return { ok: false, error: 'access_token expired (401)', retryable: true }
```

worker가 sync_jobs.status='pending' + retry_count++. 다음 polling에서 다시 시도.
- 그 사이 `enqueue_token_refresh` cron(매 5분)이 새 잡 큐잉 → worker가 refresh 처리 → 새 토큰 Vault 저장 → 그 다음 syncOrders 잡 polling 시 새 토큰으로 성공.
- retry_count >= 3이면 status='failed' 고정. 운영자가 재인증 또는 수동 처리.

---

## 4. Plan 2 OAuth callback 수정

`app/auth/cafe24/callback/route.ts`의 `brand_credentials.insert` 부분:

```typescript
// 기존 (Plan 2)
const { error: insertErr } = await admin.from('brand_credentials').insert({
  brand_id: stateData.brandId,
  channel: 'cafe24',
  channel_account: stateData.mallId,
  secret_id: secretId,
  status: 'active',
  metadata: {
    scope: 'mall.read_order,mall.write_order,mall.read_analytics,mall.read_product,mall.read_category',
  },
})

// Plan 5 변경
const { error: insertErr } = await admin.from('brand_credentials').insert({
  brand_id: stateData.brandId,
  channel: 'cafe24',
  channel_account: stateData.mallId,
  secret_id: secretId,
  status: 'active',
  metadata: {
    scope: 'mall.read_order,mall.write_order,mall.read_analytics,mall.read_product,mall.read_category',
    expires_at: payload.expiresAt,  // ★ 신규
  },
})
```

→ pg_cron `enqueue_token_refresh` 잡이 `metadata->>'expires_at'`을 timestamptz로 캐스팅 후 `now() + 30 min`과 비교. 정확히 만료 임박한 자격증명만 큐잉.

기존(Plan 2 검증·cleanup 후 brand_credentials 비어있음) 행은 없음. 새 등록 흐름에서 자연스럽게 채워짐.

---

## 5. worker.js — token_refresh result 분기

`server/sync-worker/worker.js`의 `pollOnce` 안에서, `method(creds, ctx)` 호출 후 result 처리 분기를 token_refresh에 맞게 확장:

```javascript
const result = await method(creds, ctx)

if (result.ok) {
  if (job.job_type === 'token_refresh') {
    // 1. Vault 갱신
    const { error: vaultUpdErr } = await admin.rpc('update_vault_secret', {
      secret_id: cred.secret_id,
      new_secret: JSON.stringify(result.newPayload),
    })
    if (vaultUpdErr) {
      await markFailed(job.id, job.retry_count, `vault update failed: ${vaultUpdErr.message}`, true)
      return
    }

    // 2. metadata.expires_at 동기화
    const newMetadata = { ...(cred.metadata ?? {}), expires_at: result.newPayload.expiresAt }
    await admin.from('brand_credentials').update({ metadata: newMetadata }).eq('id', cred.id)
  }

  await markCompleted(job.id, {
    ...(job.job_type === 'token_refresh' ? { refreshed: true } : { rowsUpserted: result.rowsUpserted ?? 0 }),
    ...(result.meta ?? {}),
  })
  await admin.from('brand_credentials').update({ last_synced_at: new Date().toISOString() }).eq('id', cred.id)
} else {
  await markFailed(job.id, job.retry_count, result.error, result.retryable)
}
```

→ token_refresh가 성공하면 사이드 이펙트 두 가지(Vault + metadata)가 atomic하게 일어남. 둘 중 하나 실패하면 markFailed로 재시도.

---

## 6. SQL 마이그레이션 — `update_vault_secret` wrapper

```sql
-- 013_vault_update_wrapper.sql
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

> Supabase Vault의 `vault.update_secret(uuid, text)` 함수는 Plan 4의 schema 조회에서 확인됨: `update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)`. 이 wrapper는 가장 단순 변형 (secret만 update, name/description 그대로 유지).

---

## 7. TypeScript 측 `lib/adapters/cafe24.ts`

가상서버가 실 sync 실행하지만, TypeScript 어댑터 인터페이스 일관성을 위해 cafe24.ts에도 sync 메서드 추가. 단 호출자는 없음 (Vercel은 sync 호출 안 함).

선택지:
- **A. 시그니처만 (no-op)**: `syncOrders: async () => ({ ok: false, error: 'execute on virtual server', retryable: false })` — 실수로 Vercel에서 호출되면 즉시 에러
- **B. 시그니처도 추가 안 함**: Vercel용 어댑터는 OAuth + validate만, sync는 가상서버 전용 다른 모양

내 선택: **A**. 인터페이스 일관성 + 안전장치. 그러나 TypeScript 시그니처가 인터페이스에 맞아야 하므로 빈 구현 또는 throw.

---

## 8. 검증 시나리오 (Plan 5 완료 기준 — 12개)

운영자가 본인 팔레오 카페24 mall로 진행.

### Vault 인프라 (1)

1. ✅ `update_vault_secret(uuid, text)` RPC 등록 — 임의 secret_id + new_secret 호출 시 SUCCESS

### Callback 수정 (1)

2. ✅ 임시 브랜드에 카페24 mall 등록 → `brand_credentials.metadata.expires_at` 채워짐 (NULL 아님)

### refreshToken (3)

3. ✅ `metadata.expires_at`을 강제로 `now() + 10 minutes`로 UPDATE → 5분 후 `enqueue_token_refresh` 잡 INSERT → worker picking → refreshToken 호출 성공 → result_summary에 `{refreshed:true}` → vault secret이 새 값으로 update 확인 (`vault.decrypted_secrets` payload의 accessToken 변경됨) → metadata.expires_at도 갱신됨
4. ✅ 같은 흐름에서 잘못된 refresh_token(인위적으로 vault payload 변조)으로 시도 → 카페24 응답 4xx → result.ok=false retryable=false → status='failed' 고정 후 retry 안 됨
5. ✅ 네트워크 throw 시뮬 (가상서버 임시 hosts 차단) → result.ok=false retryable=true → status='pending' 재시도 → 차단 해제 후 다음 polling 성공

### syncProducts (2)

6. ✅ 수동 enqueue (`INSERT INTO sync_jobs ... channel='cafe24', job_type='products'`) → worker picking → 카페24 products API 호출 → `catalog_products` 행 들어옴 (운영자 mall의 실 상품) → result_summary `{rowsUpserted:N}`
7. ✅ 잡 두 번 실행 → 같은 product_no는 upsert로 update만 (행 수 증가 X)

### syncOrders (3)

8. ✅ 수동 enqueue `job_type='orders'` → worker picking → 어제·오늘 KST 주문 가져와서 `orders`/`order_items` upsert → result_summary `{rowsUpserted:N}`
9. ✅ `date_range_start`/`date_range_end`를 지정해서 큐잉 → 그 범위 데이터만 들어옴
10. ✅ 401 시뮬 (vault payload의 accessToken을 무효한 값으로 강제 UPDATE) → syncOrders가 401 → retryable=true로 markFailed → token_refresh가 5분 내 갱신 → 다음 30분 cron 시점에 syncOrders 다시 성공

### 병행 운영 비교 (1)

11. ✅ 1~2시간 병행 운영 후 SQL 비교:
    ```sql
    -- 새 sync-worker가 처리한 row count
    SELECT count(*) FROM orders WHERE updated_at > now() - interval '2 hours';
    SELECT count(*) FROM catalog_products WHERE updated_at > now() - interval '2 hours';
    ```
    기대: 같은 카페24 mall의 데이터가 기존 sync.js와 동일하게 들어옴. row count 차이 0 또는 최근 추가/변경된 만큼.

### pg_cron 자동 흐름 (1)

12. ✅ 검증 종료 시점 기준으로 마지막 30분 boundary 후 자동 `enqueue_cafe24_orders` 발생 → sync_jobs에 새 행 → worker picking → completed (수동 INSERT 없이도 자동 작동)

---

## 9. DB 변경

| 파일 | 내용 |
|---|---|
| `supabase/migrations/013_vault_update_wrapper.sql` | `public.update_vault_secret(secret_id, new_secret) RETURNS void` |

추가 없음. `brand_credentials.metadata` JSON 필드의 키만 새로 채워짐 (스키마 변경 아님).

---

## 10. 산출물 (코드 변경 요약)

### 변경 파일

| 파일 | 변경 |
|---|---|
| `lib/adapters/cafe24.ts` | refreshToken / syncOrders / syncProducts 시그니처 추가 (no-op 또는 throw) |
| `app/auth/cafe24/callback/route.ts` | brand_credentials.insert의 metadata에 `expires_at` 추가 |
| `server/sync-worker/lib/adapters.js` | cafe24 stub → 실 구현 (refreshToken/syncOrders/syncProducts) |
| `server/sync-worker/worker.js` | token_refresh result 분기 (update_vault_secret + metadata update) |

### 신규 파일

| 파일 | 역할 |
|---|---|
| `supabase/migrations/013_vault_update_wrapper.sql` | update_vault_secret RPC |

### 가상서버 deploy

- 위 두 가상서버 파일을 rsync (또는 git pull) 후 `pm2 reload sync-worker`
- `validate-proxy`는 변경 없음 — 그대로 둠

---

## 11. 보안 가드레일

| 항목 | 처리 |
|---|---|
| Vault 갱신 시 새 토큰이 로그에 남음 | `console.log(newPayload)` 금지. 에러 로그에도 토큰 마스킹 |
| update_vault_secret RPC 권한 | service_role 전용 (Plan 2/4 wrapper 패턴과 일관) |
| 가상서버 코드 변경 후 권한 600 유지 | rsync 시 `.env`는 제외 (이미 패턴) |
| 카페24 API 호출 시 accessToken이 URL/log에 노출 | Authorization 헤더로만, 별도 로깅 X |
| 잘못된 refresh_token으로 무한 재시도 | retryable=false 명시 + max_retry 3 |

---

## 12. 위험 + 완화

| 위험 | 완화 |
|---|---|
| 새 sync-worker가 기존 sync.js와 동시 upsert 시 충돌 | upsert key 동일, 데이터 idempotent — 마지막 쓰기가 이김. 데이터 손실 없음 |
| 카페24 API 응답 포맷이 기존 sync.js와 다름 | 같은 endpoint·헤더라 호환. 차이 있으면 양쪽 동일 영향 |
| token_refresh가 카페24 측 refresh_token 만료 시 실패 | 운영자에게 알림 (Plan 6+ 모니터링 UI). 임시로는 SQL로 status 확인 |
| 가상서버 deploy 시점에 worker가 중간 상태 | `pm2 reload`로 graceful drain. 진행 중 잡은 stale_running 청소가 처리 |
| catalog_products의 retail_price NOT NULL 제약 → cafe24 응답에 retail_price 없는 상품 | Plan 1 마이그레이션 때 default 0 적용됨. 안전 |
| brand_credentials.metadata가 기존 행에 NULL → token_refresh 모든 행 큐잉 | callback 수정으로 새 등록부터 채워짐. 한 번이라도 refresh 잡 실행되면 metadata도 채워짐 |
| 1주 병행 운영 시 catalog_products/orders 행이 두 번 업데이트되어 비용 ↑ | API 호출 비용 작음(cafe24 rate limit 한참 못 미침). 데이터 비교 후 컷오버 (Plan 5b) |

---

## 13. Plan 5 이후 — Plan 5b 예고

Plan 5b = 팔레오 카페24 컷오버.

작업:
1. 새 sync-worker 1주 안정 운영 확인 (검증 시나리오 11의 데이터 일치 매일 확인)
2. 기존 가상서버 `server/sync.js`의 카페24 sync 잡 cron에서 제거 (또는 sync.js 자체 PM2 stop)
3. 기존 `.env`의 PALEO_APP_ID 등 카페24 관련 변수 정리 (or 1주 보존)
4. 모니터링 — 가상서버 sync-worker의 last_synced_at 추적, 1시간 이상 갱신 안 되면 알림
5. 코코엘·아프리모는 이후 같은 패턴으로 컷오버

Plan 5b는 코드 변경이 적고 운영 작업 중심. 짧은 plan.

---

## 14. 다음 단계

이 spec이 사용자 리뷰 후 확정되면 `writing-plans`로 Task 단위 구현 계획 작성. 예상 Task 흐름:

1. `013_vault_update_wrapper.sql` 마이그레이션
2. `cafe24.ts` 시그니처 추가 (TS 빌드 확인)
3. callback의 metadata.expires_at 추가
4. 가상서버 `adapters.js`의 cafe24 stub → 실 구현 (refreshToken)
5. 가상서버 adapters.js — syncOrders + syncProducts
6. 가상서버 worker.js — token_refresh 분기
7. 가상서버 deploy + PM2 reload
8. 통합 검증 (12 시나리오)
