# SaaS 전환 — Plan 1: Foundation (부트스트랩 + 스키마 + 인증) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 `order-manager-saas` Next.js 14 레포를 만들고, 기존 Supabase 프로젝트에 멀티테넌트 스키마를 적용하고, 운영자가 초대한 사용자가 로그인 → 빈 브랜드 페이지를 보는 흐름까지 완성한다.

**Architecture:** Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui로 새 레포 부트스트랩. Supabase는 기존 프로젝트(`REACT_APP_SUPABASE_URL`) 재사용. 기존 brands 테이블에 `owner_id` 추가하고 멀티테넌트 RLS로 재배포. Supabase Auth의 `inviteUserByEmail`로 운영자 발급 흐름 구현.

**Tech Stack:** Next.js 14.x (App Router), TypeScript 5.x, Tailwind CSS 3.x, shadcn/ui, @supabase/ssr 0.5+, Supabase Postgres, Vercel.

**Spec:** `docs/superpowers/specs/2026-06-29-order-manager-saas-design.md`

## Global Constraints

- **레포 위치 (로컬)**: `c:\Users\Jangkwon\Desktop\order-manager-saas` (신규 디렉토리)
- **GitHub 레포 이름**: `order-manager-saas`
- **Node.js**: 20.x LTS
- **Next.js**: 14.x (App Router, Server Components 기본)
- **TypeScript**: strict 모드
- **Supabase 프로젝트**: 기존 `order-manager` 프로젝트 재사용 (URL/key 동일)
- **운영자 user_id**: 기존 `andre21382138@gmail.com` 계정의 Supabase auth.users.id (Task 5에서 확인)
- **Plan 작성 시점에 새 레포가 없으므로** 이 plan 파일은 기존 `order-manager` 레포의 `docs/superpowers/plans/`에 두고, Plan 1 완료 후 새 레포로 복사
- **상품/주문/광고 데이터 마이그레이션은 이 Plan에서 다루지 않음** — Plan 2 이후
- **사용하지 않는 테이블 (profiles, brand_managers, notices, notice_comments, cafe24_tokens) DROP은 이 Plan에서 안 함** — Phase F 시점에 별도 plan으로

## File Structure (Plan 1 완료 시점)

```
order-manager-saas/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx                    # 로그인 폼
│   │   └── invite/complete-signup/page.tsx   # 초대 수락 + 비밀번호 설정
│   ├── (dashboard)/
│   │   ├── layout.tsx                        # 보호 레이아웃 + 헤더
│   │   └── brands/page.tsx                   # 빈 브랜드 페이지 (placeholder)
│   ├── auth/callback/route.ts                # Supabase auth 콜백
│   ├── api/auth/signout/route.ts             # 로그아웃 POST
│   ├── layout.tsx                            # 루트 레이아웃
│   ├── page.tsx                              # → /brands or /login redirect
│   └── globals.css
├── components/
│   └── ui/                                   # shadcn 컴포넌트
├── lib/
│   ├── supabase/
│   │   ├── server.ts                         # 서버 컴포넌트용 클라이언트
│   │   ├── client.ts                         # 브라우저 클라이언트
│   │   └── middleware.ts                     # 세션 갱신 헬퍼
│   └── utils.ts                              # shadcn cn() 유틸
├── middleware.ts                             # 인증 미들웨어
├── supabase/
│   └── migrations/                           # SQL 마이그레이션 (수동 실행)
│       ├── 001_brand_credentials.sql
│       ├── 002_channel_products.sql
│       ├── 003_ad_units.sql
│       ├── 004_ad_stats.sql
│       ├── 005_ad_product_mappings.sql
│       ├── 006_sync_jobs.sql
│       ├── 007_brands_owner_id.sql
│       └── 008_rls_policies.sql
├── .env.example
├── .env.local                                # gitignored
├── .gitignore
├── components.json                           # shadcn 설정
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

---

### Task 1: GitHub 레포 + Next.js 부트스트랩

**Files:**
- Create: `order-manager-saas/` 전체 (create-next-app이 생성)

**Interfaces:**
- Produces: 빈 Next.js 14 + TypeScript + Tailwind 프로젝트, GitHub 원격 연결됨

- [ ] **Step 1: GitHub에 새 레포 생성 (수동)**

브라우저에서 https://github.com/new 에 접속 → 다음 입력:

```
Repository name:  order-manager-saas
Description:      Multi-brand e-commerce + ads SaaS (Order Manager 후속)
Visibility:       Private
Initialize with:  README X, .gitignore X, license X (전부 X — 로컬에서 push)
```

[Create repository] 클릭. 생성된 URL 메모 (예: `https://github.com/andre21382138-jpg/order-manager-saas.git`).

- [ ] **Step 2: create-next-app 실행**

PowerShell:
```powershell
cd C:\Users\Jangkwon\Desktop
npx create-next-app@latest order-manager-saas
```

프롬프트 응답:
```
Would you like to use TypeScript?           Yes
Would you like to use ESLint?               Yes
Would you like to use Tailwind CSS?         Yes
Would you like to use `src/` directory?     No
Would you like to use App Router?           Yes
Would you like to customize default import alias? No
```

기대: `C:\Users\Jangkwon\Desktop\order-manager-saas\` 생성됨.

- [ ] **Step 3: 개발 서버 확인**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
npm run dev
```

기대: `http://localhost:3000` 에서 Next.js welcome 페이지 정상 표시. `Ctrl+C`로 종료.

- [ ] **Step 4: GitHub 원격 연결 + 초기 push**

```powershell
git remote add origin https://github.com/<당신의-username>/order-manager-saas.git
git branch -M main
git push -u origin main
```

기대: GitHub에 첫 커밋(create-next-app 자동 커밋) push 됨.

- [ ] **Step 5: README 교체**

`C:\Users\Jangkwon\Desktop\order-manager-saas\README.md` 내용 교체:

```markdown
# Order Manager SaaS

멀티브랜드 쇼핑몰 + 광고 통합 관리 SaaS.

## 스택

- Next.js 14 (App Router) + TypeScript
- Supabase (Postgres + Auth + Vault + pg_cron)
- Tailwind + shadcn/ui
- Vercel

## 디자인 문서

`docs/superpowers/specs/2026-06-29-order-manager-saas-design.md` (기존 order-manager 레포)

## 시작

```bash
npm install
cp .env.example .env.local   # 값 채워넣기
npm run dev
```
```

- [ ] **Step 6: 커밋**

```powershell
git add README.md
git commit -m "docs: README 작성"
git push
```

---

### Task 2: shadcn/ui 초기화 + 핵심 의존성

**Files:**
- Create: `components.json`, `lib/utils.ts`, `components/ui/button.tsx`, `components/ui/input.tsx`, `components/ui/label.tsx`, `components/ui/form.tsx`, `components/ui/card.tsx`
- Modify: `package.json`, `tailwind.config.ts`, `app/globals.css`

**Interfaces:**
- Produces: shadcn `<Button>`, `<Input>`, `<Label>`, `<Form>`, `<Card>` 사용 가능. Supabase SDK 설치됨.

- [ ] **Step 1: shadcn 초기화**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
npx shadcn@latest init
```

프롬프트 응답:
```
Which style would you like to use?       Default
Which color would you like to use as base color?  Neutral
Where is your global CSS file?           app/globals.css
Would you like to use CSS variables for colors?   Yes
Where is your tailwind.config located?   tailwind.config.ts
Configure the import alias for components?  @/components
Configure the import alias for utils?    @/lib/utils
Are you using React Server Components?   Yes
Write configuration to components.json?  Yes
```

기대: `components.json` + `lib/utils.ts` + `app/globals.css` 갱신.

- [ ] **Step 2: 핵심 컴포넌트 추가**

```powershell
npx shadcn@latest add button input label form card
```

기대: `components/ui/` 폴더에 5개 파일 생성.

- [ ] **Step 3: Supabase + 폼 라이브러리 설치**

```powershell
npm install @supabase/supabase-js @supabase/ssr react-hook-form @hookform/resolvers zod
```

기대: `package.json` dependencies에 4개 추가.

- [ ] **Step 4: 빌드 확인**

```powershell
npm run build
```

기대: 빌드 성공. (아직 사용 안 했으므로 warnings만)

- [ ] **Step 5: 커밋**

```powershell
git add .
git commit -m "feat: shadcn/ui 초기화 + Supabase/폼 의존성 추가"
git push
```

---

### Task 3: Supabase 클라이언트 + 미들웨어 + 환경변수

**Files:**
- Create: `.env.example`, `.env.local`, `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`, `middleware.ts`
- Modify: `.gitignore` (`.env.local` 추가 확인)

**Interfaces:**
- Produces:
  - `createServerClient()` — 서버 컴포넌트/액션에서 호출. cookies 자동 처리
  - `createBrowserClient()` — 클라이언트 컴포넌트에서 호출
  - `updateSession(request)` — 미들웨어에서 세션 갱신
  - `middleware.ts`: 모든 페이지 요청에서 세션 갱신 자동 처리

- [ ] **Step 1: `.env.example` 작성**

`C:\Users\Jangkwon\Desktop\order-manager-saas\.env.example`:

```
# Supabase (기존 order-manager 프로젝트 재사용)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# 운영자 식별 (admin 페이지 접근 허용 이메일 목록, 쉼표 구분)
SUPER_ADMIN_EMAILS=andre21382138@gmail.com

# 앱 URL (auth 콜백 등에서 사용)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 2: `.env.local` 작성**

기존 `c:\Users\Jangkwon\Desktop\order-manager\` 에서 Supabase 값을 찾는다. Vercel 대시보드 또는 기존 레포의 Vercel env 동기화로 확인:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPER_ADMIN_EMAILS=andre21382138@gmail.com
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

→ `.env.local` 파일에 위 값 입력.

- [ ] **Step 3: `.gitignore`에 `.env.local` 포함 확인**

`C:\Users\Jangkwon\Desktop\order-manager-saas\.gitignore` 열어서 `.env*.local` 패턴 있는지 확인. create-next-app이 기본으로 포함하지만 한 번 더 확인.

- [ ] **Step 4: `lib/supabase/server.ts` 작성**

```typescript
import { createServerClient as createSupabaseServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createServerClient() {
  const cookieStore = cookies()

  return createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component에서 set 호출 시 무시 (미들웨어가 처리)
          }
        },
      },
    }
  )
}
```

- [ ] **Step 5: `lib/supabase/client.ts` 작성**

```typescript
import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'

export function createBrowserClient() {
  return createSupabaseBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 6: `lib/supabase/middleware.ts` 작성**

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  return { supabaseResponse, user }
}
```

- [ ] **Step 7: `middleware.ts` (루트) 작성**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isAuthPage = pathname.startsWith('/login') ||
                     pathname.startsWith('/invite') ||
                     pathname.startsWith('/auth/callback')

  // 비로그인 + 보호된 경로 → /login
  if (!user && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 로그인 + 로그인/초대 페이지 접근 → /brands
  if (user && (pathname === '/login' || pathname === '/')) {
    return NextResponse.redirect(new URL('/brands', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 8: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없이 빌드 성공.

- [ ] **Step 9: 커밋**

```powershell
git add .
git commit -m "feat: Supabase 클라이언트 + 인증 미들웨어 셋업"
git push
```

---

### Task 4: SQL 마이그레이션 — 신규 테이블 6개

**Files:**
- Create: `supabase/migrations/001_brand_credentials.sql`, `002_channel_products.sql`, `003_ad_units.sql`, `004_ad_stats.sql`, `005_ad_product_mappings.sql`, `006_sync_jobs.sql`

**Interfaces:**
- Produces: 6개 신규 테이블이 기존 Supabase 프로젝트에 존재. 모두 `brand_id` 컬럼 + 적절한 외래키 + UNIQUE 제약 포함.

**중요**: 이 task는 **기존 운영 중인 Supabase 프로젝트에 실제 SQL을 실행**합니다. 무중단 작업 (ADD/CREATE만, DROP 없음)이지만 신중히.

- [ ] **Step 1: `supabase/migrations/` 디렉토리 생성**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
New-Item -ItemType Directory -Path supabase\migrations -Force
```

- [ ] **Step 2: `001_brand_credentials.sql` 작성**

```sql
-- Plan 1 / Task 4 — brand_credentials
-- 매체×브랜드 자격증명 메타. secret_id는 vault.secrets 참조

CREATE TABLE brand_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  channel_account text NOT NULL,
  secret_id uuid,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, channel, channel_account),
  CHECK (status IN ('active', 'expired', 'error'))
);

CREATE INDEX idx_brand_credentials_brand ON brand_credentials(brand_id);
CREATE INDEX idx_brand_credentials_status ON brand_credentials(status);
```

- [ ] **Step 3: `002_channel_products.sql` 작성**

```sql
-- Plan 1 / Task 4 — channel_products
-- 매체별 상품 그대로 저장. alias로 통합 표시명 지정 가능

CREATE TABLE channel_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  channel_account text NOT NULL,
  external_product_id text NOT NULL,
  external_product_name text,
  thumbnail_url text,
  alias text,
  metadata jsonb DEFAULT '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, channel, channel_account, external_product_id)
);

CREATE INDEX idx_channel_products_brand ON channel_products(brand_id);
CREATE INDEX idx_channel_products_alias ON channel_products(brand_id, alias) WHERE alias IS NOT NULL;
CREATE INDEX idx_channel_products_name_search ON channel_products USING gin (to_tsvector('simple', coalesce(external_product_name, '') || ' ' || coalesce(alias, '')));
```

- [ ] **Step 4: `003_ad_units.sql` 작성**

```sql
-- Plan 1 / Task 4 — ad_units
-- 광고 단위 통합 (campaign / ad_group / keyword / creative)

CREATE TABLE ad_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  channel_account text NOT NULL,
  external_id text NOT NULL,
  external_name text,
  level text NOT NULL,
  parent_id uuid REFERENCES ad_units(id) ON DELETE CASCADE,
  metadata jsonb DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, channel, external_id),
  CHECK (level IN ('campaign', 'ad_group', 'keyword', 'creative'))
);

CREATE INDEX idx_ad_units_brand_level ON ad_units(brand_id, level);
CREATE INDEX idx_ad_units_parent ON ad_units(parent_id);
```

- [ ] **Step 5: `004_ad_stats.sql` 작성**

```sql
-- Plan 1 / Task 4 — ad_stats
-- 일별 광고 통계 (모든 레벨)

CREATE TABLE ad_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  ad_unit_id uuid REFERENCES ad_units(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  impressions int NOT NULL DEFAULT 0,
  clicks int NOT NULL DEFAULT 0,
  cost numeric(14,2) NOT NULL DEFAULT 0,
  conversions int NOT NULL DEFAULT 0,
  conversion_revenue numeric(14,2) NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ad_unit_id, date)
);

CREATE INDEX idx_ad_stats_brand_date ON ad_stats(brand_id, date);
```

- [ ] **Step 6: `005_ad_product_mappings.sql` 작성**

```sql
-- Plan 1 / Task 4 — ad_product_mappings
-- 광고 ↔ 채널 상품 수동 매핑 (다대다)

CREATE TABLE ad_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  ad_unit_id uuid REFERENCES ad_units(id) ON DELETE CASCADE NOT NULL,
  channel_product_id uuid REFERENCES channel_products(id) ON DELETE CASCADE NOT NULL,
  weight numeric(5,2) NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ad_unit_id, channel_product_id),
  CHECK (weight > 0)
);

CREATE INDEX idx_ad_product_mappings_brand ON ad_product_mappings(brand_id);
CREATE INDEX idx_ad_product_mappings_ad_unit ON ad_product_mappings(ad_unit_id);
CREATE INDEX idx_ad_product_mappings_product ON ad_product_mappings(channel_product_id);
```

- [ ] **Step 7: `006_sync_jobs.sql` 작성**

```sql
-- Plan 1 / Task 4 — sync_jobs
-- 동기화 잡 큐 — pg_cron이 INSERT, 카페24 서버 워커가 폴링·실행

CREATE TABLE sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  credential_id uuid REFERENCES brand_credentials(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  date_range_start date,
  date_range_end date,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  retry_count int NOT NULL DEFAULT 0,
  error_message text,
  result_summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  CHECK (job_type IN ('orders', 'ad_stats', 'products', 'ad_units', 'token_refresh'))
);

CREATE INDEX idx_sync_jobs_pending ON sync_jobs(status, scheduled_at) WHERE status IN ('pending', 'running');
CREATE INDEX idx_sync_jobs_brand ON sync_jobs(brand_id, created_at DESC);
```

- [ ] **Step 8: Supabase SQL Editor에서 6개 마이그레이션 순차 실행**

브라우저에서 Supabase 대시보드 → 기존 `order-manager` 프로젝트 → SQL Editor 열기.

각 파일 내용을 차례로 복사 → 실행:
1. `001_brand_credentials.sql` 실행 → Success 확인
2. `002_channel_products.sql` 실행 → Success 확인
3. `003_ad_units.sql` 실행 → Success 확인
4. `004_ad_stats.sql` 실행 → Success 확인
5. `005_ad_product_mappings.sql` 실행 → Success 확인
6. `006_sync_jobs.sql` 실행 → Success 확인

- [ ] **Step 9: 검증 쿼리 실행**

Supabase SQL Editor에서:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'brand_credentials', 'channel_products', 'ad_units',
    'ad_stats', 'ad_product_mappings', 'sync_jobs'
  )
ORDER BY table_name;
```

기대: 6개 행 반환. (`ad_product_mappings`, `ad_stats`, `ad_units`, `brand_credentials`, `channel_products`, `sync_jobs`)

- [ ] **Step 10: 커밋**

```powershell
git add supabase/
git commit -m "feat(db): 신규 테이블 6개 마이그레이션 (brand_credentials/channel_products/ad_units/ad_stats/ad_product_mappings/sync_jobs)"
git push
```

---

### Task 5: SQL 마이그레이션 — `brands.owner_id` 추가

**Files:**
- Create: `supabase/migrations/007_brands_owner_id.sql`

**Interfaces:**
- Produces: `brands.owner_id` 컬럼 (NOT NULL, `auth.users(id)` 참조). 기존 모든 brands는 운영자(Kwon) user_id로 채워짐.

- [ ] **Step 1: 운영자 user_id 확인**

Supabase SQL Editor:

```sql
SELECT id, email FROM auth.users WHERE email = 'andre21382138@gmail.com';
```

결과의 `id` 값(UUID)을 메모. 이를 `<OPERATOR_UUID>`라고 부른다.

기대: 1개 행 반환. id 형태 예: `12345678-1234-1234-1234-123456789abc`.

만약 0개 반환이면: 해당 이메일로 Supabase Auth에 가입된 계정이 없는 것 → 먼저 Supabase 대시보드에서 Authentication → Users → "Add user" → email 입력 + password 설정 → 다시 위 쿼리 실행.

- [ ] **Step 2: `007_brands_owner_id.sql` 작성**

`supabase/migrations/007_brands_owner_id.sql`:

```sql
-- Plan 1 / Task 5 — brands.owner_id 추가
-- 멀티테넌트 격리 키. 기존 brands는 운영자 user_id로 일괄 채움.
-- 실행 전 <OPERATOR_UUID>를 실제 UUID로 치환할 것.

-- Step 1: 컬럼 추가 (nullable 임시)
ALTER TABLE brands ADD COLUMN owner_id uuid REFERENCES auth.users(id);

-- Step 2: 기존 행 채우기 (운영자 UUID로 치환)
UPDATE brands SET owner_id = '<OPERATOR_UUID>'::uuid WHERE owner_id IS NULL;

-- Step 3: NOT NULL 강제
ALTER TABLE brands ALTER COLUMN owner_id SET NOT NULL;

-- Step 4: 인덱스
CREATE INDEX idx_brands_owner ON brands(owner_id);
```

- [ ] **Step 3: 마이그레이션 SQL의 `<OPERATOR_UUID>` 치환 + 실행**

Supabase SQL Editor에서 위 SQL의 `<OPERATOR_UUID>`를 Step 1에서 확인한 실제 UUID로 치환한 후 한 번에 실행.

기대: Success. 에러 없음.

- [ ] **Step 4: 검증 쿼리**

```sql
SELECT id, name, owner_id FROM brands;
```

기대: 기존 brands(팔레오·코코엘·아프리모 등) 모두 `owner_id`가 동일한 운영자 UUID로 채워져 있음. NULL 없음.

- [ ] **Step 5: 커밋**

```powershell
git add supabase/migrations/007_brands_owner_id.sql
git commit -m "feat(db): brands.owner_id 추가 + 기존 brands 운영자 owner로 채움"
git push
```

> **주의**: 커밋된 파일에는 `<OPERATOR_UUID>` placeholder가 남아있다. 실제 실행 SQL은 Supabase에 적용되었으므로 OK. 파일을 다시 실행하면 안 됨.

---

### Task 6: SQL 마이그레이션 — RLS 정책 재배포

**Files:**
- Create: `supabase/migrations/008_rls_policies.sql`

**Interfaces:**
- Produces: `brands` + 6개 신규 테이블 + 기존 데이터 테이블(`orders`, `order_items`, `product_category_map`, `catalog_products`, `naver_ad_stats`)에 `owner_id` 기반 RLS 정책 적용. 비인증 또는 다른 사용자는 데이터 못 봄.

**중요**: 이 task는 **운영 중인 시스템에 일시 영향**을 줄 수 있다. 새벽(03시) 시간대 진행 권장. 단 ADD POLICY는 무중단 — 영향은 기존 정책 DROP 시점 수십 초.

- [ ] **Step 1: 기존 정책 확인**

Supabase SQL Editor:

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

기대: 기존 부서 기반 정책들이 나열됨. 이 결과를 메모 (롤백 대비).

- [ ] **Step 2: `008_rls_policies.sql` 작성**

```sql
-- Plan 1 / Task 6 — RLS 정책 재배포
-- 기존 부서 기반 정책 → owner_id 기반으로 전환

-- ============================================================
-- Step 1: RLS 활성화 (이미 켜져 있는 테이블도 idempotent)
-- ============================================================
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_category_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE naver_ad_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Step 2: 기존 정책 모두 DROP (다음 블록에서 새로 만듦)
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'brands', 'orders', 'order_items', 'product_category_map',
        'catalog_products', 'naver_ad_stats', 'brand_credentials',
        'channel_products', 'ad_units', 'ad_stats',
        'ad_product_mappings', 'sync_jobs'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ============================================================
-- Step 3: brands — 본인 소유만
-- ============================================================
CREATE POLICY brands_owner ON brands
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- Step 4: 자식 테이블 — brand_id로 owner 검증
-- ============================================================

-- orders
CREATE POLICY orders_owner ON orders
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = orders.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = orders.brand_id AND brands.owner_id = auth.uid()));

-- order_items
CREATE POLICY order_items_owner ON order_items
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM orders
    JOIN brands ON brands.id = orders.brand_id
    WHERE orders.id = order_items.order_id AND brands.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders
    JOIN brands ON brands.id = orders.brand_id
    WHERE orders.id = order_items.order_id AND brands.owner_id = auth.uid()
  ));

-- product_category_map
CREATE POLICY product_category_map_owner ON product_category_map
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = product_category_map.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = product_category_map.brand_id AND brands.owner_id = auth.uid()));

-- catalog_products
CREATE POLICY catalog_products_owner ON catalog_products
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = catalog_products.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = catalog_products.brand_id AND brands.owner_id = auth.uid()));

-- naver_ad_stats
CREATE POLICY naver_ad_stats_owner ON naver_ad_stats
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = naver_ad_stats.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = naver_ad_stats.brand_id AND brands.owner_id = auth.uid()));

-- brand_credentials
CREATE POLICY brand_credentials_owner ON brand_credentials
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = brand_credentials.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = brand_credentials.brand_id AND brands.owner_id = auth.uid()));

-- channel_products
CREATE POLICY channel_products_owner ON channel_products
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = channel_products.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = channel_products.brand_id AND brands.owner_id = auth.uid()));

-- ad_units
CREATE POLICY ad_units_owner ON ad_units
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = ad_units.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = ad_units.brand_id AND brands.owner_id = auth.uid()));

-- ad_stats
CREATE POLICY ad_stats_owner ON ad_stats
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = ad_stats.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = ad_stats.brand_id AND brands.owner_id = auth.uid()));

-- ad_product_mappings
CREATE POLICY ad_product_mappings_owner ON ad_product_mappings
  FOR ALL
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = ad_product_mappings.brand_id AND brands.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM brands WHERE brands.id = ad_product_mappings.brand_id AND brands.owner_id = auth.uid()));

-- sync_jobs (사용자는 자기 brands 잡만 조회 가능. INSERT는 service_role/pg_cron만)
CREATE POLICY sync_jobs_owner_select ON sync_jobs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM brands WHERE brands.id = sync_jobs.brand_id AND brands.owner_id = auth.uid()));
```

- [ ] **Step 3: Supabase SQL Editor에서 실행 (새벽 03시 권장)**

전체 SQL을 한 번에 실행. 트랜잭션으로 묶이지 않으므로 부분 실패 가능 — 실패 시 어디서 멈췄는지 확인 후 그 부분만 재실행.

기대: 전체 Success. 영향 시간 < 1분.

- [ ] **Step 4: 검증 — 정책 목록 확인**

```sql
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

기대: 12개 테이블 각각 `<table>_owner` 정책 (sync_jobs는 `sync_jobs_owner_select`) 표시.

- [ ] **Step 5: 검증 — 격리 동작 확인 (수동)**

Supabase 대시보드 → Authentication → 임시 테스트 계정 1개 추가 (예: `test@example.com`). 해당 사용자로 로그인한 클라이언트에서 다음 쿼리:

```sql
SELECT * FROM brands;
```

기대: 0개 행 반환 (그 사용자가 owner인 브랜드가 없으므로). 운영자 계정으로 같은 쿼리하면 기존 brands 모두 보임.

(이 단계 검증은 Task 7 로그인 페이지 완료 후 다시 확인 가능)

- [ ] **Step 6: 커밋**

```powershell
git add supabase/migrations/008_rls_policies.sql
git commit -m "feat(db): RLS 정책 owner_id 기반으로 재배포"
git push
```

---

### Task 7: 로그인 페이지 + auth 콜백

**Files:**
- Create: `app/(auth)/login/page.tsx`, `app/auth/callback/route.ts`, `app/page.tsx`

**Interfaces:**
- Consumes: `createServerClient()`, `createBrowserClient()` (Task 3)
- Produces:
  - `/login` 페이지에서 email/password로 로그인 → 성공 시 `/brands`로 리다이렉트
  - `/auth/callback` — Supabase가 보내는 모든 콜백 (invite, password reset, OAuth) 일괄 처리
  - `/` → 로그인 상태에 따라 `/brands` 또는 `/login`으로 리다이렉트

- [ ] **Step 1: `app/(auth)/login/page.tsx` 작성**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }
    router.push('/brands')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>로그인</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: `app/auth/callback/route.ts` 작성**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/brands'
  const type = searchParams.get('type')

  if (code) {
    const supabase = createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // 초대(invite) 흐름이면 비밀번호 설정 페이지로
      if (type === 'invite' || type === 'recovery') {
        return NextResponse.redirect(`${origin}/invite/complete-signup`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
```

- [ ] **Step 3: `app/page.tsx` 수정**

```tsx
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  redirect(user ? '/brands' : '/login')
}
```

- [ ] **Step 4: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없이 빌드 성공.

- [ ] **Step 5: 로컬 수동 테스트**

```powershell
npm run dev
```

브라우저에서 `http://localhost:3000` → 자동 `/login`으로 리다이렉트 확인.

운영자 계정으로 로그인 시도:
- 이메일: `andre21382138@gmail.com`
- 비밀번호: (기존 Supabase 비밀번호)

성공 시: `/brands` 경로로 이동 (현재는 404 — Task 9에서 페이지 생성)

`Ctrl+C`로 dev 서버 종료.

- [ ] **Step 6: 커밋**

```powershell
git add .
git commit -m "feat(auth): 로그인 페이지 + auth 콜백 라우트"
git push
```

---

### Task 8: 초대 수락 (비밀번호 설정) 페이지

**Files:**
- Create: `app/(auth)/invite/complete-signup/page.tsx`

**Interfaces:**
- Consumes: `createBrowserClient()` (Task 3), Supabase Auth 세션 (Task 7 callback이 설정)
- Produces: 초대받은 사용자가 비밀번호 설정 → 자동 `/brands`로 이동

- [ ] **Step 1: `app/(auth)/invite/complete-signup/page.tsx` 작성**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function CompleteSignupPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace('/login?error=invite_expired')
        return
      }
      setCheckingSession(false)
    })()
  }, [router, supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }
    router.push('/brands')
    router.refresh()
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">초대 확인 중...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>비밀번호 설정</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">새 비밀번호 (8자 이상)</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-confirm">비밀번호 확인</Label>
              <Input
                id="password-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '설정 중...' : '비밀번호 설정 후 시작'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음.

- [ ] **Step 3: 초대 흐름 수동 테스트**

Supabase 대시보드 → Authentication → Users → "Add user" → "Send invitation"
- Email: `test@example.com` (또는 본인 다른 이메일)
- Auto Confirm User: 체크 X

→ 초대 이메일 받음 → 링크 클릭 → 브라우저 자동으로 `https://<your-domain>/auth/callback?code=...&type=invite` 진입.

하지만 로컬 개발에서는 Supabase 콜백 URL이 `http://localhost:3000/auth/callback` 으로 설정되어 있어야 함:

- Supabase 대시보드 → Authentication → URL Configuration
- "Site URL": `http://localhost:3000` (개발용. 배포 후엔 프로덕션 URL로 변경)
- "Redirect URLs":
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/auth/callback?next=/brands`

설정 저장 후 다시 초대 이메일에서 링크 클릭. 

기대 흐름:
1. `http://localhost:3000/auth/callback?code=...` 접근
2. 자동으로 `/invite/complete-signup`으로 리다이렉트
3. 비밀번호 입력 폼 표시
4. 입력 + 제출 → `/brands`로 이동 (현재 404)

`Ctrl+C`로 dev 서버 종료.

- [ ] **Step 4: 커밋**

```powershell
git add .
git commit -m "feat(auth): 초대 수락 + 비밀번호 설정 페이지"
git push
```

---

### Task 9: 보호된 레이아웃 + 빈 브랜드 페이지 + 로그아웃

**Files:**
- Create: `app/(dashboard)/layout.tsx`, `app/(dashboard)/brands/page.tsx`, `app/api/auth/signout/route.ts`, `components/header.tsx`

**Interfaces:**
- Consumes: `createServerClient()` (Task 3), 인증 미들웨어 (Task 3)
- Produces:
  - `/brands` 페이지: 로그인 사용자가 보는 빈 상태 ("브랜드를 추가하세요")
  - 헤더에 사용자 이메일 + 로그아웃 버튼
  - `POST /api/auth/signout` — 로그아웃 + `/login` 리다이렉트

- [ ] **Step 1: `components/header.tsx` 작성**

```tsx
import { createServerClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'

export async function Header() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="font-bold">Order Manager SaaS</div>
        <div className="flex items-center gap-3 text-sm">
          {user && <span className="text-muted-foreground">{user.email}</span>}
          <form action="/api/auth/signout" method="post">
            <Button type="submit" variant="outline" size="sm">로그아웃</Button>
          </form>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: `app/(dashboard)/layout.tsx` 작성**

```tsx
import { Header } from '@/components/header'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: `app/(dashboard)/brands/page.tsx` 작성**

```tsx
import { createServerClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default async function BrandsPage() {
  const supabase = createServerClient()
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, color')
    .order('created_at', { ascending: false })

  if (!brands || brands.length === 0) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-8 text-center">
          <h2 className="text-lg font-semibold">브랜드가 없습니다</h2>
          <p className="text-sm text-muted-foreground">
            첫 브랜드를 추가하면 매체 연동과 데이터 수집을 시작할 수 있습니다.
          </p>
          <Button disabled>+ 브랜드 추가 (Plan 2에서 활성화)</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">브랜드</h1>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {brands.map((brand) => (
          <li key={brand.id}>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: brand.color ?? '#94a3b8' }}
                  />
                  <span className="font-semibold">{brand.name}</span>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: `app/api/auth/signout/route.ts` 작성**

```typescript
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = createServerClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
```

- [ ] **Step 5: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음. 빌드 성공.

- [ ] **Step 6: 전체 흐름 수동 검증**

```powershell
npm run dev
```

검증 시나리오 1 — 운영자 로그인 (기존 brands 표시):
1. `http://localhost:3000` 접속 → 자동 `/login` 리다이렉트
2. 운영자 계정(`andre21382138@gmail.com`) 로그인
3. `/brands`로 이동 → 기존 브랜드들(팔레오·코코엘·아프리모) 카드로 표시됨 (운영자가 owner이므로)
4. 헤더에 이메일 표시, [로그아웃] 버튼 클릭 → `/login`으로 돌아옴

검증 시나리오 2 — 초대받은 신규 사용자 (빈 상태):
1. Supabase 대시보드에서 신규 테스트 계정 초대
2. 이메일 링크 클릭 → 비밀번호 설정 폼
3. 비밀번호 입력 → `/brands`로 이동
4. **"브랜드가 없습니다" 빈 상태가 표시됨** (이 사용자가 owner인 브랜드 없으므로 RLS로 가려짐)
5. 로그아웃

검증 시나리오 3 — 미인증 접근 차단:
1. 로그아웃 상태에서 `http://localhost:3000/brands` 직접 입력
2. 자동으로 `/login`으로 리다이렉트

세 시나리오 모두 통과해야 함. 실패 시 어느 단계인지 확인 후 디버깅.

`Ctrl+C`로 dev 서버 종료.

- [ ] **Step 7: 커밋**

```powershell
git add .
git commit -m "feat(dashboard): 보호된 레이아웃 + 빈 브랜드 페이지 + 로그아웃"
git push
```

---

### Task 10: Vercel 배포 + 환경변수 + 콜백 URL 설정

**Files:**
- 외부 설정만 (Vercel 대시보드 + Supabase 대시보드)

**Interfaces:**
- Produces: 프로덕션 URL에서 동일한 흐름 동작. Supabase 콜백 URL이 프로덕션 + 로컬 둘 다 허용.

- [ ] **Step 1: Vercel에서 새 프로젝트 임포트**

Vercel 대시보드 → "Add New..." → "Project" → GitHub `order-manager-saas` 레포 선택 → Import.

설정 확인:
- Framework Preset: **Next.js** (자동 인식)
- Root Directory: `./`
- Build Command: 기본
- Output Directory: 기본

- [ ] **Step 2: Vercel 환경변수 등록**

Vercel 프로젝트 → Settings → Environment Variables.

다음 4개 변수를 **Production + Preview + Development** 모두에 등록:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPER_ADMIN_EMAILS=andre21382138@gmail.com
```

`NEXT_PUBLIC_APP_URL`은 Production은 Vercel 자동 도메인 (예: `https://order-manager-saas.vercel.app`), Preview는 비워둠.

- [ ] **Step 3: 첫 배포**

자동으로 첫 빌드 시작. Vercel 대시보드에서 빌드 로그 확인.

기대: 빌드 성공 후 `https://order-manager-saas.vercel.app` (또는 유사 URL) 에서 접속 가능.

- [ ] **Step 4: Supabase 콜백 URL에 프로덕션 추가**

Supabase 대시보드 → Authentication → URL Configuration:

- "Site URL": `https://order-manager-saas.vercel.app` (프로덕션)
- "Redirect URLs" (여러 개 가능):
  - `http://localhost:3000/auth/callback`
  - `https://order-manager-saas.vercel.app/auth/callback`

저장.

- [ ] **Step 5: 프로덕션 수동 검증**

브라우저에서 `https://order-manager-saas.vercel.app` 접속 → 로그인 → `/brands` 표시 확인. Task 9의 세 시나리오 모두 프로덕션에서도 동작 확인.

- [ ] **Step 6: 커밋 (배포 메모)**

배포 정보는 코드 변경이 없어 커밋 없음. 단, 다음 plan을 위한 메모로 README 갱신:

`README.md`에 다음 섹션 추가:

```markdown

## 배포

- **Production**: https://order-manager-saas.vercel.app
- **Supabase**: 기존 `order-manager` 프로젝트 재사용
- **GitHub Actions**: 미설정 (Vercel auto-deploy로 충분)
```

```powershell
git add README.md
git commit -m "docs: 배포 URL README 추가"
git push
```

---

## Plan 1 완료 기준 체크리스트

- [ ] 새 GitHub 레포 `order-manager-saas` 존재 + 코드 push됨
- [ ] Vercel 프로덕션 배포 동작 (`https://order-manager-saas.vercel.app`)
- [ ] Supabase에 신규 테이블 6개 (`brand_credentials`, `channel_products`, `ad_units`, `ad_stats`, `ad_product_mappings`, `sync_jobs`) 존재
- [ ] `brands.owner_id` 컬럼 추가됨 + 기존 brands 운영자 owner로 채워짐
- [ ] RLS 정책이 `owner_id` 기반으로 재배포됨 (12개 테이블)
- [ ] 운영자 로그인 → 기존 brands(팔레오·코코엘·아프리모) 보임
- [ ] 신규 초대 사용자 로그인 → 빈 brands 페이지 보임 (RLS 동작 확인)
- [ ] 로그아웃 동작
- [ ] 미인증 접근 시 `/login` 리다이렉트

## Plan 1 이후 — Plan 2 준비

Plan 1 완료 후 즉시 진행 가능한 것:
- 카페24 가상서버(`server/`) 디렉토리를 새 레포로 복사 (Plan 3에서 본격 사용)
- 기존 `order-manager` 레포는 **그대로 운영** (안전망)
- 베타 컷오버는 Plan 5/6 이후

Plan 2에서 다룰 것:
- 브랜드 CRUD UI (목록·추가·수정·삭제)
- 매체 연동 UI (카페24 OAuth, 스마트스토어/네이버광고 키 입력 폼)
- Supabase Vault에 자격증명 저장
- 자격증명 즉시 검증

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| Task 6 RLS 재배포 중 운영 시스템 잠시 영향 | 새벽 03시 진행. DROP/CREATE 사이 영향 < 1분 |
| `<OPERATOR_UUID>` 치환 누락 후 SQL 실행 | Task 5 Step 2의 placeholder를 반드시 치환. 안 하면 NULL 채워져서 NOT NULL 제약 실패 → 즉시 에러로 인지 가능 |
| Supabase 콜백 URL 누락 → 초대 링크 깨짐 | Task 8 Step 3 + Task 10 Step 4에서 명시적으로 추가 |
| `.env.local` 실수로 commit | create-next-app 기본 `.gitignore`에 포함. Task 3 Step 3에서 확인 |
| Vercel 빌드 실패 (의존성 누락) | 각 Task의 `npm run build` 단계에서 사전 발견 |
