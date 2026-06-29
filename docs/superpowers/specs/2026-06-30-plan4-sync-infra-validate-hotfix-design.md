# Plan 4 — sync 인프라 골격 + Plan 3 validate hotfix 디자인 문서

- **작성일**: 2026-06-30
- **상태**: 디자인 합의 완료 → 구현 계획 작성 예정
- **대상 레포**: `order-manager-saas` (`C:\Users\Jangkwon\Desktop\order-manager-saas`) + 가상서버(`203.245.41.105`)에 신규 PM2 프로세스
- **상위 spec**: [2026-06-29-order-manager-saas-design.md](./2026-06-29-order-manager-saas-design.md) §5 동기화 오케스트레이션
- **이전 plan들**:
  - [2026-06-29-plan2-brand-cafe24-design.md](./2026-06-29-plan2-brand-cafe24-design.md) (Plan 2, 완료)
  - [2026-06-30-plan3-smartstore-naverad-design.md](./2026-06-30-plan3-smartstore-naverad-design.md) (Plan 3, 완료. validate 프로덕션 미해결분이 이 plan에서 마무리)

---

## 1. 배경과 범위

Plan 2(카페24 OAuth + Vault) + Plan 3(스마트스토어/네이버광고 어댑터)으로 자격증명 등록·즉시 검증·Vault 저장 흐름이 완성. **하지만 데이터를 실제로 가져오는 sync는 없어서 brand_credentials의 last_synced_at은 항상 NULL**. Plan 3 검증 시 스마트스토어 API의 IP whitelist 정책이 드러나면서 프로덕션 validate가 막힌 상태로 로컬 검증으로 우회됨.

Plan 4는 **sync 인프라 골격 + Plan 3 validate hotfix** 두 가지를 한 plan으로 묶는다. 매체별 sync 구현은 Plan 5/6/7로 분할.

### 범위 (In Scope)

1. **Vault read wrapper** — `public.read_vault_secret(secret_id)` SECURITY DEFINER RPC. 가상서버가 service_role로 자격증명 복호화 조회
2. **pg_cron 잡 6개** — active credentials × job_type을 sync_jobs에 INSERT (Supabase 내장 pg_cron)
3. **가상서버 sync-worker** (신규 PM2 프로세스) — 5초 polling, FOR UPDATE SKIP LOCKED, 어댑터 라우팅. Plan 4 단계에선 어댑터 sync 메서드가 미구현이라 자동 skip.
4. **가상서버 validate-proxy** (신규 PM2 프로세스) — `POST /validate/:channel` HTTP 서버. PROXY_TOKEN 인증. 스마트스토어/네이버광고만 처리.
5. **어댑터 인터페이스 확장** — `SyncContext`, `SyncResult`, `RefreshResult` 타입 + `ChannelAdapter`에 옵셔널 `refreshToken?`, `syncOrders?`, `syncProducts?`, `syncAdUnits?`, `syncAdStats?` 추가. Plan 4에선 시그니처만, 실 구현은 Plan 5+.
6. **Plan 3 validate hotfix** — 스마트스토어/네이버광고 어댑터의 validate를 가상서버 경유로 전환 (Vercel IP whitelist 회피)
7. **새 환경변수 2개** — `VALIDATE_PROXY_URL`, `VALIDATE_PROXY_TOKEN` (Vercel + 가상서버 양쪽)
8. **워커 crash 복구** — 시작 시 stale `running` 잡을 `pending`으로 되돌리는 청소 쿼리

### Out of Scope

| 항목 | 다룰 plan |
|---|---|
| 카페24 sync 메서드 (orders/products/ad_units) + token refresh | Plan 5 |
| 스마트스토어 sync 메서드 (orders/products) + access_token 캐시 | Plan 6 |
| 네이버광고 sync 메서드 (ad_stats/ad_units) | Plan 7 |
| 기존 `server/sync.js`, `server/sync-ad.js` cron 제거 | 베타 컷오버 (Plan 5/6/7 시점에 매체별) |
| 자동 테스트 인프라 | 검토 후 별도 plan |
| sync 모니터링 대시보드 (UI에서 sync_jobs 보기) | Plan 8+ |

---

## 2. 의사결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| Plan 4 분할 | "인프라 골격 + validate hotfix" — 매체 sync는 Plan 5/6/7로 분할 | 한 plan에 모든 매체 sync까지 넣으면 1주 이상, 한 곳 막히면 전체 지연. baseline 모니터링 없이 매체 시도 위험 |
| 기존 cron 처리 | 그대로 유지, 점진 마이그레이션 (베타 컷오버 시 매체별 인계) | 운영 종속성 ↑. 새 워커 검증되면 매체별로 기존 cron 끄고 새 워커로 이전 |
| 가상서버 워커 위치 | 새 PM2 프로세스 `sync-worker` (기존 naver-proxy와 분리) | 책임 분리. 기존 안정성 영향 0 |
| 가상서버 validate-proxy 위치 | 별도 PM2 프로세스 `validate-proxy` | sync-worker와 책임 분리. validate는 HTTP 서버이고 sync는 polling이라 동작 모델이 다름 |
| 가상서버 코드 위치 | `order-manager-saas/server/` 폴더 신규 | SaaS와 함께 관리. deploy 시 rsync로 가상서버 푸시 |
| sync_jobs polling 빈도 | 5초 | 카페24/네이버 API rate limit과 무관한 짧은 주기. CPU/네트워크 비용 작음 |
| SELECT FOR UPDATE SKIP LOCKED LIMIT 1 | 채택 | 워커 N개 동시 polling해도 중복 처리 X |
| stale running 잡 청소 | 워커 시작 + 매 5분마다 `started_at < now() - 10분`인 running → pending 되돌림 | 워커 crash 시 잠금 영구 |
| 어댑터 sync 메서드 미구현 시 워커 동작 | skip + `result_summary={skipped:true, reason:'method_not_implemented'}` + `status='completed'` | Plan 4 단계에서 큐가 막히면 안 됨 |
| Vault read 방식 | RPC `public.read_vault_secret(uuid)` — Plan 2 wrapper 패턴 일관 | PostgREST가 vault schema expose 안 함. service_role 전용 SECURITY DEFINER |
| pg_cron 잡 6개 | 카페24 orders 30분/products 1일/네이버광고 stats 12h/ad_units 1일/스마트스토어 orders 30분/token_refresh 5분 | 각 매체 API 정책 + 어제 자 데이터 기준 |
| token_refresh 잡 | 매 5분, expiresAt 30분 이내 cafe24·smartstore만 큐잉 | 만료 직전 갱신. 네이버광고는 토큰 없음 |
| cafe24 validate 위치 | Vercel 직접 (변경 없음) | IP 제약 없음. Plan 2 검증됨 |

---

## 3. 아키텍처

```
Supabase 프로젝트 (기존)
├── brand_credentials                    ← Plan 1·2·3 그대로
├── sync_jobs                            ← Plan 1 그대로 (인덱스도 충분)
├── pg_cron 잡 6개 (신규)                ← Plan 4 Task 2에서 등록
│    ├── enqueue_cafe24_orders         (매 30분)
│    ├── enqueue_cafe24_products       (매일 03시)
│    ├── enqueue_smartstore_orders     (매 30분)
│    ├── enqueue_naver_ad_stats        (매 12시간)
│    ├── enqueue_naver_ad_units        (매일 03시)
│    └── enqueue_token_refresh         (매 5분)
└── public.read_vault_secret RPC (신규)  ← Plan 4 마이그레이션

가상서버 (203.245.41.105)
├── /root/naver-proxy/                   ← 기존 (legacy 호환, 손대지 않음)
│    ├── proxy.js (PM2: naver-proxy)
│    ├── sync.js (cron) — 카페24 주문 (기존 운영)
│    └── sync-ad.js (cron) — 네이버광고 통계 (기존 운영)
└── /root/sync-worker/                   ← Plan 4 신규
     ├── worker.js (PM2: sync-worker)
     │    ├── 5초마다 sync_jobs SELECT FOR UPDATE SKIP LOCKED LIMIT 1
     │    ├── status='running' UPDATE
     │    ├── adapter = getAdapter(channel)
     │    ├── creds = JSON.parse( admin.rpc('read_vault_secret', secret_id) )
     │    ├── job_type 라우팅 → adapter.syncOrders / syncProducts / ... 호출
     │    ├── Plan 4 시점: 어댑터 메서드 미구현 → skip
     │    ├── 결과 → 데이터 테이블 upsert (Plan 5+ 매체별)
     │    └── status='completed' / 'failed' + retry_count + error_message
     │    시작 시 + 매 5분: stale running 잡(>10분) → pending 되돌림
     ├── validate-server.js (PM2: validate-proxy)
     │    ├── HTTP listen on PORT (예: 3003)
     │    ├── POST /validate/smartstore — body={clientId,clientSecret}
     │    ├── POST /validate/naver_ad   — body={customerId,accessLicense,secretKey}
     │    ├── X-Proxy-Token 헤더 검증
     │    └── 외부 API 호출 (가상서버 IP라 통과) → {ok,error?} 반환
     ├── ecosystem.config.js (PM2)
     ├── package.json
     └── .env (SUPABASE_URL/SERVICE_ROLE_KEY/VALIDATE_PROXY_TOKEN)

Cloudflare Tunnel (기존)
└── 가상서버 validate-proxy:3003 → https://proxy.{user-tunnel}.com/validate/...

Vercel (order-manager-saas)
├── lib/adapters/cafe24.ts               ← Plan 2 그대로 (validate Vercel 직접)
├── lib/adapters/smartstore.ts           ← Plan 4 변경 — validate가 tunnel URL 호출
├── lib/adapters/naver-ad.ts             ← Plan 4 변경 — validate가 tunnel URL 호출
└── register endpoint                    ← Plan 3 그대로 (사용자가 폼 제출 흐름 동일)
```

---

## 4. Vault read wrapper (신규 SQL)

```sql
-- 010_vault_read_wrapper.sql
CREATE OR REPLACE FUNCTION public.read_vault_secret(secret_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = secret_id;
  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.read_vault_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_vault_secret(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_vault_secret(uuid) TO service_role;
```

가상서버 sync-worker:

```typescript
const { data: secretText, error } = await admin.rpc('read_vault_secret', { secret_id: cred.secret_id })
if (error || !secretText) throw new Error('vault read failed')
const credentials = JSON.parse(secretText) as Record<string, string>
```

---

## 5. 어댑터 인터페이스 확장 (Plan 4 시점)

`lib/adapters/_types.ts`에 추가:

```typescript
export interface SyncContext {
  brandId: string
  channelAccount: string
  dateRangeStart?: string  // 'YYYY-MM-DD'
  dateRangeEnd?: string
}

export type SyncResult =
  | { ok: true; rowsUpserted: number; meta?: Record<string, unknown> }
  | { ok: false; error: string; retryable: boolean }

export type RefreshResult =
  | { ok: true; newPayload: CredentialPayload }
  | { ok: false; error: string }

export interface ChannelAdapter {
  // 기존 (Plan 2·3 그대로) — 생략

  // Plan 4 신규 옵셔널
  refreshToken?(creds: CredentialPayload): Promise<RefreshResult>
  syncOrders?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
  syncProducts?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
  syncAdUnits?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
  syncAdStats?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
}
```

Plan 4의 cafe24/smartstore/naver-ad 어댑터에선 구현 안 함. Plan 5에서 cafe24가 첫 구현.

---

## 6. pg_cron 잡 정의

```sql
-- 011_pg_cron_jobs.sql

-- 매 30분: 카페24 active credentials를 orders 잡으로 enqueue
SELECT cron.schedule(
  'enqueue_cafe24_orders',
  '*/30 * * * *',
  $$
  INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
  SELECT brand_id, id, channel, 'orders', now()
  FROM brand_credentials
  WHERE channel = 'cafe24' AND status = 'active'
  $$
);

-- 매일 03시: 카페24 products
SELECT cron.schedule(
  'enqueue_cafe24_products',
  '0 3 * * *',
  $$
  INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
  SELECT brand_id, id, channel, 'products', now()
  FROM brand_credentials
  WHERE channel = 'cafe24' AND status = 'active'
  $$
);

-- 매 30분: 스마트스토어 orders
SELECT cron.schedule(
  'enqueue_smartstore_orders',
  '*/30 * * * *',
  $$
  INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
  SELECT brand_id, id, channel, 'orders', now()
  FROM brand_credentials
  WHERE channel = 'smartstore' AND status = 'active'
  $$
);

-- 매 12시간 (08·20시): 네이버광고 ad_stats
SELECT cron.schedule(
  'enqueue_naver_ad_stats',
  '0 8,20 * * *',
  $$
  INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
  SELECT brand_id, id, channel, 'ad_stats', now()
  FROM brand_credentials
  WHERE channel = 'naver_ad' AND status = 'active'
  $$
);

-- 매일 03시: 네이버광고 ad_units
SELECT cron.schedule(
  'enqueue_naver_ad_units',
  '0 3 * * *',
  $$
  INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
  SELECT brand_id, id, channel, 'ad_units', now()
  FROM brand_credentials
  WHERE channel = 'naver_ad' AND status = 'active'
  $$
);

-- 매 5분: 만료 임박 token refresh 잡 (cafe24 + smartstore 만)
SELECT cron.schedule(
  'enqueue_token_refresh',
  '*/5 * * * *',
  $$
  INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
  SELECT bc.brand_id, bc.id, bc.channel, 'token_refresh', now()
  FROM brand_credentials bc
  WHERE bc.channel IN ('cafe24', 'smartstore')
    AND bc.status = 'active'
    AND (bc.metadata->>'expires_at' IS NULL
         OR (bc.metadata->>'expires_at')::timestamptz < now() + interval '30 minutes')
  $$
);
```

> Plan 4 시점에선 sync_jobs에 행이 쌓이지만 워커가 어댑터 미구현이라 즉시 `skipped:true completed`로 처리. 누적 부담 없음.

> token_refresh는 brand_credentials.metadata.expires_at 컬럼을 참조. 현재 Plan 2의 cafe24는 vault payload에만 expiresAt이 있고 metadata에는 없음 — Plan 5에서 cafe24 어댑터가 callback 시 metadata에도 채우도록 변경하거나, 별도 쿼리로 vault 조회 후 enqueue. **Plan 4에선 일단 metadata 기반 단순 조건만**.

---

## 7. 가상서버 sync-worker 골격

`/root/sync-worker/worker.js` 핵심:

```javascript
// Pseudocode — 실제 구현은 plan
const POLL_INTERVAL_MS = 5000
const STALE_RUNNING_THRESHOLD_MIN = 10
const MAX_RETRY = 3

async function recoverStaleRunning() {
  await admin.rpc('reset_stale_running', { threshold_minutes: 10 })
  // 또는 직접 UPDATE
}

async function pollOnce() {
  // 트랜잭션 내에서 SELECT FOR UPDATE SKIP LOCKED LIMIT 1 + UPDATE status='running'
  const job = await admin.rpc('pick_pending_job')
  if (!job) return

  try {
    const cred = await admin.from('brand_credentials').select('*').eq('id', job.credential_id).single()
    const secretText = await admin.rpc('read_vault_secret', { secret_id: cred.secret_id })
    const creds = JSON.parse(secretText)

    const adapter = getAdapter(job.channel)
    const method = JOB_TYPE_TO_METHOD[job.job_type]  // 'syncOrders' 등

    if (!adapter || !adapter[method]) {
      // Plan 4 단계: 어댑터 미구현 → skip
      await markCompleted(job.id, { skipped: true, reason: 'method_not_implemented', method })
      return
    }

    const ctx = { brandId: job.brand_id, channelAccount: cred.channel_account, ... }
    const result = await adapter[method](creds, ctx)

    if (result.ok) {
      await markCompleted(job.id, { rowsUpserted: result.rowsUpserted, ...result.meta })
      await admin.from('brand_credentials').update({ last_synced_at: new Date() }).eq('id', cred.id)
    } else {
      await markFailed(job.id, result.error, result.retryable)
    }
  } catch (e) {
    await markFailed(job.id, e.message, true)
  }
}

setInterval(pollOnce, POLL_INTERVAL_MS)
setInterval(recoverStaleRunning, 5 * 60 * 1000)
recoverStaleRunning()  // 시작 시 1회
pollOnce()
```

추가 RPC 두 개 신규:

```sql
-- pick_pending_job: 한 행 잠금 + status='running' 업데이트 + 반환
-- reset_stale_running: started_at > 10분 전인 running 잡을 pending 되돌림
```

상세 SQL은 plan에서.

---

## 8. 가상서버 validate-proxy

`/root/sync-worker/validate-server.js`:

```javascript
const http = require('http')
const PROXY_TOKEN = process.env.VALIDATE_PROXY_TOKEN

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') return respond(res, 405, { error: 'method not allowed' })
  if (req.headers['x-proxy-token'] !== PROXY_TOKEN) return respond(res, 401, { error: 'unauthorized' })

  const channel = req.url.match(/^\/validate\/(smartstore|naver_ad)$/)?.[1]
  if (!channel) return respond(res, 404, { error: 'unknown channel' })

  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', async () => {
    const creds = JSON.parse(body)
    const result = channel === 'smartstore'
      ? await validateSmartstore(creds)
      : await validateNaverAd(creds)
    respond(res, 200, result)
  })
})

server.listen(process.env.VALIDATE_PROXY_PORT || 3003)
```

`validateSmartstore` / `validateNaverAd`는 기존 Plan 3 어댑터의 validate 로직을 그대로 가져옴 (bcrypt 서명 + token endpoint 호출 / HMAC 서명 + /ncc/campaigns 호출). 같은 함수를 Vercel에서 가상서버로 옮기는 것.

### Vercel 어댑터 변경 (smartstore/naver-ad)

```typescript
async function validate(creds: CredentialPayload): Promise<ValidateResult> {
  const proxyUrl = process.env.VALIDATE_PROXY_URL
  const token = process.env.VALIDATE_PROXY_TOKEN
  if (!proxyUrl || !token) return { ok: false, error: 'validate-proxy 설정 누락' }

  const r = await fetch(`${proxyUrl}/validate/smartstore`, {  // 또는 /validate/naver_ad
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Token': token,
    },
    body: JSON.stringify(creds),
  })

  if (!r.ok) {
    return { ok: false, error: `validate-proxy 호출 실패 (${r.status})` }
  }
  return await r.json() as ValidateResult
}
```

### 환경변수

`.env.example` + `.env.local` + Vercel 환경변수에 추가:

```
# 가상서버 validate-proxy (스마트스토어/네이버광고 IP whitelist 우회)
VALIDATE_PROXY_URL=https://proxy.{user-tunnel}.com
VALIDATE_PROXY_TOKEN=<32바이트 base64>
```

가상서버 `/root/sync-worker/.env`에는 동일 토큰 + Supabase 키:

```
SUPABASE_URL=https://cvciddmmfyuwvfobtbyb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
VALIDATE_PROXY_PORT=3003
VALIDATE_PROXY_TOKEN=<같은 값>
```

Cloudflare Tunnel은 기존 운영 중인 것 재사용 또는 새 라우트 추가.

---

## 9. DB 변경

### 신규 마이그레이션 파일 3개

| 파일 | 내용 |
|---|---|
| `010_vault_read_wrapper.sql` | `public.read_vault_secret` RPC |
| `011_pg_cron_jobs.sql` | 6개 cron.schedule |
| `012_sync_job_rpcs.sql` | `pick_pending_job`, `reset_stale_running`, helper RPCs |

### 추가 변경 없음

- `sync_jobs` 테이블·인덱스 그대로
- `brand_credentials.metadata`도 그대로 (token_refresh 잡 SQL이 metadata→>'expires_at' 읽음. 현재 NULL이라 모든 행이 큐잉되지만 Plan 4에선 어댑터 미구현이라 즉시 skip)

---

## 10. Plan 4 완료 기준 (15 시나리오)

**인프라 (5)**:
1. ✅ `read_vault_secret` RPC 등록 — service_role로 임의 secret_id 호출 시 JSON 반환
2. ✅ pg_cron 잡 6개 등록 — `SELECT jobname FROM cron.job` 결과에 6행
3. ✅ `sync-worker` PM2 프로세스 `online` + 5초 polling 로그 표시
4. ✅ `validate-proxy` PM2 프로세스 `online` + curl `POST /validate/...` 200 응답
5. ✅ 가상서버 → Supabase RPC `read_vault_secret` 호출 성공 (직접 테스트)

**Validate hotfix (4)**:
6. ✅ Vercel 프로덕션 `https://order-manager-saas-bay.vercel.app`에서 스마트스토어 자격증명 등록 → 가상서버 경유 validate → ✅ 표시
7. ✅ 동일 흐름 네이버광고 → ✅ 표시
8. ✅ `X-Proxy-Token` 헤더 누락 시 401 (curl 직접 호출)
9. ✅ `/validate/cafe24`처럼 미지원 채널 → 404

**큐 흐름 (6)**:
10. ✅ pg_cron `enqueue_cafe24_orders`가 30분 후 (또는 수동 `SELECT cron.alter_job` 즉시 호출) `sync_jobs` INSERT 발생
11. ✅ `sync-worker`가 pending 잡 picking → `running` 전환 → 즉시 `completed`(skipped:true) 처리. log에 `method_not_implemented` 표시
12. ✅ 두 워커 인스턴스 동시 실행해도 같은 잡 중복 처리 안 됨 (`FOR UPDATE SKIP LOCKED` 검증)
13. ✅ 인위적 throw 주입 → `status='failed'` + `error_message` 기록, retry_count 증가
14. ✅ retry_count >= 3이면 더 이상 재시도 안 함
15. ✅ 워커 kill 후 재시작 → `recoverStaleRunning`이 stale `running` 잡을 `pending`으로 되돌림 (수동 시뮬: UPDATE로 started_at 11분 전으로 설정 후 워커 재시작)

---

## 11. 보안 가드레일

| 항목 | 처리 |
|---|---|
| service_role 키가 가상서버에 안전 보관 | 가상서버 `/root/sync-worker/.env`에만, 파일 권한 600 (`chmod 600`) |
| Vault payload가 가상서버 로그에 남음 | `console.log(creds)` 금지. 에러 로깅 시 필드 마스킹. PM2 logrotate 설정 |
| validate-proxy 무인증 호출 차단 | `X-Proxy-Token` 헤더 검증. Vercel·가상서버 양쪽 동일 `VALIDATE_PROXY_TOKEN` 환경변수 |
| Cloudflare Tunnel URL이 코드에 박힘 | 환경변수에만 (`VALIDATE_PROXY_URL`) |
| pg_cron 잡이 inactive credentials도 큐잉 | SQL `WHERE status = 'active'` |
| sync_jobs 한 행을 두 워커가 처리 | `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` 트랜잭션 |
| 워커 crash 시 `running` 잡 잠금 영구 | `reset_stale_running` RPC + 워커 시작 + 5분 주기 |
| retry 무한 루프 | `retry_count >= 3`이면 `status='failed'` 고정 |

---

## 12. 위험 + 완화

| 위험 | 완화 |
|---|---|
| pg_cron 활성 안 됨 | Task 1 사전 점검 — 비활성 시 Supabase 대시보드에서 ON |
| 가상서버 SSH 키 유출 → service_role 노출 | SSH 키 rotation. 키 노출 의심 시 Supabase에서 service_role 재발급 |
| Cloudflare Tunnel 끊김 → Vercel validate 호출 실패 | UI에 "검증 서버 연결 실패" 표시. PM2 + Tunnel 모니터 |
| 가상서버 IP 변경 | tunnel URL은 IP와 분리. 환경변수만 갱신 |
| Plan 3로 등록된 기존 자격증명에 validate 변경 영향 | validate는 신규 등록 흐름에만 호출. 기존 행 영향 없음 |
| 어댑터 sync 메서드 미구현 — 영구 skip | Plan 5/6/7에서 매체별 구현. Plan 4 완료 시 모니터링 쿼리: `SELECT count(*) FROM sync_jobs WHERE result_summary->>'skipped'='true' AND created_at > now() - interval '1 hour'` |
| pg_cron 잡 6개 한꺼번에 sync_jobs에 INSERT — 큐 폭증 | 매 30분 × N brands × 3 jobs = 활성 brand가 적어 부담 없음. Plan 4 시점 활성 brand 0개 또는 1개. 사용자 늘면 모니터링 |
| token_refresh 잡이 metadata.expires_at 없는 행 모두 큐잉 | Plan 4 단계엔 어댑터 미구현이라 즉시 skip. Plan 5에서 metadata 채움 + 정확한 조건 |
| 가상서버 워커가 SaaS DB만 본다 — 기존 cron과 중복 안 됨 | 기존 sync.js/sync-ad.js는 .env 기반 (brand_id 매핑). 새 워커는 brand_credentials 기반. 같은 시점에 양쪽이 같은 brand 처리해도 외부 API 호출이 idempotent (upsert) — 데이터 중복 안 됨. 다만 비용은 잠시 2배 |

---

## 13. 산출물 (코드 변경 요약)

### 신규 파일

**Supabase 마이그레이션 (3개)**

| 파일 | 역할 |
|---|---|
| `supabase/migrations/010_vault_read_wrapper.sql` | read_vault_secret RPC |
| `supabase/migrations/011_pg_cron_jobs.sql` | 6개 cron.schedule |
| `supabase/migrations/012_sync_job_rpcs.sql` | pick_pending_job, reset_stale_running RPC |

**가상서버 코드** (SaaS 레포 `server/sync-worker/` 새 폴더, deploy 시 가상서버 `/root/sync-worker/`로 rsync)

| 파일 | 역할 |
|---|---|
| `server/sync-worker/package.json` | node 의존성 |
| `server/sync-worker/ecosystem.config.js` | PM2 (sync-worker + validate-proxy 두 앱) |
| `server/sync-worker/.env.example` | 환경변수 템플릿 |
| `server/sync-worker/worker.js` | sync-worker 메인 |
| `server/sync-worker/validate-server.js` | validate-proxy HTTP 서버 |
| `server/sync-worker/lib/supabase.js` | service_role 클라이언트 |
| `server/sync-worker/lib/adapters/index.js` | Plan 4 시점 stub registry (실 sync 메서드 미구현, Plan 5+에서 추가) |
| `server/sync-worker/lib/job-type-routing.js` | job_type → adapter method 매핑 |
| `server/sync-worker/README.md` | 배포·운영 가이드 |

### 변경 파일

| 파일 | 변경 |
|---|---|
| `lib/adapters/_types.ts` | SyncContext, SyncResult, RefreshResult 타입 + ChannelAdapter에 옵셔널 sync 메서드 5개 |
| `lib/adapters/smartstore.ts` | validate 함수만 가상서버 경유로 |
| `lib/adapters/naver-ad.ts` | validate 함수만 가상서버 경유로 |
| `.env.example` | VALIDATE_PROXY_URL + VALIDATE_PROXY_TOKEN |
| `.env.local` | 두 값 채움 (gitignored) |

### 환경변수 추가

**Vercel + 로컬 .env.local**:
- `VALIDATE_PROXY_URL` — Cloudflare Tunnel URL
- `VALIDATE_PROXY_TOKEN` — 32바이트 base64

**가상서버 /root/sync-worker/.env**:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `VALIDATE_PROXY_PORT` (예: 3003)
- `VALIDATE_PROXY_TOKEN` (Vercel과 동일)

---

## 14. 다음 단계

이 spec이 사용자 리뷰 후 확정되면 `writing-plans`로 Task 단위 구현 계획 작성. 예상 Task 흐름:

1. 사전 점검 — pg_cron 활성 + Cloudflare Tunnel URL 결정 + VALIDATE_PROXY_TOKEN 생성
2. `010_vault_read_wrapper.sql` 마이그레이션 실행 + 검증
3. `012_sync_job_rpcs.sql` — pick_pending_job/reset_stale_running RPC + 검증
4. `011_pg_cron_jobs.sql` — 6개 잡 등록 + `cron.job` 검증
5. 어댑터 인터페이스 확장 (`_types.ts`)
6. 가상서버 sync-worker 코드 (worker.js + lib/) 작성
7. 가상서버 validate-proxy 코드 (validate-server.js) 작성
8. PM2 ecosystem 설정 + rsync deploy + PM2 start
9. Vercel 어댑터 변경 (smartstore/naver-ad validate)
10. Cloudflare Tunnel 라우트 추가 + Vercel 환경변수 등록 + 재배포
11. 통합 검증 (15 시나리오)

## 15. Plan 4 이후 — Plan 5/6/7 예고

| Plan | 매체 | 추가 작업 |
|---|---|---|
| Plan 5 | 카페24 | refreshToken + syncOrders + syncProducts + syncAdUnits 어댑터 구현 + brand_credentials.metadata.expires_at 채우기 + 기존 sync.js cron 제거(팔레오 컷오버) |
| Plan 6 | 스마트스토어 | syncOrders + syncProducts + access_token 캐시 패턴 |
| Plan 7 | 네이버광고 | syncAdStats + syncAdUnits + 기존 sync-ad.js cron 제거 |

각 plan은 baseline(Plan 4)이 잘 작동한다는 가정 하에 어댑터 메서드만 추가하는 형태라 크기 작음.
