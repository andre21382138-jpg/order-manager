# Plan 4 — sync 인프라 골격 + Plan 3 validate hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase에 sync_jobs 큐 처리 RPC + pg_cron 잡 6개 + Vault read wrapper를 등록하고, 가상서버에 신규 PM2 프로세스 `sync-worker`(5초 polling)와 `validate-proxy`(스마트스토어/네이버광고 IP whitelist 우회 HTTP 서버)를 추가하고, Vercel 스마트스토어/네이버광고 어댑터의 validate를 가상서버 경유로 전환한다. 어댑터 sync 메서드는 옵셔널 시그니처만 인터페이스에 추가하고 매체별 실 구현은 Plan 5/6/7로 미룬다.

**Architecture:** Supabase pg_cron이 매 N분 active brand_credentials를 sync_jobs에 INSERT → 가상서버 sync-worker가 SELECT FOR UPDATE SKIP LOCKED LIMIT 1로 잡 pick → 어댑터 라우팅 → Plan 4 시점엔 어댑터 메서드 미구현이라 즉시 `skipped:true completed`. validate-proxy는 별도 PM2 프로세스로 HTTP 서버 띄워 X-Proxy-Token 인증된 POST /validate/{channel} 요청을 받아 외부 API를 가상서버 IP로 호출하고 결과를 JSON으로 반환. Vercel 어댑터는 fetch로 Cloudflare Tunnel URL을 호출.

**Tech Stack:** Supabase Postgres + pg_cron + Vault + RPC, Node 20.x LTS (가상서버), PM2, HTTP 내장 모듈, `bcryptjs`(스마트스토어 서명) + `crypto`(HMAC), Cloudflare Tunnel(기존 인프라 재사용), Next.js 16 App Router(Vercel — 변경 최소).

**Spec:** `docs/superpowers/specs/2026-06-30-plan4-sync-infra-validate-hotfix-design.md`

## Global Constraints

- **레포 위치 (로컬)**: `C:\Users\Jangkwon\Desktop\order-manager-saas`
- **가상서버**: `203.245.41.105`, SSH로 `root@andre21382138` 접속 (확인됨), 기존 `/root/naver-proxy/` PM2 프로세스 운영 중
- **Production URL (Vercel)**: `https://order-manager-saas-bay.vercel.app`
- **Supabase 프로젝트**: 기존 `order-manager` (`https://cvciddmmfyuwvfobtbyb.supabase.co`)
- **운영자 user_id**: `4bfab62c-f8b7-4c07-b170-70485e4a6266` (`ssakwon@kbh.kr`)
- **신규 가상서버 디렉토리**: `/root/sync-worker/`
- **신규 PM2 프로세스 2개**: `sync-worker` (worker.js) + `validate-proxy` (validate-server.js)
- **신규 환경변수 (Vercel + .env.local + 가상서버 .env)**: `VALIDATE_PROXY_URL`, `VALIDATE_PROXY_TOKEN`
- **가상서버 .env 추가**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VALIDATE_PROXY_PORT`(기본 3003)
- **sync_jobs polling 빈도**: 5초
- **stale running 임계값**: 10분
- **max retry**: 3회
- **pg_cron 잡 6개**: enqueue_cafe24_orders(매 30분), enqueue_cafe24_products(매일 03시), enqueue_smartstore_orders(매 30분), enqueue_naver_ad_stats(매 12시간 08·20시), enqueue_naver_ad_units(매일 03시), enqueue_token_refresh(매 5분)
- **자동 테스트 인프라 없음** — 빌드 통과 + 운영자 수동 검증
- **TypeScript strict 유지** (Vercel 코드만 해당, 가상서버는 plain Node.js)
- **모든 lib/* 파일 첫 줄에 `import 'server-only'`** (Vercel 측만)
- **Vault wrapper 호출 시 반드시 `admin.rpc('read_vault_secret', { secret_id })` 형식** — schema 명시 불필요(public)
- **service_role 키 보안**: 가상서버 `/root/sync-worker/.env` 파일 권한 `chmod 600`

## File Structure (Plan 4 완료 시점)

```
order-manager-saas/
├── app/                                        # Plan 3 그대로
├── components/                                  # Plan 3 그대로
├── lib/
│   ├── adapters/
│   │   ├── _types.ts                            # ★ 변경 — SyncContext/SyncResult/RefreshResult 타입 + sync 메서드 5개 옵셔널
│   │   ├── _registry.ts                         # Plan 3 그대로
│   │   ├── cafe24.ts                            # Plan 2 그대로
│   │   ├── smartstore.ts                        # ★ 변경 — validate가 VALIDATE_PROXY_URL 호출
│   │   └── naver-ad.ts                          # ★ 변경 — validate가 VALIDATE_PROXY_URL 호출
│   ├── supabase/                                # Plan 2 그대로
│   ├── brand-colors.ts                          # Plan 2 그대로
│   └── oauth-cookie.ts                          # Plan 2 그대로
├── supabase/migrations/
│   ├── 001~009_*.sql                            # Plan 1·2 그대로
│   ├── 010_vault_read_wrapper.sql               # ★ 신규
│   ├── 011_pg_cron_jobs.sql                     # ★ 신규
│   └── 012_sync_job_rpcs.sql                    # ★ 신규
├── server/                                       # ★ 신규 폴더
│   └── sync-worker/                              # 가상서버용 코드 (rsync 대상)
│       ├── package.json                          # ★ 신규
│       ├── ecosystem.config.js                   # ★ 신규 (PM2 2 apps)
│       ├── .env.example                          # ★ 신규
│       ├── worker.js                             # ★ 신규
│       ├── validate-server.js                    # ★ 신규
│       ├── lib/
│       │   ├── supabase.js                       # ★ 신규 — service_role 클라이언트
│       │   ├── adapters.js                       # ★ 신규 — Plan 4 시점 stub (sync 메서드 없음)
│       │   └── job-type-routing.js               # ★ 신규 — job_type → method 매핑
│       └── README.md                             # ★ 신규 — 배포·운영 가이드
├── .env.example                                  # ★ 변경 — VALIDATE_PROXY_URL/TOKEN 추가
├── .env.local                                    # ★ 변경 — 두 값 채움 (gitignored)
└── ...                                           # 그 외 Plan 3 그대로
```

---

### Task 1: 사전 점검 + VALIDATE_PROXY_TOKEN 생성 + Cloudflare Tunnel 결정

**Files:**
- Modify: `.env.example`, `.env.local`

**Interfaces:**
- Produces:
  - `VALIDATE_PROXY_TOKEN` — 32바이트 base64, Vercel + 가상서버 양쪽에서 동일 값 사용
  - `VALIDATE_PROXY_URL` — Cloudflare Tunnel URL (예: `https://proxy.{user-tunnel}.com`) 결정
  - Supabase pg_cron extension 활성 확인됨

- [ ] **Step 1: Supabase pg_cron extension 활성 확인**

Supabase 대시보드 → Database → Extensions → `pg_cron` 검색 → Enabled 확인. 비활성이면 토글 ON.

검증 쿼리 (SQL Editor):

```sql
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
```

기대: 1행 반환.

- [ ] **Step 2: Cloudflare Tunnel 라우트 결정**

기존 가상서버에 Cloudflare Tunnel이 설정되어 있고(기존 naver-proxy가 사용 중) tunnel URL을 갖고 있을 것. 다음 중 한 가지 선택:

**옵션 A — 기존 tunnel 재사용**: 새 path를 같은 도메인에 추가
- 예: 기존이 `https://proxy.example.com/naver/*`이면 새 path `https://proxy.example.com/validate/*`를 같은 tunnel ingress에 추가
- 가상서버에서 cloudflared 설정 변경: `~/.cloudflared/config.yml`의 ingress 섹션에 추가:

```yaml
ingress:
  - hostname: proxy.example.com
    path: /validate/.*
    service: http://localhost:3003
  - hostname: proxy.example.com
    path: /naver/.*  # 기존
    service: http://localhost:3002
  - service: http_status:404
```

→ `sudo systemctl restart cloudflared`

**옵션 B — 새 tunnel 또는 새 hostname**: 더 분리. 운영 복잡성 ↑

추천: **A**. 기존 인프라 재사용.

결정한 최종 URL을 메모: 예) `https://proxy.example.com/validate` (path까지 포함)

- [ ] **Step 3: VALIDATE_PROXY_TOKEN 생성**

PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

출력된 base64 문자열 메모.

- [ ] **Step 4: `.env.example` 갱신**

`C:\Users\Jangkwon\Desktop\order-manager-saas\.env.example` 끝에 추가:

```
# 가상서버 validate-proxy (스마트스토어/네이버광고 IP whitelist 우회 — Plan 4)
VALIDATE_PROXY_URL=
VALIDATE_PROXY_TOKEN=
```

- [ ] **Step 5: `.env.local`에 실제 값 채움**

`C:\Users\Jangkwon\Desktop\order-manager-saas\.env.local`에 추가:

```
VALIDATE_PROXY_URL=https://proxy.example.com/validate   # Step 2 결정한 URL
VALIDATE_PROXY_TOKEN=...                                # Step 3 생성한 값
```

- [ ] **Step 6: 빌드 확인**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
npm run build
```

기대: 빌드 성공. 환경변수만 추가했으므로 코드 변경 없음.

- [ ] **Step 7: 커밋**

```powershell
git add .env.example
git commit -m "chore(env): VALIDATE_PROXY_URL/TOKEN 환경변수 추가 (Plan 4 sync-worker)"
git push
```

> `.env.local`은 gitignored.

---

### Task 2: SQL 마이그레이션 3개 (vault read + sync_jobs RPC + pg_cron 잡)

**Files:**
- Create: `supabase/migrations/010_vault_read_wrapper.sql`
- Create: `supabase/migrations/011_pg_cron_jobs.sql`
- Create: `supabase/migrations/012_sync_job_rpcs.sql`

**Interfaces:**
- Produces:
  - `public.read_vault_secret(secret_id uuid) RETURNS text` RPC — service_role만 호출 가능
  - `public.pick_pending_job() RETURNS sync_jobs` RPC — 한 행 잠금 + status='running' 업데이트 + 반환
  - `public.reset_stale_running(threshold_minutes int DEFAULT 10) RETURNS int` RPC — stale running 행 개수 반환
  - 6개 pg_cron 잡 등록됨

- [ ] **Step 1: `010_vault_read_wrapper.sql` 작성**

```sql
-- Plan 4 / Task 2 — vault.decrypted_secrets를 public schema에서 service_role로 조회

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

- [ ] **Step 2: `012_sync_job_rpcs.sql` 작성**

`011`은 pg_cron 정의이고 RPC가 먼저 있어야 하므로 `012`를 먼저 만들지 말고 `011`을 잡 정의 후 작성. **순서가 중요**: 010 → 012 → 011 (cron 잡이 pick_pending_job을 직접 부르진 않지만, plan 일관성 위해 RPC 먼저).

`supabase/migrations/012_sync_job_rpcs.sql`:

```sql
-- Plan 4 / Task 2 — sync_jobs picking + stale running 회수 RPC

-- pick_pending_job: 한 행 잠금 + 즉시 status='running' + 반환
CREATE OR REPLACE FUNCTION public.pick_pending_job()
RETURNS sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job sync_jobs;
BEGIN
  SELECT * INTO v_job
  FROM sync_jobs
  WHERE status = 'pending'
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE sync_jobs
  SET status = 'running',
      started_at = now()
  WHERE id = v_job.id;

  v_job.status := 'running';
  v_job.started_at := now();
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_pending_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_pending_job() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_pending_job() TO service_role;

-- reset_stale_running: started_at > N분 전인 running 잡을 pending으로 되돌림
CREATE OR REPLACE FUNCTION public.reset_stale_running(threshold_minutes int DEFAULT 10)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH updated AS (
    UPDATE sync_jobs
    SET status = 'pending',
        started_at = NULL
    WHERE status = 'running'
      AND started_at < now() - (threshold_minutes || ' minutes')::interval
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_stale_running(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_stale_running(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_stale_running(int) TO service_role;
```

- [ ] **Step 3: `011_pg_cron_jobs.sql` 작성**

```sql
-- Plan 4 / Task 2 — pg_cron 6개 잡 (active credentials → sync_jobs INSERT)

-- 카페24 orders 매 30분
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

-- 카페24 products 매일 03시
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

-- 스마트스토어 orders 매 30분
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

-- 네이버광고 ad_stats 매 12시간 (08·20시)
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

-- 네이버광고 ad_units 매일 03시
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

-- token refresh 매 5분 (cafe24 + smartstore만, expires_at 30분 이내)
SELECT cron.schedule(
  'enqueue_token_refresh',
  '*/5 * * * *',
  $$
  INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
  SELECT bc.brand_id, bc.id, bc.channel, 'token_refresh', now()
  FROM brand_credentials bc
  WHERE bc.channel IN ('cafe24', 'smartstore')
    AND bc.status = 'active'
    AND (
      bc.metadata->>'expires_at' IS NULL
      OR (bc.metadata->>'expires_at')::timestamptz < now() + interval '30 minutes'
    )
  $$
);
```

- [ ] **Step 4: 사용자가 Supabase SQL Editor에서 세 파일 순차 실행**

순서: `010` → `012` → `011`.

각 파일을 SQL Editor에 통째로 복사 → Run → Success 확인.

각각 한 번씩 실행. 동일 파일 두 번 실행하면 cron.schedule이 같은 이름으로 중복 등록될 수 있으니 처음 한 번만.

- [ ] **Step 5: 검증 쿼리 3개**

SQL Editor에서:

```sql
-- 1. RPC 등록 확인
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('read_vault_secret', 'pick_pending_job', 'reset_stale_running');

-- 2. pg_cron 잡 6개 확인
SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'enqueue_%' ORDER BY jobname;

-- 3. read_vault_secret 동작 확인 — 임의 secret_id로 NULL 반환되는지 (실제 secret 없으니 NULL)
SELECT public.read_vault_secret('00000000-0000-0000-0000-000000000000'::uuid);
```

기대:
- 1번: 3행 (read_vault_secret, pick_pending_job, reset_stale_running)
- 2번: 6행 (enqueue_cafe24_orders, enqueue_cafe24_products, enqueue_naver_ad_stats, enqueue_naver_ad_units, enqueue_smartstore_orders, enqueue_token_refresh)
- 3번: NULL (정상 — 없는 secret_id라 NULL)

- [ ] **Step 6: 커밋**

```powershell
git add supabase/migrations/010_vault_read_wrapper.sql supabase/migrations/011_pg_cron_jobs.sql supabase/migrations/012_sync_job_rpcs.sql
git commit -m "feat(db): vault read wrapper + sync_jobs picking RPC + pg_cron 잡 6개"
git push
```

---

### Task 3: 어댑터 인터페이스 확장 (`_types.ts`)

**Files:**
- Modify: `lib/adapters/_types.ts`

**Interfaces:**
- Consumes: 기존 `Channel`, `CredentialPayload`, `ValidateResult`
- Produces:
  - `SyncContext` 타입 — `{ brandId, channelAccount, dateRangeStart?, dateRangeEnd? }`
  - `SyncResult` 타입 — discriminated union `{ ok: true, rowsUpserted, meta? } | { ok: false, error, retryable }`
  - `RefreshResult` 타입 — `{ ok: true, newPayload } | { ok: false, error }`
  - `ChannelAdapter`에 옵셔널 `refreshToken?`, `syncOrders?`, `syncProducts?`, `syncAdUnits?`, `syncAdStats?` 추가

- [ ] **Step 1: `lib/adapters/_types.ts` 갱신**

전체 파일을 다음으로 교체:

```typescript
import 'server-only'

export type Channel = 'cafe24' | 'smartstore' | 'naver_ad'
export type AuthType = 'oauth' | 'api_key'

export interface CredentialPayload {
  [key: string]: string | number | undefined
}

export interface GetAuthUrlInput {
  appId: string
  mallId: string
  state: string
  redirectUri: string
}

export interface HandleCallbackInput {
  code: string
  mallId: string
  appId: string
  appSecret: string
  redirectUri: string
}

export type ValidateResult = { ok: true } | { ok: false; error: string }

export interface FieldDef {
  key: string
  label: string
  placeholder?: string
  secret?: boolean
  hint?: string
}

// ★ Plan 4 신규
export interface SyncContext {
  brandId: string
  channelAccount: string
  dateRangeStart?: string
  dateRangeEnd?: string
}

export type SyncResult =
  | { ok: true; rowsUpserted: number; meta?: Record<string, unknown> }
  | { ok: false; error: string; retryable: boolean }

export type RefreshResult =
  | { ok: true; newPayload: CredentialPayload }
  | { ok: false; error: string }

export interface ChannelAdapter {
  channel: Channel
  category: 'shop' | 'ad'
  authType: AuthType

  // OAuth 매체 (cafe24) — Plan 2
  getAuthUrl?(input: GetAuthUrlInput): string
  handleCallback?(input: HandleCallbackInput): Promise<CredentialPayload>

  // API 키 매체 (smartstore, naver_ad) — Plan 3
  credentialFields?: FieldDef[]
  buildPayload?(formValues: Record<string, string>): CredentialPayload

  // 공통
  validate(creds: CredentialPayload): Promise<ValidateResult>

  // ★ Plan 4 신규 — Plan 5/6/7에서 매체별 구현
  refreshToken?(creds: CredentialPayload): Promise<RefreshResult>
  syncOrders?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
  syncProducts?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
  syncAdUnits?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
  syncAdStats?(creds: CredentialPayload, ctx: SyncContext): Promise<SyncResult>
}
```

- [ ] **Step 2: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음. 기존 cafe24/smartstore/naver-ad 어댑터는 신규 옵셔널 메서드 미구현이지만 모두 옵셔널이라 OK.

- [ ] **Step 3: 커밋**

```powershell
git add lib/adapters/_types.ts
git commit -m "feat(adapters): ChannelAdapter에 SyncContext/SyncResult/RefreshResult + sync 메서드 5개 옵셔널 추가"
git push
```

---

### Task 4: Vercel smartstore/naver-ad 어댑터 validate hotfix

**Files:**
- Modify: `lib/adapters/smartstore.ts`
- Modify: `lib/adapters/naver-ad.ts`

**Interfaces:**
- Consumes: 환경변수 `VALIDATE_PROXY_URL`, `VALIDATE_PROXY_TOKEN` (Task 1)
- Produces: 두 어댑터의 `validate` 함수가 직접 외부 API 호출하지 않고 가상서버 endpoint를 호출. `credentialFields`, `buildPayload`는 변경 없음.

- [ ] **Step 1: `lib/adapters/smartstore.ts`의 validate 함수만 교체**

기존 validate 함수(약 30줄)를 다음으로 교체. 다른 함수(`buildPayload`, `credentialFields`, export 등)는 그대로:

```typescript
async function validate(creds: CredentialPayload): Promise<ValidateResult> {
  const proxyUrl = process.env.VALIDATE_PROXY_URL
  const token = process.env.VALIDATE_PROXY_TOKEN
  if (!proxyUrl || !token) {
    return { ok: false, error: 'validate-proxy 설정 누락 (VALIDATE_PROXY_URL/TOKEN)' }
  }

  let r: Response
  try {
    r = await fetch(`${proxyUrl}/validate/smartstore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proxy-Token': token,
      },
      body: JSON.stringify({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error'
    return { ok: false, error: `validate-proxy 호출 실패: ${msg}` }
  }

  if (!r.ok) {
    if (r.status === 401) return { ok: false, error: 'validate-proxy 인증 실패 (token 불일치)' }
    return { ok: false, error: `validate-proxy 응답 ${r.status}` }
  }

  try {
    return (await r.json()) as ValidateResult
  } catch {
    return { ok: false, error: 'validate-proxy 응답 파싱 실패' }
  }
}
```

> 기존 `bcrypt` import는 이제 사용 안 함 → 파일 상단의 `import bcrypt from 'bcryptjs'` 제거. `NAVER_COMMERCE_BASE` 상수도 제거. validate 함수 안에서 쓰던 다른 변수는 모두 가상서버로 옮겨갔으니 정리.

- [ ] **Step 2: `lib/adapters/smartstore.ts` 정리 (불필요 import/상수 제거)**

파일 상단 import에서 다음 제거:

```typescript
import bcrypt from 'bcryptjs'
```

파일 상단 상수에서 다음 제거:

```typescript
const NAVER_COMMERCE_BASE = 'https://api.commerce.naver.com'
```

남는 import:

```typescript
import 'server-only'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
} from './_types'
```

- [ ] **Step 3: `lib/adapters/naver-ad.ts`의 validate 함수만 교체**

기존 validate 함수를 다음으로 교체:

```typescript
async function validate(creds: CredentialPayload): Promise<ValidateResult> {
  const proxyUrl = process.env.VALIDATE_PROXY_URL
  const token = process.env.VALIDATE_PROXY_TOKEN
  if (!proxyUrl || !token) {
    return { ok: false, error: 'validate-proxy 설정 누락 (VALIDATE_PROXY_URL/TOKEN)' }
  }

  let r: Response
  try {
    r = await fetch(`${proxyUrl}/validate/naver_ad`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Proxy-Token': token,
      },
      body: JSON.stringify({
        customerId: creds.customerId,
        accessLicense: creds.accessLicense,
        secretKey: creds.secretKey,
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error'
    return { ok: false, error: `validate-proxy 호출 실패: ${msg}` }
  }

  if (!r.ok) {
    if (r.status === 401) return { ok: false, error: 'validate-proxy 인증 실패 (token 불일치)' }
    return { ok: false, error: `validate-proxy 응답 ${r.status}` }
  }

  try {
    return (await r.json()) as ValidateResult
  } catch {
    return { ok: false, error: 'validate-proxy 응답 파싱 실패' }
  }
}
```

- [ ] **Step 4: `lib/adapters/naver-ad.ts` 정리**

파일 상단에서 다음 제거:

```typescript
import { createHmac } from 'crypto'
```

상수 제거:

```typescript
const NAVERAD_BASE = 'https://api.searchad.naver.com'
```

`signHmac` 함수 전체 제거.

남는 import:

```typescript
import 'server-only'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
} from './_types'
```

- [ ] **Step 5: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음. 기존 라우트 그대로.

- [ ] **Step 6: 커밋**

```powershell
git add lib/adapters/smartstore.ts lib/adapters/naver-ad.ts
git commit -m "fix(adapters): smartstore/naver_ad validate를 가상서버 경유로 (Plan 4 hotfix)"
git push
```

---

### Task 5: 가상서버 sync-worker + validate-proxy 코드

**Files:**
- Create: `server/sync-worker/package.json`
- Create: `server/sync-worker/ecosystem.config.js`
- Create: `server/sync-worker/.env.example`
- Create: `server/sync-worker/worker.js`
- Create: `server/sync-worker/validate-server.js`
- Create: `server/sync-worker/lib/supabase.js`
- Create: `server/sync-worker/lib/adapters.js`
- Create: `server/sync-worker/lib/job-type-routing.js`
- Create: `server/sync-worker/README.md`

**Interfaces:**
- Consumes:
  - Supabase RPC (`pick_pending_job`, `reset_stale_running`, `read_vault_secret`) — Task 2에서 등록
  - 환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VALIDATE_PROXY_PORT`, `VALIDATE_PROXY_TOKEN`
- Produces:
  - PM2가 띄울 두 entry: `worker.js`, `validate-server.js`
  - PM2 ecosystem 파일이 두 앱을 동시 관리

- [ ] **Step 1: `server/sync-worker/package.json`**

```json
{
  "name": "sync-worker",
  "version": "1.0.0",
  "private": true,
  "description": "Plan 4 sync worker + validate-proxy for order-manager-saas",
  "main": "worker.js",
  "scripts": {
    "start:worker": "node worker.js",
    "start:validate": "node validate-server.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.108.2",
    "bcryptjs": "^3.0.3"
  }
}
```

- [ ] **Step 2: `server/sync-worker/ecosystem.config.js`**

```javascript
module.exports = {
  apps: [
    {
      name: 'sync-worker',
      script: './worker.js',
      cwd: '/root/sync-worker',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      error_file: './sync-worker.err.log',
      out_file: './sync-worker.out.log',
      time: true,
    },
    {
      name: 'validate-proxy',
      script: './validate-server.js',
      cwd: '/root/sync-worker',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      env: { NODE_ENV: 'production' },
      error_file: './validate-proxy.err.log',
      out_file: './validate-proxy.out.log',
      time: true,
    },
  ],
}
```

- [ ] **Step 3: `server/sync-worker/.env.example`**

```
# Supabase
SUPABASE_URL=https://cvciddmmfyuwvfobtbyb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

# validate-proxy
VALIDATE_PROXY_PORT=3003
VALIDATE_PROXY_TOKEN=
```

- [ ] **Step 4: `server/sync-worker/lib/supabase.js`**

```javascript
const { createClient } = require('@supabase/supabase-js')

function createAdminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

module.exports = { createAdminClient }
```

- [ ] **Step 5: `server/sync-worker/lib/job-type-routing.js`**

```javascript
// job_type → adapter method name 매핑

const JOB_TYPE_TO_METHOD = {
  orders: 'syncOrders',
  products: 'syncProducts',
  ad_stats: 'syncAdStats',
  ad_units: 'syncAdUnits',
  token_refresh: 'refreshToken',
}

module.exports = { JOB_TYPE_TO_METHOD }
```

- [ ] **Step 6: `server/sync-worker/lib/adapters.js`**

```javascript
// Plan 4 시점 stub registry — 실 sync 메서드는 Plan 5/6/7에서 추가
// 각 어댑터는 channel 식별자만 가지고 sync 메서드는 모두 없음 → worker가 skip

const cafe24Adapter = {
  channel: 'cafe24',
  // syncOrders/syncProducts/syncAdUnits/refreshToken — Plan 5에서 구현
}

const smartstoreAdapter = {
  channel: 'smartstore',
  // syncOrders/syncProducts — Plan 6에서 구현
}

const naverAdAdapter = {
  channel: 'naver_ad',
  // syncAdStats/syncAdUnits — Plan 7에서 구현
}

const adapters = {
  cafe24: cafe24Adapter,
  smartstore: smartstoreAdapter,
  naver_ad: naverAdAdapter,
}

function getAdapter(channel) {
  return adapters[channel]
}

module.exports = { getAdapter }
```

- [ ] **Step 7: `server/sync-worker/worker.js`**

```javascript
require('dotenv').config()
const { createAdminClient } = require('./lib/supabase')
const { JOB_TYPE_TO_METHOD } = require('./lib/job-type-routing')
const { getAdapter } = require('./lib/adapters')

const POLL_INTERVAL_MS = 5000
const STALE_RUNNING_THRESHOLD_MIN = 10
const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const MAX_RETRY = 3

const admin = createAdminClient()

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}`
  if (extra) console.log(line, JSON.stringify(extra))
  else console.log(line)
}

async function markCompleted(jobId, resultSummary) {
  await admin
    .from('sync_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result_summary: resultSummary,
    })
    .eq('id', jobId)
}

async function markFailed(jobId, retryCount, errorMessage, retryable) {
  const newRetry = (retryCount ?? 0) + 1
  const final = !retryable || newRetry >= MAX_RETRY
  await admin
    .from('sync_jobs')
    .update({
      status: final ? 'failed' : 'pending',
      completed_at: final ? new Date().toISOString() : null,
      started_at: final ? null : null,
      retry_count: newRetry,
      error_message: errorMessage,
    })
    .eq('id', jobId)
}

async function recoverStaleRunning() {
  try {
    const { data, error } = await admin.rpc('reset_stale_running', {
      threshold_minutes: STALE_RUNNING_THRESHOLD_MIN,
    })
    if (error) {
      log('ERROR', 'reset_stale_running failed', { msg: error.message })
      return
    }
    if (data && data > 0) log('INFO', `reset_stale_running: ${data} jobs returned to pending`)
  } catch (e) {
    log('ERROR', 'reset_stale_running exception', { msg: e.message })
  }
}

async function pollOnce() {
  let job
  try {
    const { data, error } = await admin.rpc('pick_pending_job')
    if (error) {
      log('ERROR', 'pick_pending_job failed', { msg: error.message })
      return
    }
    if (!data) return // no pending job
    job = data
  } catch (e) {
    log('ERROR', 'pick_pending_job exception', { msg: e.message })
    return
  }

  log('INFO', `picked job ${job.id} (${job.channel}/${job.job_type})`)

  try {
    // brand_credentials 조회
    const { data: cred, error: credErr } = await admin
      .from('brand_credentials')
      .select('id, brand_id, channel, channel_account, secret_id')
      .eq('id', job.credential_id)
      .single()
    if (credErr || !cred) {
      throw new Error(`credential ${job.credential_id} not found: ${credErr?.message ?? ''}`)
    }

    // Vault에서 자격증명 복호화
    const { data: secretText, error: vaultErr } = await admin.rpc('read_vault_secret', {
      secret_id: cred.secret_id,
    })
    if (vaultErr || !secretText) {
      throw new Error(`vault read failed: ${vaultErr?.message ?? 'empty'}`)
    }
    const creds = JSON.parse(secretText)

    // 어댑터 라우팅
    const adapter = getAdapter(job.channel)
    if (!adapter) {
      throw new Error(`unknown channel: ${job.channel}`)
    }
    const methodName = JOB_TYPE_TO_METHOD[job.job_type]
    if (!methodName) {
      throw new Error(`unknown job_type: ${job.job_type}`)
    }
    const method = adapter[methodName]
    if (typeof method !== 'function') {
      // Plan 4 시점: 미구현이라 skip
      await markCompleted(job.id, {
        skipped: true,
        reason: 'method_not_implemented',
        method: methodName,
      })
      log('INFO', `job ${job.id} skipped (method ${methodName} not implemented)`)
      return
    }

    // 실 sync 호출 (Plan 5+ 이후)
    const ctx = {
      brandId: job.brand_id,
      channelAccount: cred.channel_account,
      dateRangeStart: job.date_range_start,
      dateRangeEnd: job.date_range_end,
    }
    const result = await method(creds, ctx)

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
  } catch (e) {
    await markFailed(job.id, job.retry_count, e.message, true)
    log('ERROR', `job ${job.id} exception`, { msg: e.message })
  }
}

log('INFO', 'sync-worker starting')
recoverStaleRunning().then(() => {
  setInterval(pollOnce, POLL_INTERVAL_MS)
  setInterval(recoverStaleRunning, STALE_CHECK_INTERVAL_MS)
  pollOnce()
})
```

- [ ] **Step 8: `server/sync-worker/validate-server.js`**

```javascript
require('dotenv').config()
const http = require('http')
const https = require('https')
const bcrypt = require('bcryptjs')
const { createHmac } = require('crypto')

const PORT = Number(process.env.VALIDATE_PROXY_PORT || 3003)
const TOKEN = process.env.VALIDATE_PROXY_TOKEN

if (!TOKEN) {
  console.error('VALIDATE_PROXY_TOKEN not set')
  process.exit(1)
}

const NAVER_COMMERCE_BASE = 'https://api.commerce.naver.com'
const NAVERAD_BASE = 'https://api.searchad.naver.com'

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}`
  if (extra) console.log(line, JSON.stringify(extra))
  else console.log(line)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

async function validateSmartstore(body) {
  const clientId = String(body.clientId ?? '')
  const clientSecret = String(body.clientSecret ?? '')
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'clientId/clientSecret 누락' }
  }
  const timestamp = Date.now()
  const password = `${clientId}_${timestamp}`
  const hashed = bcrypt.hashSync(password, clientSecret)
  const sign = Buffer.from(hashed).toString('base64')
  const formBody = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: sign,
    grant_type: 'client_credentials',
    type: 'SELF',
  }).toString()

  let r
  try {
    r = await fetch(`${NAVER_COMMERCE_BASE}/external/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    })
  } catch (e) {
    return { ok: false, error: `네이버 commerce 호출 실패: ${e.message}` }
  }

  if (r.ok) {
    const data = await r.json().catch(() => null)
    if (data?.access_token) return { ok: true }
    return { ok: false, error: '응답에 access_token 없음' }
  }
  if (r.status === 400 || r.status === 401) {
    return { ok: false, error: 'Client ID 또는 Secret이 올바르지 않습니다' }
  }
  const text = await r.text().catch(() => '')
  return { ok: false, error: `스마트스토어 API 에러 (${r.status}): ${text.slice(0, 200)}` }
}

function signHmac(method, uri, timestamp, secretKey) {
  return createHmac('sha256', secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest('base64')
}

async function validateNaverAd(body) {
  const customerId = String(body.customerId ?? '')
  const accessLicense = String(body.accessLicense ?? '')
  const secretKey = String(body.secretKey ?? '')
  if (!customerId || !accessLicense || !secretKey) {
    return { ok: false, error: 'customerId/accessLicense/secretKey 누락' }
  }
  const uri = '/ncc/campaigns'
  const timestamp = Date.now().toString()
  const signature = signHmac('GET', uri, timestamp, secretKey)

  let r
  try {
    r = await fetch(`${NAVERAD_BASE}${uri}`, {
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': accessLicense,
        'X-Customer': customerId,
        'X-Signature': signature,
      },
    })
  } catch (e) {
    return { ok: false, error: `네이버광고 호출 실패: ${e.message}` }
  }

  if (r.ok) return { ok: true }
  if (r.status === 401 || r.status === 403) {
    return { ok: false, error: '키가 유효하지 않습니다. customer_id / access license / secret key 확인' }
  }
  const text = await r.text().catch(() => '')
  return { ok: false, error: `네이버광고 API 에러 (${r.status}): ${text.slice(0, 200)}` }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method not allowed' })
  }

  if (req.headers['x-proxy-token'] !== TOKEN) {
    return send(res, 401, { error: 'unauthorized' })
  }

  const m = req.url.match(/^\/validate\/(smartstore|naver_ad)\/?$/)
  if (!m) {
    return send(res, 404, { error: 'unknown channel' })
  }
  const channel = m[1]

  let body
  try {
    const raw = await readBody(req)
    body = JSON.parse(raw)
  } catch {
    return send(res, 400, { error: 'invalid json' })
  }

  try {
    const result = channel === 'smartstore'
      ? await validateSmartstore(body)
      : await validateNaverAd(body)
    log('INFO', `validated ${channel}: ${result.ok ? 'OK' : 'FAIL'}`)
    return send(res, 200, result)
  } catch (e) {
    log('ERROR', `validate ${channel} exception`, { msg: e.message })
    return send(res, 500, { ok: false, error: e.message })
  }
})

server.listen(PORT, () => {
  log('INFO', `validate-proxy listening on ${PORT}`)
})
```

- [ ] **Step 9: `server/sync-worker/README.md`**

```markdown
# sync-worker

가상서버용 sync-worker + validate-proxy (Plan 4).

## 구성

- `worker.js` — Supabase sync_jobs 큐 polling, 5초마다 한 잡 picking, 어댑터 라우팅
- `validate-server.js` — HTTP 서버 (기본 포트 3003), 스마트스토어/네이버광고 validate를 가상서버 IP로 대행
- `lib/supabase.js` — service_role 클라이언트
- `lib/adapters.js` — Plan 4 시점 stub (sync 메서드 미구현). Plan 5/6/7에서 매체별 추가
- `lib/job-type-routing.js` — job_type → adapter method 매핑

## 배포 (가상서버 `/root/sync-worker/`)

1. 로컬에서 rsync (또는 git push):
   ```
   rsync -av --exclude='.env' --exclude='node_modules' --exclude='*.log' \
     server/sync-worker/ root@203.245.41.105:/root/sync-worker/
   ```
2. 가상서버 SSH:
   ```
   cd /root/sync-worker
   npm install --omit=dev
   cp .env.example .env   # 첫 배포 시만
   nano .env              # SERVICE_ROLE_KEY, VALIDATE_PROXY_TOKEN 채움
   chmod 600 .env
   ```
3. PM2 등록:
   ```
   pm2 start ecosystem.config.js
   pm2 save
   ```
4. 로그 확인:
   ```
   pm2 logs sync-worker
   pm2 logs validate-proxy
   ```

## Cloudflare Tunnel 라우트

`~/.cloudflared/config.yml`의 ingress에 추가:

```yaml
ingress:
  - hostname: <tunnel-host>
    path: /validate/.*
    service: http://localhost:3003
  # 기존 라우트들 ...
```

`sudo systemctl restart cloudflared`.

## 검증

```bash
# validate-proxy 동작 확인 (TOKEN 일치 시)
curl -X POST https://<tunnel-host>/validate/naver_ad \
  -H "X-Proxy-Token: <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"...","accessLicense":"...","secretKey":"..."}'

# 401 확인 (TOKEN 누락)
curl -X POST https://<tunnel-host>/validate/naver_ad -d '{}'
```
```

- [ ] **Step 10: 빌드 확인 (Vercel은 server/ 폴더 빌드 안 함)**

```powershell
npm run build
```

기대: Vercel 빌드 성공. `server/` 폴더는 Next.js와 무관하므로 영향 없음.

- [ ] **Step 11: 커밋**

```powershell
git add server/sync-worker/
git commit -m "feat(sync-worker): 가상서버 worker + validate-proxy 코드 (Plan 4)"
git push
```

---

### Task 6: 가상서버 배포 (사용자 직접)

**Files:**
- 외부 작업 (가상서버 SSH + rsync + PM2)

**Interfaces:**
- Produces: 가상서버 `/root/sync-worker/`에 코드 배포 + .env 작성 + PM2 두 앱 `online` 상태

이 task는 사용자가 직접 SSH로 진행. subagent 자동화 불가.

- [ ] **Step 1: 로컬에서 가상서버로 rsync**

PowerShell에서 (WSL 또는 git-bash 권장):

```bash
rsync -av --exclude='.env' --exclude='node_modules' --exclude='*.log' \
  /c/Users/Jangkwon/Desktop/order-manager-saas/server/sync-worker/ \
  root@203.245.41.105:/root/sync-worker/
```

> Windows PowerShell에서 rsync가 없으면 git-bash에서 실행하거나 scp 사용. 또는 WinSCP 같은 GUI 도구.

대안 — git clone (가상서버에서):
```bash
ssh root@203.245.41.105
cd /root
git clone https://github.com/andre21382138-jpg/order-manager-saas.git temp-saas
cp -r temp-saas/server/sync-worker /root/
rm -rf temp-saas
```

- [ ] **Step 2: 가상서버에 SSH 접속 + npm install**

```bash
ssh root@203.245.41.105
cd /root/sync-worker
npm install --omit=dev
```

기대: `node_modules/` 생성, `@supabase/supabase-js` + `bcryptjs` 설치됨.

- [ ] **Step 3: `.env` 작성**

```bash
cp .env.example .env
nano .env
```

내용:
```
SUPABASE_URL=https://cvciddmmfyuwvfobtbyb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Vercel 환경변수와 동일 값>
VALIDATE_PROXY_PORT=3003
VALIDATE_PROXY_TOKEN=<Task 1 Step 3에서 생성한 값>
```

`Ctrl+O` 저장, `Ctrl+X` 종료.

- [ ] **Step 4: 권한 보호**

```bash
chmod 600 /root/sync-worker/.env
ls -la /root/sync-worker/.env
```

기대: `-rw-------` 표시.

- [ ] **Step 5: PM2 등록 + 시작**

```bash
cd /root/sync-worker
pm2 start ecosystem.config.js
pm2 save
pm2 list
```

기대: PM2 list에 `sync-worker` + `validate-proxy` 두 행이 `online` 상태로 표시.

- [ ] **Step 6: 로그 확인**

```bash
pm2 logs sync-worker --lines 20
pm2 logs validate-proxy --lines 20
```

기대:
- `sync-worker`: `sync-worker starting` + 5초 후 `pick_pending_job` 호출 (잡 없으면 조용히 return)
- `validate-proxy`: `validate-proxy listening on 3003`

- [ ] **Step 7: Cloudflare Tunnel 라우트 추가**

```bash
nano ~/.cloudflared/config.yml
```

ingress 섹션에 추가 (기존 라우트 위에 — 더 구체적인 path가 위에 와야 매칭됨):

```yaml
ingress:
  - hostname: <기존 tunnel hostname>
    path: /validate/.*
    service: http://localhost:3003
  # 기존 라우트들 그대로 ...
  - service: http_status:404
```

저장 후:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

기대: `active (running)` 상태.

- [ ] **Step 8: validate-proxy 외부 호출 검증**

로컬 PowerShell에서:

```powershell
curl.exe -X POST "https://<tunnel-host>/validate/naver_ad" `
  -H "X-Proxy-Token: <YOUR_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{"customerId":"1313865","accessLicense":"...","secretKey":"..."}'
```

기대: 200 응답, body `{"ok":true}` 또는 `{"ok":false,"error":"..."}` 형태.

401 확인:
```powershell
curl.exe -X POST "https://<tunnel-host>/validate/naver_ad" `
  -H "Content-Type: application/json" -d "{}"
```

기대: 401 `{"error":"unauthorized"}`.

- [ ] **Step 9: 가상서버 작업 완료 (커밋 없음)**

이 task는 외부 서버 설정만이라 git 커밋 없음. Plan 4의 코드 커밋은 Task 5까지로 종료.

---

### Task 7: Vercel 환경변수 등록 + 재배포

**Files:**
- 외부 작업 (Vercel 대시보드)

**Interfaces:**
- Produces: Vercel 프로덕션 환경에 `VALIDATE_PROXY_URL` + `VALIDATE_PROXY_TOKEN` 등록 + 새 빌드 Ready

- [ ] **Step 1: Vercel 환경변수 추가**

Vercel 대시보드 → `order-manager-saas` → Settings → Environment Variables → Add:

| Key | Value | Environments |
|---|---|---|
| `VALIDATE_PROXY_URL` | Task 1 Step 2 결정한 URL | Production, Preview, Development |
| `VALIDATE_PROXY_TOKEN` | Task 1 Step 3 생성 + 가상서버 .env와 동일 값 | Production, Preview, Development |

- [ ] **Step 2: 캐시 무시 재배포**

Deployments 탭 → 최신 배포 ⋯ → Redeploy → **"Use existing Build Cache" 체크 해제** → Redeploy.

기대: 1~2분 후 Ready 상태.

- [ ] **Step 3: 함수가 새 env 보는지 확인 (검증은 Task 8에서)**

이 task는 Vercel 설정만. 검증은 다음 task.

---

### Task 8: 통합 수동 검증 (15 시나리오)

**Files:**
- 외부 작업 (브라우저 + SSH + SQL Editor + curl)

**Interfaces:**
- Produces: spec §10의 15 시나리오 모두 통과

이 task는 사용자가 직접 진행. 결과를 chat으로 보고.

- [ ] **Step 1: 인프라 (5) — RPC 등록**

Supabase SQL Editor:

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('read_vault_secret', 'pick_pending_job', 'reset_stale_running');
```

기대: 3행.

- [ ] **Step 2: 인프라 — pg_cron 잡 6개**

```sql
SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'enqueue_%' ORDER BY jobname;
```

기대: 6행.

- [ ] **Step 3: 인프라 — PM2 두 프로세스 online**

가상서버에서:
```bash
pm2 list
```

기대: `sync-worker` + `validate-proxy` 모두 `online`.

- [ ] **Step 4: 인프라 — validate-proxy curl 200**

로컬 PowerShell:
```powershell
curl.exe -X POST "https://<tunnel-host>/validate/naver_ad" `
  -H "X-Proxy-Token: <TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{"customerId":"1313865","accessLicense":"...","secretKey":"..."}'
```

기대: 200 + JSON 응답.

- [ ] **Step 5: 인프라 — read_vault_secret 호출 (가상서버에서)**

가상서버 SSH:
```bash
cd /root/sync-worker
node -e "
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
admin.rpc('read_vault_secret', { secret_id: '00000000-0000-0000-0000-000000000000' })
  .then(r => console.log('result:', r))
"
```

기대: `result: { data: null, error: null }` (해당 id 없으니 null).

- [ ] **Step 6: Validate hotfix — 스마트스토어 프로덕션 등록**

`https://order-manager-saas-bay.vercel.app` 시크릿 창에서:
1. 운영자 로그인
2. 새 임시 브랜드 만들거나 기존 사용
3. "+ 스마트스토어 계정 추가" → PALEO_APP_ID/SECRET 입력 → 등록
4. ✅ smartstore:테스트 표시되어야 함 (이번엔 가상서버 경유라 IP whitelist 통과)

기대: 성공 배너.

- [ ] **Step 7: Validate hotfix — 네이버광고 프로덕션 등록**

같은 브랜드 → "+ 네이버광고 계정 추가" → 검증 키 입력 → 등록 → ✅ 표시.

- [ ] **Step 8: Validate hotfix — 401 보안 확인**

curl로 PROXY_TOKEN 누락:
```powershell
curl.exe -X POST "https://<tunnel-host>/validate/smartstore" -d "{}"
```

기대: 401 `{"error":"unauthorized"}`.

- [ ] **Step 9: Validate hotfix — 미지원 채널 404**

```powershell
curl.exe -X POST "https://<tunnel-host>/validate/cafe24" `
  -H "X-Proxy-Token: <TOKEN>"
```

기대: 404 `{"error":"unknown channel"}`.

- [ ] **Step 10: 큐 흐름 — pg_cron 잡이 sync_jobs INSERT**

Step 6·7에서 등록한 active credentials가 있으니 30분(또는 cron 즉시 실행)이면 sync_jobs에 행 들어옴. 즉시 검증 — 수동 트리거:

```sql
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'enqueue_smartstore_orders'),
  schedule := '* * * * *'  -- 매분 (임시)
);
```

1~2분 대기 후:
```sql
SELECT status, channel, job_type, created_at FROM sync_jobs ORDER BY created_at DESC LIMIT 5;
```

기대: 새 행이 `pending` 또는 `completed`로 표시.

검증 끝나면 원래 schedule로 복구:
```sql
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'enqueue_smartstore_orders'),
  schedule := '*/30 * * * *'
);
```

- [ ] **Step 11: 큐 흐름 — sync-worker가 잡 picking + skip**

가상서버에서:
```bash
pm2 logs sync-worker --lines 30
```

기대 로그: `picked job ... (smartstore/orders)` → `job ... skipped (method syncOrders not implemented)`.

SQL 확인:
```sql
SELECT id, status, result_summary FROM sync_jobs ORDER BY completed_at DESC NULLS LAST LIMIT 5;
```

기대: `completed` + `result_summary` JSON에 `{"skipped":true,"reason":"method_not_implemented","method":"syncOrders"}`.

- [ ] **Step 12: 큐 흐름 — FOR UPDATE SKIP LOCKED 검증**

수동 부하 시뮬 — 가상서버에서 sync-worker 인스턴스 1개 추가:
```bash
cd /root/sync-worker
node worker.js &
```

10초 후 `Ctrl+C`로 종료. PM2 로그 + 별도 인스턴스 로그를 비교해서 같은 잡 ID가 양쪽에서 처리되지 않는지 확인. 또는 sync_jobs에 동일 잡이 두 번 처리된 흔적 없는지 SQL로:

```sql
SELECT id, completed_at FROM sync_jobs ORDER BY completed_at DESC LIMIT 10;
```

기대: 각 id가 한 번씩만 completed 상태.

- [ ] **Step 13: 큐 흐름 — 실패 + retry**

가상서버에서 임시로 worker.js의 `markFailed` 호출을 강제 — 직접 SQL로 시뮬:

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at, retry_count)
VALUES (
  (SELECT brand_id FROM brand_credentials WHERE channel = 'smartstore' LIMIT 1),
  (SELECT id FROM brand_credentials WHERE channel = 'smartstore' LIMIT 1),
  'smartstore',
  'unknown_type',  -- 의도적 잘못된 job_type
  now(),
  0
);
```

5~10초 후 워커가 처리:

```sql
SELECT id, status, retry_count, error_message FROM sync_jobs
WHERE job_type = 'unknown_type' ORDER BY created_at DESC LIMIT 5;
```

기대: 첫 시도 후 `status='pending'` + `retry_count=1` + `error_message='unknown job_type: unknown_type'`. 다음 polling에서 다시 시도 → `retry_count=2` → `retry_count=3`에서 `status='failed'` 고정.

> 5번 인덱스 (status, scheduled_at) WHERE pending/running이라 pending으로 돌아가도 다시 polling됨.

정리:
```sql
DELETE FROM sync_jobs WHERE job_type = 'unknown_type';
```

- [ ] **Step 14: 큐 흐름 — max retry 3**

위 Step 13 결과로 자연스럽게 확인됨. retry_count가 3 되면 `status='failed'` 고정.

- [ ] **Step 15: 큐 흐름 — stale running 회수**

수동 시뮬 — SQL로 `running` 잡을 만들고 started_at을 11분 전으로:

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at, status, started_at)
VALUES (
  (SELECT brand_id FROM brand_credentials WHERE channel = 'smartstore' LIMIT 1),
  (SELECT id FROM brand_credentials WHERE channel = 'smartstore' LIMIT 1),
  'smartstore',
  'orders',
  now(),
  'running',
  now() - interval '11 minutes'
);
```

가상서버에서:
```bash
pm2 restart sync-worker
pm2 logs sync-worker --lines 10
```

기대 로그: `reset_stale_running: 1 jobs returned to pending`.

SQL 확인:
```sql
SELECT id, status, started_at FROM sync_jobs WHERE status = 'pending' ORDER BY created_at DESC LIMIT 5;
```

기대: 방금 만든 잡이 `pending`으로 되돌아옴.

- [ ] **Step 16: cleanup (선택)**

검증용 임시 데이터 정리:

```sql
DELETE FROM brands WHERE name IN ('Plan 4 검증', 'Plan 3 검증');
DELETE FROM vault.secrets WHERE id NOT IN (SELECT secret_id FROM brand_credentials WHERE secret_id IS NOT NULL);
DELETE FROM sync_jobs WHERE created_at < now() - interval '1 day' AND status IN ('completed', 'failed');
```

```sql
SELECT COUNT(*) AS bc FROM brand_credentials;
SELECT COUNT(*) AS vs FROM vault.secrets;
SELECT COUNT(*) AS sj FROM sync_jobs;
```

기대: bc/vs는 검증 후 0, sj는 남아있는 pending 잡 수.

---

## Plan 4 완료 기준 체크리스트

**SQL 마이그레이션 (3)**:
- [ ] `010_vault_read_wrapper.sql` 적용 + RPC 동작 확인
- [ ] `012_sync_job_rpcs.sql` 적용 + 두 RPC 등록
- [ ] `011_pg_cron_jobs.sql` 적용 + 6개 잡 등록

**Vercel 코드 (2)**:
- [ ] `lib/adapters/_types.ts` 인터페이스 확장
- [ ] `lib/adapters/smartstore.ts` + `lib/adapters/naver-ad.ts` validate를 가상서버 경유로

**가상서버 코드 (1)**:
- [ ] `server/sync-worker/` 전체 신규 (worker.js + validate-server.js + lib + ecosystem + package + README)

**배포 (3)**:
- [ ] 가상서버에 rsync + npm install + .env 작성 + PM2 등록
- [ ] Cloudflare Tunnel 라우트 추가 + cloudflared 재시작
- [ ] Vercel 환경변수 추가 + 재배포

**검증 (15 시나리오)**: 전부 통과

---

## Plan 4 이후 — Plan 5/6/7 예고

| Plan | 대상 | 추가 작업 |
|---|---|---|
| Plan 5 | 카페24 | `lib/adapters/cafe24.ts`의 `refreshToken`, `syncOrders`, `syncProducts`, `syncAdUnits` 구현 + brand_credentials.metadata.expires_at 채우기 + 가상서버 `adapters.js`에 카페24 sync 메서드 추가 + 기존 sync.js cron 제거 (팔레오 컷오버) |
| Plan 6 | 스마트스토어 | `lib/adapters/smartstore.ts`의 `syncOrders` + access_token 캐시 패턴 + 가상서버 adapters.js 갱신 |
| Plan 7 | 네이버광고 | `lib/adapters/naver-ad.ts`의 `syncAdStats` + `syncAdUnits` + 가상서버 adapters.js 갱신 + 기존 sync-ad.js cron 제거 |

각 plan은 baseline 인프라가 안정 운영되는 가정 하에 매체별 어댑터 메서드만 구현.

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| pg_cron 활성 안 됨 | Task 1 Step 1 사전 점검 |
| SQL 마이그레이션 순서 오류 (010 → 011 → 012로 실행) | Task 2 Step 4에서 명시적으로 010 → 012 → 011 순서로 안내 |
| 가상서버 SSH 키 / .env 파일 권한 노출 | Task 6 Step 4에서 chmod 600 명시 |
| Cloudflare Tunnel 라우트 매칭 우선순위 (path 더 구체적인 게 위) | Task 6 Step 7에서 명시 |
| Vercel 환경변수 추가 후 캐시 재사용 빌드 → 새 env 미반영 | Task 7 Step 2에서 캐시 해제 강제 |
| 가상서버에 sync-worker 두 인스턴스 실수 실행 — 중복 처리 | FOR UPDATE SKIP LOCKED로 자동 차단. Step 12에서 검증 |
| validate-proxy 외부 노출 — Token 무력화되면 누구나 외부 API 호출 가능 | Token rotation 가능. Vercel + 가상서버 .env 동시 갱신 후 양쪽 재배포/재시작 |
| sync-worker가 service_role 키로 RLS 우회 — 노출 시 위험 | 가상서버 .env 600 권한 + Supabase에서 service_role 키 rotation 가능 |
| Plan 4 시점 어댑터 sync 미구현이라 모든 잡 skip — 검증 의미 약함 | 검증은 인프라 흐름만 확인. 실 sync는 Plan 5+ 검증 |
| 기존 sync.js cron과 새 sync-worker 동시 작동 — 같은 데이터 두 번 처리 | 데이터 upsert는 idempotent. 외부 API 호출 비용 잠시 2배. Plan 5 컷오버에서 해소 |
