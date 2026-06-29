# Plan 2 — 브랜드 CRUD + 카페24 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1 인프라 위에서, 사용자가 자기 손으로 브랜드를 만들고 카페24 mall을 OAuth로 연결해서 자격증명이 Supabase Vault에 저장되고 즉시 유효성이 확인되는 흐름까지 구축한다.

**Architecture:** Next.js 14 App Router(Plan 1 셋업) + Vercel API routes로 OAuth start/callback 처리. service_role 클라이언트가 Vault `create_secret` RPC와 `brand_credentials` INSERT 담당. 어댑터 패턴(`ChannelAdapter`)으로 cafe24 한정 구현, Plan 3에서 스마트스토어/네이버광고 어댑터 추가만으로 UI 자동 활성. CSRF 보호는 `jose` HS256 서명 쿠키로 OAuth 시작·콜백 사이 상태 보관(5분 만료).

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Tailwind v4, shadcn/ui (dropdown-menu 추가), `@supabase/ssr` + `@supabase/supabase-js` (service_role), `jose` (signed cookie), Supabase Vault(pgsodium).

**Spec:** `docs/superpowers/specs/2026-06-29-plan2-brand-cafe24-design.md`

## Global Constraints

- **레포 위치 (로컬)**: `C:\Users\Jangkwon\Desktop\order-manager-saas`
- **GitHub 레포**: `andre21382138-jpg/order-manager-saas`
- **Production URL**: `https://order-manager-saas-bay.vercel.app`
- **Supabase 프로젝트**: 기존 `order-manager` 재사용 (Plan 1과 동일)
- **운영자 user_id**: `4bfab62c-f8b7-4c07-b170-70485e4a6266` (`ssakwon@kbh.kr`)
- **카페24 OAuth scope**: `mall.read_order,mall.write_order,mall.read_analytics,mall.read_product,mall.read_category`
- **카페24 API version 헤더**: `X-Cafe24-Api-Version: 2025-12-01`
- **카페24 token endpoint**: `POST https://{mallId}.cafe24api.com/api/v2/oauth/token`
- **카페24 authorize endpoint**: `https://{mallId}.cafe24api.com/api/v2/oauth/authorize`
- **카페24 store endpoint (validate용)**: `GET https://{mallId}.cafe24api.com/api/v2/admin/store`
- **redirect_uri**: `${NEXT_PUBLIC_APP_URL}/auth/cafe24/callback`
- **DB 마이그레이션 추가 없음** — Plan 1에서 생성한 `brand_credentials` 테이블에 INSERT/SELECT만
- **자동 테스트 인프라 없음** — 빌드 통과 + 운영자 수동 검증으로 진행
- **TypeScript strict 유지** — 빌드 시 `any` 사용 금지 (기존 Plan 1 코드와 동일)

## File Structure (Plan 2 완료 시점)

```
order-manager-saas/
├── app/
│   ├── (auth)/...                              # Plan 1 그대로
│   ├── (dashboard)/
│   │   ├── layout.tsx                          # 헤더 변경 (브랜드 스위처 추가)
│   │   ├── brands/
│   │   │   ├── page.tsx                        # ★ 카드 UI 강화 (색상 점 + 클릭 이동)
│   │   │   ├── new/page.tsx                    # ★ 브랜드 추가 폼
│   │   │   └── [brandId]/
│   │   │       ├── page.tsx                    # ★ 브랜드 홈 placeholder
│   │   │       └── settings/
│   │   │           └── connections/
│   │   │               ├── page.tsx            # ★ 매체 연동 메인
│   │   │               └── cafe24/
│   │   │                   └── new/page.tsx    # ★ 카페24 자격증명 입력 폼
│   ├── auth/
│   │   ├── callback/route.ts                   # Plan 1 그대로 (Supabase 인증)
│   │   └── cafe24/
│   │       └── callback/route.ts               # ★ 카페24 OAuth 콜백
│   ├── api/
│   │   ├── auth/signout/route.ts               # Plan 1 그대로
│   │   ├── brands/route.ts                     # ★ POST 브랜드 생성
│   │   ├── oauth/
│   │   │   └── cafe24/
│   │   │       └── start/route.ts              # ★ OAuth 시작
│   │   └── credentials/
│   │       └── [credentialId]/route.ts         # ★ DELETE 자격증명 해제
│   ├── layout.tsx                              # Plan 1 그대로
│   └── page.tsx                                # Plan 1 그대로
├── components/
│   ├── ui/                                     # shadcn — dropdown-menu 추가
│   ├── header.tsx                              # ★ 변경 — 스위처 통합
│   └── brand-switcher.tsx                      # ★ 신규
├── lib/
│   ├── supabase/
│   │   ├── server.ts                           # Plan 1 그대로
│   │   ├── client.ts                           # Plan 1 그대로
│   │   ├── middleware.ts                       # Plan 1 그대로
│   │   └── admin.ts                            # ★ 신규 — service_role 클라이언트
│   ├── adapters/
│   │   ├── _types.ts                           # ★ 신규 — ChannelAdapter 인터페이스
│   │   ├── _registry.ts                        # ★ 신규 — channel → adapter
│   │   └── cafe24.ts                           # ★ 신규 — 카페24 어댑터
│   ├── brand-colors.ts                         # ★ 신규 — 색상 팔레트
│   ├── oauth-cookie.ts                         # ★ 신규 — JWT signed cookie helper
│   └── utils.ts                                # Plan 1 그대로
├── proxy.ts                                    # Plan 1 그대로
├── package.json                                # ★ jose, dropdown-menu 추가
├── .env.example                                # ★ OAUTH_COOKIE_SECRET 추가
├── .env.local                                  # ★ OAUTH_COOKIE_SECRET 채움 (gitignored)
└── ...                                         # 그 외 Plan 1 그대로
```

---

### Task 1: 사전 점검 + 의존성 추가 + OAUTH_COOKIE_SECRET

**Files:**
- Modify: `package.json` (jose 추가, shadcn dropdown-menu)
- Modify: `.env.example`, `.env.local`

**Interfaces:**
- Produces:
  - `jose` 라이브러리 설치 — JWT 서명/검증
  - shadcn `dropdown-menu` 컴포넌트 — 브랜드 스위처에서 사용
  - 환경변수 `OAUTH_COOKIE_SECRET` — 32바이트 base64. Plan 2의 모든 OAuth 쿠키 서명 키

- [ ] **Step 1: Supabase Vault extension 활성 확인**

브라우저에서 Supabase 대시보드 → 기존 `order-manager` 프로젝트 → **Database** → **Extensions** → 검색창에 `vault` 입력.

상태가 `Enabled`인지 확인. **Disabled**라면 토글 클릭 → `Enable extension`.

검증 쿼리 — SQL Editor에서:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgsodium','vault');
```

기대: 2개 행 반환 (`pgsodium`, `vault`).

`vault` 확장이 활성되면 `vault.secrets` 테이블 + `vault.decrypted_secrets` view + `vault.create_secret()`/`vault.update_secret()` 함수가 자동 생성됨.

- [ ] **Step 2: 새 의존성 설치 (jose)**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
npm install jose
```

기대: `package.json` dependencies에 `jose` 추가.

- [ ] **Step 3: shadcn dropdown-menu 컴포넌트 추가**

```powershell
npx shadcn@latest add dropdown-menu
```

기대: `components/ui/dropdown-menu.tsx` 생성.

- [ ] **Step 4: OAUTH_COOKIE_SECRET 값 생성**

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

출력된 base64 문자열(약 44자) 메모. 예: `aB7cD...K9fG=`.

- [ ] **Step 5: `.env.example` 갱신**

`C:\Users\Jangkwon\Desktop\order-manager-saas\.env.example` 끝에 추가:

```
# OAuth state 쿠키 서명 키 (32바이트 base64)
# 생성: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
OAUTH_COOKIE_SECRET=
```

- [ ] **Step 6: `.env.local`에 실제 값 채움**

`C:\Users\Jangkwon\Desktop\order-manager-saas\.env.local`에 같은 라인 추가하되 Step 4에서 생성한 값을 채움:

```
OAUTH_COOKIE_SECRET=aB7cD...K9fG=
```

- [ ] **Step 7: 빌드 확인**

```powershell
npm run build
```

기대: 빌드 성공. 새 의존성/컴포넌트가 컴파일 통과.

- [ ] **Step 8: 커밋**

```powershell
git add package.json package-lock.json components/ui/dropdown-menu.tsx .env.example
git commit -m "chore(deps): jose + shadcn dropdown-menu + OAUTH_COOKIE_SECRET 환경변수 추가"
git push
```

> `.env.local`은 gitignored. 커밋 안 됨.

---

### Task 2: service_role admin 클라이언트

**Files:**
- Create: `lib/supabase/admin.ts`

**Interfaces:**
- Produces:
  - `createAdminClient()` — RLS bypass + Vault 접근 가능한 클라이언트. **서버 사이드 전용**. import 시점에 `server-only`로 클라이언트 번들 유입 차단

- [ ] **Step 1: `lib/supabase/admin.ts` 작성**

```typescript
import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}
```

> 첫 줄의 `import 'server-only'`가 핵심 가드레일. 클라이언트 컴포넌트에서 이 모듈을 import하면 Next.js가 빌드 단계에서 차단.

- [ ] **Step 2: server-only 패키지 설치 확인**

`server-only` 패키지는 Next.js 13+ 자동 포함이지만 명시적으로 깔자:

```powershell
npm install server-only
```

기대: 이미 깔려있다면 무변경. 새로 깔리면 dependencies에 추가.

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없이 통과. admin.ts는 아직 호출 안 되므로 dead code 경고 정도만.

- [ ] **Step 4: 커밋**

```powershell
git add lib/supabase/admin.ts package.json package-lock.json
git commit -m "feat: service_role admin Supabase 클라이언트 (server-only)"
git push
```

---

### Task 3: 어댑터 인터페이스 + cafe24 어댑터 + registry

**Files:**
- Create: `lib/adapters/_types.ts`
- Create: `lib/adapters/cafe24.ts`
- Create: `lib/adapters/_registry.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `ChannelAdapter` 인터페이스 — Plan 3에서 smartstore/naver_ad가 같은 모양으로 구현
  - `Channel`, `CredentialPayload` 타입
  - `cafe24Adapter` — getAuthUrl / handleCallback / validate 3개 메서드 구현
  - `getAdapter(channel)` — registry 함수

- [ ] **Step 1: `lib/adapters/_types.ts` 작성**

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

export interface ChannelAdapter {
  channel: Channel
  category: 'shop' | 'ad'
  authType: AuthType

  // OAuth 매체 (cafe24)
  getAuthUrl?(input: GetAuthUrlInput): string
  handleCallback?(input: HandleCallbackInput): Promise<CredentialPayload>

  // API 키 매체 (Plan 3+)
  credentialFields?: { key: string; label: string; secret?: boolean }[]

  // 공통
  validate(creds: CredentialPayload): Promise<ValidateResult>
}
```

- [ ] **Step 2: `lib/adapters/cafe24.ts` 작성**

```typescript
import 'server-only'
import type {
  ChannelAdapter,
  GetAuthUrlInput,
  HandleCallbackInput,
  CredentialPayload,
  ValidateResult,
} from './_types'

export const CAFE24_SCOPES = [
  'mall.read_order',
  'mall.write_order',
  'mall.read_analytics',
  'mall.read_product',
  'mall.read_category',
] as const

export const CAFE24_API_VERSION = '2025-12-01'

function basicAuth(appId: string, appSecret: string): string {
  return 'Basic ' + Buffer.from(`${appId}:${appSecret}`).toString('base64')
}

function getAuthUrl({ appId, mallId, state, redirectUri }: GetAuthUrlInput): string {
  const url = new URL(`https://${mallId}.cafe24api.com/api/v2/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', CAFE24_SCOPES.join(','))
  return url.toString()
}

async function handleCallback({
  code,
  mallId,
  appId,
  appSecret,
  redirectUri,
}: HandleCallbackInput): Promise<CredentialPayload> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }).toString()

  const r = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(appId, appSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const text = await r.text()
  if (!r.ok) {
    throw new Error(`카페24 token 교환 실패 (${r.status}): ${text.slice(0, 300)}`)
  }

  let tok: { access_token?: string; refresh_token?: string; expires_at?: string }
  try {
    tok = JSON.parse(text)
  } catch {
    throw new Error(`카페24 응답 파싱 실패: ${text.slice(0, 200)}`)
  }

  if (!tok.access_token || !tok.refresh_token) {
    throw new Error('카페24 응답에 access_token/refresh_token 없음')
  }

  return {
    appId,
    appSecret,
    mallId,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: tok.expires_at ?? '',
  }
}

async function validate(creds: CredentialPayload): Promise<ValidateResult> {
  const mallId = String(creds.mallId ?? '')
  const accessToken = String(creds.accessToken ?? '')
  if (!mallId || !accessToken) {
    return { ok: false, error: 'mallId 또는 accessToken 누락' }
  }

  const r = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/store`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Cafe24-Api-Version': CAFE24_API_VERSION,
    },
  })

  if (r.ok) return { ok: true }

  if (r.status === 401) {
    return { ok: false, error: '토큰이 유효하지 않습니다 (401). app_id/app_secret을 다시 확인해주세요' }
  }
  if (r.status === 403) {
    return { ok: false, error: 'scope 권한이 부족합니다. 카페24 앱 콘솔에서 scope를 확인해주세요' }
  }
  const text = await r.text().catch(() => '')
  return { ok: false, error: `카페24 API 에러 (${r.status}): ${text.slice(0, 200)}` }
}

export const cafe24Adapter: ChannelAdapter = {
  channel: 'cafe24',
  category: 'shop',
  authType: 'oauth',
  getAuthUrl,
  handleCallback,
  validate,
}
```

- [ ] **Step 3: `lib/adapters/_registry.ts` 작성**

```typescript
import 'server-only'
import type { ChannelAdapter } from './_types'
import { cafe24Adapter } from './cafe24'

const adapters: Record<string, ChannelAdapter> = {
  cafe24: cafe24Adapter,
  // Plan 3에서 smartstore, naver_ad 추가
}

export function getAdapter(channel: string): ChannelAdapter | undefined {
  return adapters[channel]
}

export function listEnabledChannels(): string[] {
  return Object.keys(adapters)
}
```

- [ ] **Step 4: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음. 어댑터는 아직 호출 안 되므로 빌드 시 dead code 경고 정도.

- [ ] **Step 5: 커밋**

```powershell
git add lib/adapters/
git commit -m "feat(adapters): ChannelAdapter 인터페이스 + cafe24 어댑터 + registry"
git push
```

---

### Task 4: 브랜드 색상 팔레트 + POST /api/brands + /brands/new 폼

**Files:**
- Create: `lib/brand-colors.ts`
- Create: `app/api/brands/route.ts`
- Create: `app/(dashboard)/brands/new/page.tsx`

**Interfaces:**
- Consumes:
  - `createServerClient()` (Plan 1 / `lib/supabase/server.ts`)
- Produces:
  - `BRAND_COLORS: readonly string[]` — 8개 색상 hex 코드
  - `pickBrandColor(seed: string): string` — 결정적(deterministic) 색상 선택
  - `POST /api/brands` — body `{ name: string }` → `{ id, name, color }` 또는 `{ error }`
  - `/brands/new` — 클라이언트 컴포넌트 폼

- [ ] **Step 1: `lib/brand-colors.ts` 작성**

```typescript
export const BRAND_COLORS = [
  '#f97316', // orange
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#eab308', // yellow
  '#f43f5e', // rose
] as const

export function pickBrandColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return BRAND_COLORS[hash % BRAND_COLORS.length]
}
```

> 결정적 함수라 같은 이름이면 같은 색. 사용자가 같은 이름 두 번 시도(중복 차단됨)해도 일관성.

- [ ] **Step 2: `app/api/brands/route.ts` 작성**

```typescript
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { pickBrandColor } from '@/lib/brand-colors'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: { name?: unknown }
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: '브랜드 이름을 입력해주세요' }, { status: 400 })
  }
  if (name.length > 50) {
    return NextResponse.json({ error: '브랜드 이름은 50자 이내로 입력해주세요' }, { status: 400 })
  }

  const color = pickBrandColor(name)

  const { data, error } = await supabase
    .from('brands')
    .insert({ name, color, owner_id: user.id })
    .select('id, name, color')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
```

> RLS 정책(brands_owner)이 `owner_id = auth.uid()` WITH CHECK이라 owner_id 명시 안 해도 되지만, 명시적으로 채우는 게 안전.

- [ ] **Step 3: `app/(dashboard)/brands/new/page.tsx` 작성**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function NewBrandPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const r = await fetch('/api/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await r.json()
    setLoading(false)

    if (!r.ok) {
      setError(data.error ?? '브랜드 생성 실패')
      return
    }
    router.push(`/brands/${data.id}/settings/connections`)
    router.refresh()
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>새 브랜드 추가</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">브랜드 이름</Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
              placeholder="예: 팔레오"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              색상은 자동으로 부여됩니다. 나중에 운영자에게 변경 요청 가능.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={loading || !name.trim()} className="w-full">
              {loading ? '추가 중...' : '추가'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: 빌드 확인**

```powershell
npm run build
```

기대: `/api/brands`와 `/brands/new` 라우트가 build output에 추가됨. 타입 에러 없음.

- [ ] **Step 5: 수동 검증 (로컬)**

```powershell
npm run dev
```

브라우저(시크릿 창에서 깨끗하게):
1. `http://localhost:3030` → /login → ssakwon@kbh.kr로 로그인
2. /brands → "+ 브랜드 추가" 또는 헤더 클릭 (현재는 없으므로 URL 직접: `http://localhost:3030/brands/new`)
3. 이름 "테스트 브랜드" 입력 → 추가
4. /brands/[새 id]/settings/connections 로 이동 (Task 6에서 만들 페이지 — 현재는 404. OK)
5. /brands로 돌아가서 새 카드가 추가됐는지 확인

Supabase SQL Editor 검증:
```sql
SELECT id, name, color, owner_id FROM brands ORDER BY created_at DESC LIMIT 3;
```
기대: 최상단에 "테스트 브랜드" + 자동 부여된 color + owner_id가 운영자 UUID.

dev 서버 `Ctrl+C` 종료.

- [ ] **Step 6: 테스트 브랜드 정리 (선택)**

검증용 브랜드를 남길지 정할 수 있음. 정리하려면 SQL Editor에서:

```sql
DELETE FROM brands WHERE name = '테스트 브랜드';
```

> 운영자가 만든 brand는 brand_credentials, orders 등이 비어있어서 CASCADE 영향 없음. 그래도 다음 task의 화면에서 보기 깔끔하려면 삭제 권장.

- [ ] **Step 7: 커밋**

```powershell
git add lib/brand-colors.ts app/api/brands/route.ts "app/(dashboard)/brands/new/page.tsx"
git commit -m "feat(brand): 색상 팔레트 + POST /api/brands + /brands/new 폼"
git push
```

---

### Task 5: 헤더 브랜드 스위처

**Files:**
- Create: `components/brand-switcher.tsx`
- Modify: `components/header.tsx`

**Interfaces:**
- Consumes:
  - `createServerClient()` (Plan 1)
  - shadcn `DropdownMenu` (Task 1에서 추가)
- Produces:
  - `<BrandSwitcher currentBrandId={...} brands={[...]} />` 컴포넌트 — 헤더에서 사용

- [ ] **Step 1: `components/brand-switcher.tsx` 작성**

```tsx
'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

type Brand = {
  id: string
  name: string
  color: string | null
}

export function BrandSwitcher({
  currentBrandId,
  brands,
}: {
  currentBrandId: string | null
  brands: Brand[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  const current = brands.find((b) => b.id === currentBrandId)

  function switchTo(brandId: string) {
    if (!currentBrandId) {
      router.push(`/brands/${brandId}`)
      return
    }
    // /brands/{currentBrandId}/... → /brands/{brandId}/...
    const next = pathname.replace(`/brands/${currentBrandId}`, `/brands/${brandId}`)
    router.push(next)
  }

  if (brands.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: current?.color ?? '#94a3b8' }}
          />
          <span>{current ? current.name : '브랜드 선택'}</span>
          <span className="text-xs text-muted-foreground">▼</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {brands.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => switchTo(b.id)}
            className="gap-2"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: b.color ?? '#94a3b8' }}
            />
            <span className="flex-1">{b.name}</span>
            {b.id === currentBrandId && <span>✓</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/brands/new">+ 브랜드 추가</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: `components/header.tsx` 수정**

```tsx
import { createServerClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { BrandSwitcher } from '@/components/brand-switcher'

export async function Header({ currentBrandId }: { currentBrandId?: string }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: brandsData } = await supabase
    .from('brands')
    .select('id, name, color')
    .order('created_at', { ascending: false })
  const brands = brandsData ?? []

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="font-bold">Order Manager SaaS</div>
          {brands.length > 0 && (
            <BrandSwitcher currentBrandId={currentBrandId ?? null} brands={brands} />
          )}
        </div>
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

- [ ] **Step 3: `app/(dashboard)/layout.tsx`은 그대로 (Header가 currentBrandId 없이 호출되어도 동작)**

확인: 기존 코드가:

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

이대로 두고, 각 페이지에서 필요하면 page별로 자체 헤더 표시(Task 6에서 brand-aware 헤더 적용). 단순화 — layout은 그대로 둠.

`Header` prop이 optional이라 변경 불필요.

- [ ] **Step 4: 빌드 확인**

```powershell
npm run build
```

기대: dropdown-menu가 SSR 가능. 타입 에러 없음.

- [ ] **Step 5: 수동 검증**

```powershell
npm run dev
```

시크릿 창에서 로그인 → /brands. 헤더에 브랜드 스위처가 표시되는지 확인:
- 현재 페이지가 /brands (특정 brand 컨텍스트 없음)이라 "브랜드 선택" 또는 첫 브랜드 표시
- 드롭다운 열어보면 brands 3~4개 (팔레오, 코코엘, 아프리모, 그리고 Task 4에서 만든 테스트 브랜드 또는 없음)
- "+ 브랜드 추가" 항목 → /brands/new 이동
- 다른 브랜드 클릭 시 — 현재는 /brands에 머무름 (다른 URL 매칭 없으므로). Task 6 이후 컨텍스트 페이지에서 동작 확인

dev 서버 종료.

- [ ] **Step 6: 커밋**

```powershell
git add components/brand-switcher.tsx components/header.tsx
git commit -m "feat(header): 브랜드 스위처 추가"
git push
```

---

### Task 6: 브랜드 상세 페이지 + 매체 연동 메인 페이지

**Files:**
- Create: `app/(dashboard)/brands/[brandId]/page.tsx`
- Create: `app/(dashboard)/brands/[brandId]/settings/connections/page.tsx`

**Interfaces:**
- Consumes:
  - `createServerClient()` (Plan 1)
- Produces:
  - `/brands/[brandId]` — 브랜드 홈 placeholder (연결 페이지로 가는 안내)
  - `/brands/[brandId]/settings/connections` — 매체 연동 메인. 카페24/스마트스토어/네이버광고 카드 + 등록된 자격증명 목록 표시

- [ ] **Step 1: `app/(dashboard)/brands/[brandId]/page.tsx` 작성**

```tsx
import { redirect, notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function BrandHomePage({
  params,
}: {
  params: Promise<{ brandId: string }>
}) {
  const { brandId } = await params
  const supabase = await createServerClient()
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, color')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: brand.color ?? '#94a3b8' }}
          />
          {brand.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          첫 매체를 연결하면 데이터 수집이 시작됩니다.
        </p>
        <Button asChild>
          <Link href={`/brands/${brand.id}/settings/connections`}>매체 연결하기</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
```

> RLS가 자동으로 다른 owner의 brand를 가려서 .single() → null → notFound. 보안 충분.

- [ ] **Step 2: `app/(dashboard)/brands/[brandId]/settings/connections/page.tsx` 작성**

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Credential = {
  id: string
  channel: string
  channel_account: string
  status: string
  last_synced_at: string | null
}

function ChannelCard({
  title,
  channelKey,
  brandId,
  credentials,
  available,
}: {
  title: string
  channelKey: string
  brandId: string
  credentials: Credential[]
  available: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>{title}</span>
          {!available && (
            <span className="text-xs font-normal text-muted-foreground">준비 중</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 계정이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {credentials.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded border p-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span>{c.status === 'active' ? '✅' : '⚠️'}</span>
                  <span className="font-medium">{c.channel_account}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.last_synced_at
                      ? `🔄 ${new Date(c.last_synced_at).toLocaleString('ko-KR')}`
                      : '🔄 -'}
                  </span>
                </div>
                <form action={`/api/credentials/${c.id}`} method="post">
                  <input type="hidden" name="_method" value="DELETE" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-red-600"
                    formAction={`/api/credentials/${c.id}/delete`}
                  >
                    ✕
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {available ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={`/brands/${brandId}/settings/connections/${channelKey}/new`}>
              + {title} 계정 추가
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled>
            + {title} 계정 추가
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>
  searchParams: Promise<{ connected?: string; error?: string }>
}) {
  const { brandId } = await params
  const sp = await searchParams
  const supabase = await createServerClient()

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, color')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  const { data: creds } = await supabase
    .from('brand_credentials')
    .select('id, channel, channel_account, status, last_synced_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true })

  const credsByChannel: Record<string, Credential[]> = {}
  for (const c of creds ?? []) {
    if (!credsByChannel[c.channel]) credsByChannel[c.channel] = []
    credsByChannel[c.channel].push(c as Credential)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{brand.name} — 매체 연동</h1>

      {sp.connected && (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-3 text-sm text-emerald-800">
            ✅ {sp.connected} 연결되었습니다.
          </CardContent>
        </Card>
      )}
      {sp.error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="p-3 text-sm text-red-800">
            ⚠️ {decodeURIComponent(sp.error)}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ChannelCard
          title="카페24"
          channelKey="cafe24"
          brandId={brand.id}
          credentials={credsByChannel['cafe24'] ?? []}
          available
        />
        <ChannelCard
          title="스마트스토어"
          channelKey="smartstore"
          brandId={brand.id}
          credentials={credsByChannel['smartstore'] ?? []}
          available={false}
        />
        <ChannelCard
          title="네이버광고"
          channelKey="naver_ad"
          brandId={brand.id}
          credentials={credsByChannel['naver_ad'] ?? []}
          available={false}
        />
      </div>
    </div>
  )
}
```

> 자격증명 삭제 form은 Task 10에서 실제 동작. 지금은 UI만.

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 새 라우트 2개 추가. 타입 에러 없음.

- [ ] **Step 4: 수동 검증**

```powershell
npm run dev
```

시크릿 창에서 로그인 → /brands → 팔레오 카드 클릭 → /brands/{팔레오 id} → "매체 연결하기" → /brands/{id}/settings/connections.

확인:
- 헤더에 팔레오가 현재 선택된 상태로 표시 (Task 5의 brand switcher가 currentBrandId 모르므로 일단 첫 브랜드 표시). currentBrandId 전달은 layout이 path 파싱하는 게 복잡 — Plan 2 시점엔 OK
- 카페24 / 스마트스토어 / 네이버광고 카드 3개 표시
- 카페24 카드는 "등록된 계정이 없습니다" + "+ 카페24 계정 추가" 활성
- 스마트스토어 / 네이버광고는 "준비 중" + 버튼 비활성
- "+ 카페24 계정 추가" 클릭 → /brands/{id}/settings/connections/cafe24/new — 404 (Task 7에서 생성)

dev 서버 종료.

- [ ] **Step 5: 커밋**

```powershell
git add "app/(dashboard)/brands/[brandId]/"
git commit -m "feat(connections): 브랜드 홈 + 매체 연동 메인 페이지 (카페24만 활성)"
git push
```

---

### Task 7: 카페24 자격증명 입력 폼

**Files:**
- Create: `app/(dashboard)/brands/[brandId]/settings/connections/cafe24/new/page.tsx`

**Interfaces:**
- Consumes:
  - 브랜드 컨텍스트 (URL의 brandId)
  - Task 8의 `POST /api/oauth/cafe24/start` (다음 task에서 만듦)
- Produces:
  - `/brands/[brandId]/settings/connections/cafe24/new` — 입력 폼 + 사전 안내

- [ ] **Step 1: `app/(dashboard)/brands/[brandId]/settings/connections/cafe24/new/page.tsx` 작성**

```tsx
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function NewCafe24CredentialPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { brandId } = await params
  const sp = await searchParams
  const supabase = await createServerClient()

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/auth/cafe24/callback`

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{brand.name} — 카페24 계정 추가</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-2">
            <p className="font-medium">사전 준비: 카페24 개발자 콘솔에서 앱 등록</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <a
                  href="https://developers.cafe24.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  카페24 개발자 센터
                </a>
                에 로그인 → 본인 mall로 앱 등록
              </li>
              <li>
                Redirect URI 등록 (둘 다 등록 권장):
                <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                  <li>{redirectUri}</li>
                  <li>http://localhost:3030/auth/cafe24/callback</li>
                </ul>
              </li>
              <li>
                Scope 설정:{' '}
                <span className="font-mono text-xs">
                  mall.read_order, mall.write_order, mall.read_analytics, mall.read_product,
                  mall.read_category
                </span>
              </li>
              <li>앱 등록 후 발급되는 Client ID / Client Secret을 아래 입력</li>
            </ol>
          </div>

          {sp.error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              ⚠️ {decodeURIComponent(sp.error)}
            </div>
          )}

          <form action="/api/oauth/cafe24/start" method="POST" className="space-y-4">
            <input type="hidden" name="brand_id" value={brand.id} />

            <div className="space-y-2">
              <Label htmlFor="mall_id">Mall ID</Label>
              <Input
                id="mall_id"
                name="mall_id"
                required
                placeholder="예: paleo"
                pattern="[a-zA-Z0-9_-]+"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                카페24 mall의 서브도메인 (예: paleo.cafe24.com → paleo)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="app_id">Client ID (App ID)</Label>
              <Input id="app_id" name="app_id" required autoComplete="off" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="app_secret">Client Secret (App Secret)</Label>
              <Input
                id="app_secret"
                name="app_secret"
                type="password"
                required
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                입력값은 안전하게 암호화되어 저장됩니다 (Supabase Vault).
              </p>
            </div>

            <Button type="submit" className="w-full">OAuth 시작</Button>
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

기대: 새 라우트 추가. 타입 에러 없음. `NEXT_PUBLIC_APP_URL`이 .env.local에 없으면 `${undefined}/...`가 출력되는데 빌드는 통과. 다음 step에서 확인.

- [ ] **Step 3: .env.local에 NEXT_PUBLIC_APP_URL 확인**

`C:\Users\Jangkwon\Desktop\order-manager-saas\.env.local` 열어서 `NEXT_PUBLIC_APP_URL=http://localhost:3030` 있는지 확인. 없으면 추가:

```
NEXT_PUBLIC_APP_URL=http://localhost:3030
```

- [ ] **Step 4: 수동 검증**

```powershell
npm run dev
```

시크릿 창: 로그인 → /brands → 팔레오 클릭 → /settings/connections → "+ 카페24 계정 추가" → /brands/{id}/settings/connections/cafe24/new.

확인:
- 사전 안내 박스 + redirect_uri 두 개가 정확히 표시
- 폼 3개 필드 (mall_id, app_id, app_secret) 표시
- "OAuth 시작" 버튼 — 누르면 /api/oauth/cafe24/start로 POST. 현재는 404 — 다음 task에서 만듦. OK

dev 서버 종료.

- [ ] **Step 5: 커밋**

```powershell
git add "app/(dashboard)/brands/[brandId]/settings/connections/cafe24/new/page.tsx"
git commit -m "feat(cafe24): 자격증명 입력 폼 + 카페24 앱 등록 가이드"
git push
```

---

### Task 8: POST /api/oauth/cafe24/start

**Files:**
- Create: `lib/oauth-cookie.ts`
- Create: `app/api/oauth/cafe24/start/route.ts`

**Interfaces:**
- Consumes:
  - `createServerClient()` (Plan 1)
  - `getAdapter('cafe24')` (Task 3)
  - 환경변수 `OAUTH_COOKIE_SECRET`, `NEXT_PUBLIC_APP_URL`
- Produces:
  - `signOAuthState(payload, secret)` / `verifyOAuthState(token, secret)` helpers
  - `POST /api/oauth/cafe24/start` — body `{ brand_id, mall_id, app_id, app_secret }` → 303 to 카페24 authorize URL

- [ ] **Step 1: `lib/oauth-cookie.ts` 작성**

```typescript
import 'server-only'
import { SignJWT, jwtVerify } from 'jose'

const COOKIE_NAME = 'cafe24_oauth_state'

export type Cafe24OAuthState = {
  brandId: string
  mallId: string
  appId: string
  appSecret: string
  nonce: string
}

function getKey(): Uint8Array {
  const secret = process.env.OAUTH_COOKIE_SECRET
  if (!secret) throw new Error('OAUTH_COOKIE_SECRET not set')
  return new TextEncoder().encode(secret)
}

export async function signOAuthState(payload: Cafe24OAuthState): Promise<string> {
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getKey())
}

export async function verifyOAuthState(token: string): Promise<Cafe24OAuthState> {
  const { payload } = await jwtVerify(token, getKey())
  const { brandId, mallId, appId, appSecret, nonce } = payload as Record<string, string>
  if (!brandId || !mallId || !appId || !appSecret || !nonce) {
    throw new Error('OAuth state payload incomplete')
  }
  return { brandId, mallId, appId, appSecret, nonce }
}

export const CAFE24_OAUTH_COOKIE = COOKIE_NAME
```

- [ ] **Step 2: `app/api/oauth/cafe24/start/route.ts` 작성**

```typescript
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { getAdapter } from '@/lib/adapters/_registry'
import { signOAuthState, CAFE24_OAUTH_COOKIE } from '@/lib/oauth-cookie'

function errorRedirect(url: URL, brandId: string | null, message: string) {
  const target = brandId
    ? `/brands/${brandId}/settings/connections/cafe24/new?error=${encodeURIComponent(message)}`
    : `/brands?error=${encodeURIComponent(message)}`
  return NextResponse.redirect(new URL(target, url), { status: 303 })
}

export async function POST(request: Request) {
  const reqUrl = new URL(request.url)
  const form = await request.formData()
  const brandId = String(form.get('brand_id') ?? '').trim()
  const mallId = String(form.get('mall_id') ?? '').trim()
  const appId = String(form.get('app_id') ?? '').trim()
  const appSecret = String(form.get('app_secret') ?? '').trim()

  if (!brandId || !mallId || !appId || !appSecret) {
    return errorRedirect(reqUrl, brandId || null, '모든 필드를 입력해주세요')
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(mallId)) {
    return errorRedirect(reqUrl, brandId, 'mall_id 형식이 올바르지 않습니다')
  }

  // 인증 + 본인 owner brand 확인
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', reqUrl), { status: 303 })
  }
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .single()
  if (!brand) {
    return errorRedirect(reqUrl, null, '브랜드를 찾을 수 없습니다')
  }

  const adapter = getAdapter('cafe24')
  if (!adapter?.getAuthUrl) {
    return errorRedirect(reqUrl, brandId, '카페24 어댑터를 로드할 수 없습니다')
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/auth/cafe24/callback`
  const nonce = randomBytes(16).toString('base64url')

  const cookieToken = await signOAuthState({
    brandId,
    mallId,
    appId,
    appSecret,
    nonce,
  })

  const authorizeUrl = adapter.getAuthUrl({
    appId,
    mallId,
    state: nonce,
    redirectUri,
  })

  const res = NextResponse.redirect(authorizeUrl, { status: 303 })
  res.cookies.set({
    name: CAFE24_OAUTH_COOKIE,
    value: cookieToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/cafe24',
    maxAge: 300,
  })
  return res
}
```

> `path: '/auth/cafe24'`로 콜백 경로에만 쿠키 전송. 다른 경로엔 노출 안 됨.

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 새 라우트 추가. 타입 에러 없음.

- [ ] **Step 4: 수동 검증 (OAuth 시작까지만)**

```powershell
npm run dev
```

시크릿 창: 로그인 → 팔레오 → 카페24 추가 폼 → mall_id=test, app_id=fake, app_secret=fake 입력 → "OAuth 시작" 클릭.

기대:
- 브라우저가 `https://test.cafe24api.com/api/v2/oauth/authorize?...`로 이동
- 카페24가 "존재하지 않는 mall" 또는 "잘못된 client_id" 에러 페이지 표시 (정상 — 페이크 데이터라 그럼)
- 우리 서버 단계는 통과한 것

브라우저 개발자도구 → Application → Cookies → `cafe24_oauth_state` 쿠키가 path=`/auth/cafe24`로 설정돼 있는지 확인.

dev 서버 종료.

- [ ] **Step 5: 커밋**

```powershell
git add lib/oauth-cookie.ts app/api/oauth/cafe24/start/route.ts
git commit -m "feat(oauth): cafe24 OAuth start endpoint + 서명 쿠키 helper"
git push
```

---

### Task 9: GET /auth/cafe24/callback

**Files:**
- Create: `app/auth/cafe24/callback/route.ts`

**Interfaces:**
- Consumes:
  - `verifyOAuthState`, `CAFE24_OAUTH_COOKIE` (Task 8)
  - `getAdapter('cafe24')` (Task 3) — `handleCallback`, `validate`
  - `createServerClient`, `createAdminClient` (Plan 1, Task 2)
- Produces:
  - `GET /auth/cafe24/callback` — 카페24가 부르는 콜백. code 교환 + validate + Vault + brand_credentials INSERT + redirect

- [ ] **Step 1: `app/auth/cafe24/callback/route.ts` 작성**

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdapter } from '@/lib/adapters/_registry'
import { verifyOAuthState, CAFE24_OAUTH_COOKIE } from '@/lib/oauth-cookie'

function redirectWithError(origin: string, brandId: string | null, message: string) {
  const target = brandId
    ? `${origin}/brands/${brandId}/settings/connections?error=${encodeURIComponent(message)}`
    : `${origin}/brands?error=${encodeURIComponent(message)}`
  const res = NextResponse.redirect(target, { status: 303 })
  res.cookies.set({
    name: CAFE24_OAUTH_COOKIE,
    value: '',
    path: '/auth/cafe24',
    maxAge: 0,
  })
  return res
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // 사용자가 카페24 동의 화면에서 거부
  if (error) {
    return redirectWithError(origin, null, `카페24 연결 취소: ${error}`)
  }
  if (!code || !state) {
    return redirectWithError(origin, null, 'OAuth code/state 누락')
  }

  // 쿠키 복원
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get(CAFE24_OAUTH_COOKIE)?.value
  if (!stateCookie) {
    return redirectWithError(origin, null, 'OAuth state 쿠키가 없거나 만료되었습니다')
  }

  let stateData: Awaited<ReturnType<typeof verifyOAuthState>>
  try {
    stateData = await verifyOAuthState(stateCookie)
  } catch {
    return redirectWithError(origin, null, 'OAuth state 검증 실패')
  }

  // CSRF 검증
  if (state !== stateData.nonce) {
    return redirectWithError(origin, stateData.brandId, 'CSRF nonce 불일치')
  }

  // 본인 owner brand 검증
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login`, { status: 303 })
  }
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('id', stateData.brandId)
    .single()
  if (!brand) {
    return redirectWithError(origin, null, '브랜드를 찾을 수 없거나 권한이 없습니다')
  }

  const adapter = getAdapter('cafe24')
  if (!adapter?.handleCallback) {
    return redirectWithError(origin, stateData.brandId, '카페24 어댑터 로드 실패')
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/auth/cafe24/callback`

  // token 교환
  let payload
  try {
    payload = await adapter.handleCallback({
      code,
      mallId: stateData.mallId,
      appId: stateData.appId,
      appSecret: stateData.appSecret,
      redirectUri,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'token 교환 실패'
    return redirectWithError(origin, stateData.brandId, msg)
  }

  // validate
  const v = await adapter.validate(payload)
  if (!v.ok) {
    return redirectWithError(origin, stateData.brandId, v.error)
  }

  // Vault + brand_credentials INSERT (admin 클라이언트로)
  const admin = createAdminClient()

  // vault.create_secret RPC는 vault schema에 있으므로 .schema('vault') 명시
  const { data: secretId, error: vaultErr } = await admin
    .schema('vault')
    .rpc('create_secret', {
      new_secret: JSON.stringify(payload),
      new_name: `cafe24:${stateData.brandId}:${stateData.mallId}`,
      new_description: `${brand.name} / ${stateData.mallId}`,
    })
  if (vaultErr || !secretId) {
    return redirectWithError(
      origin,
      stateData.brandId,
      `Vault 저장 실패: ${vaultErr?.message ?? 'unknown'}`
    )
  }

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

  if (insertErr) {
    // UNIQUE 위반 등
    const msg = insertErr.code === '23505'
      ? `이 mall(${stateData.mallId})은 이미 등록되어 있습니다`
      : `자격증명 저장 실패: ${insertErr.message}`
    return redirectWithError(origin, stateData.brandId, msg)
  }

  // 성공 → 쿠키 삭제 + connections 페이지로
  const res = NextResponse.redirect(
    `${origin}/brands/${stateData.brandId}/settings/connections?connected=${encodeURIComponent(`cafe24:${stateData.mallId}`)}`,
    { status: 303 }
  )
  res.cookies.set({
    name: CAFE24_OAUTH_COOKIE,
    value: '',
    path: '/auth/cafe24',
    maxAge: 0,
  })
  return res
}
```

- [ ] **Step 2: 빌드 확인**

```powershell
npm run build
```

기대: 새 라우트 추가. 타입 에러 없음.

- [ ] **Step 3: 수동 통합 검증 (해피 패스)**

운영자(`ssakwon@kbh.kr`)가 보유한 카페24 mall 중 **하나**로 진행. 추천: 기존 .env의 `CAFE24_CLIENT_ID_AFRIMO`/`CAFE24_CLIENT_SECRET_AFRIMO` 같이 이미 있는 자격증명을 그대로 사용.

준비:
- 카페24 개발자 콘솔 → 해당 앱 → Redirect URI에 `http://localhost:3030/auth/cafe24/callback` 추가
- Scope에 5개 모두 있는지 확인

실행:
```powershell
npm run dev
```

시크릿 창에서:
1. 로그인 (ssakwon@kbh.kr)
2. /brands → "+ 브랜드 추가" → 이름 "테스트 카페24" 입력 → /brands/{id}/settings/connections
3. "+ 카페24 계정 추가" → 폼:
   - mall_id: (실제 mall id, 예: afrimo)
   - app_id: (실제 client id)
   - app_secret: (실제 client secret)
4. "OAuth 시작" → 카페24 동의 화면 → 동의
5. `/auth/cafe24/callback?...`로 자동 이동 → 처리 후 `/brands/{id}/settings/connections?connected=cafe24:{mallId}`로 이동
6. 화면 상단에 ✅ 토스트 + 카페24 카드에 ✅ {mall_id} 행 표시

Supabase 검증 쿼리:
```sql
-- 1. brand_credentials 확인
SELECT id, channel, channel_account, status, secret_id, last_synced_at
FROM brand_credentials
WHERE brand_id = '{테스트 브랜드 id}';

-- 2. vault.secrets 확인
SELECT id, name, description, created_at
FROM vault.secrets
WHERE name LIKE 'cafe24:%';

-- 3. payload 복호화 확인 (service_role로만 가능. Supabase 대시보드에서 실행)
SELECT id, name, decrypted_secret
FROM vault.decrypted_secrets
WHERE name LIKE 'cafe24:%';
```

기대 (1): 1행 — channel=cafe24, channel_account={mall_id}, secret_id가 uuid, status='active'.
기대 (2): 1행 — name='cafe24:{brandId}:{mallId}'.
기대 (3): 1행 — JSON에 appId/appSecret/accessToken/refreshToken/expiresAt 모두 있음.

- [ ] **Step 4: 수동 부정 검증 (실패 케이스)**

같은 mall_id로 다시 시도 → "이미 등록되어 있습니다" 에러 표시.

잘못된 app_secret 입력 → "token 교환 실패" 에러 표시. brand_credentials INSERT 안 됨.

- [ ] **Step 5: 테스트 데이터 정리 (선택)**

검증이 끝났으면 SQL Editor에서:

```sql
-- 테스트 자격증명 + secret 삭제
DELETE FROM brand_credentials WHERE channel_account = '{테스트 mall id}';
DELETE FROM vault.secrets WHERE name LIKE 'cafe24:%' AND name LIKE '%{테스트 mall id}';
-- 테스트 브랜드 삭제 (CASCADE로 brand_credentials도 같이 — 위 두 줄 안 해도 됨)
DELETE FROM brands WHERE name = '테스트 카페24';
```

dev 서버 종료.

- [ ] **Step 6: 커밋**

```powershell
git add app/auth/cafe24/callback/route.ts
git commit -m "feat(oauth): cafe24 OAuth callback (token 교환 + validate + Vault + INSERT)"
git push
```

---

### Task 10: 단일 자격증명 해제 (DELETE)

**Files:**
- Create: `app/api/credentials/[credentialId]/delete/route.ts`
- Modify: `app/(dashboard)/brands/[brandId]/settings/connections/page.tsx` (form action을 새 endpoint로)

**Interfaces:**
- Consumes:
  - `createServerClient`, `createAdminClient`
- Produces:
  - `POST /api/credentials/{id}/delete` — RLS로 본인 brand의 자격증명만 삭제 가능. Vault secret도 함께 정리. 303 redirect

- [ ] **Step 1: `app/api/credentials/[credentialId]/delete/route.ts` 작성**

```typescript
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  request: Request,
  ctx: { params: Promise<{ credentialId: string }> }
) {
  const { credentialId } = await ctx.params
  const reqUrl = new URL(request.url)

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', reqUrl), { status: 303 })
  }

  // RLS로 본인 brand의 credential만 조회 가능
  const { data: cred } = await supabase
    .from('brand_credentials')
    .select('id, brand_id, channel, channel_account, secret_id')
    .eq('id', credentialId)
    .single()

  if (!cred) {
    return NextResponse.redirect(
      new URL('/brands?error=credential_not_found', reqUrl),
      { status: 303 }
    )
  }

  const admin = createAdminClient()

  // 1. brand_credentials 삭제 (RLS로 본인 것만)
  const { error: delErr } = await admin
    .from('brand_credentials')
    .delete()
    .eq('id', credentialId)

  if (delErr) {
    return NextResponse.redirect(
      new URL(
        `/brands/${cred.brand_id}/settings/connections?error=${encodeURIComponent('자격증명 삭제 실패: ' + delErr.message)}`,
        reqUrl
      ),
      { status: 303 }
    )
  }

  // 2. Vault secret 정리 (실패해도 brand_credentials는 삭제됨 — best-effort)
  // vault.secrets는 vault schema에 있으므로 .schema('vault') 명시
  if (cred.secret_id) {
    await admin.schema('vault').from('secrets').delete().eq('id', cred.secret_id)
    // 실패 시 로그만, 사용자에게 영향 없음
  }

  return NextResponse.redirect(
    new URL(
      `/brands/${cred.brand_id}/settings/connections?connected=${encodeURIComponent('disconnected')}`,
      reqUrl
    ),
    { status: 303 }
  )
}
```

- [ ] **Step 2: `app/(dashboard)/brands/[brandId]/settings/connections/page.tsx`의 form action 수정**

기존 코드에서 다음 부분을 찾는다:

```tsx
<form action={`/api/credentials/${c.id}`} method="post">
  <input type="hidden" name="_method" value="DELETE" />
  <Button
    type="submit"
    variant="ghost"
    size="sm"
    className="text-red-600"
    formAction={`/api/credentials/${c.id}/delete`}
  >
    ✕
  </Button>
</form>
```

다음으로 교체:

```tsx
<form action={`/api/credentials/${c.id}/delete`} method="post">
  <Button
    type="submit"
    variant="ghost"
    size="sm"
    className="text-red-600"
    onClick={(e) => {
      if (!confirm(`'${c.channel_account}' 연결을 해제하시겠습니까?`)) {
        e.preventDefault()
      }
    }}
  >
    ✕
  </Button>
</form>
```

> `onClick`은 클라이언트 핸들러 — 페이지를 client component로 만들지 않으려면 `confirm` 부분은 빼고 곧바로 동작하게 둘 수 있음. 단순 확인 모달은 추후 별도 UI로. Plan 2는 그대로 페이지 server component 유지 + form submit 직접 (no confirm) 로 가자.

**대안 (Plan 2 채택)**: `onClick` 빼고 그대로 submit. 사용자 실수 방지는 추후 plan.

수정된 코드:

```tsx
<form action={`/api/credentials/${c.id}/delete`} method="post">
  <Button
    type="submit"
    variant="ghost"
    size="sm"
    className="text-red-600"
  >
    ✕
  </Button>
</form>
```

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 새 라우트 추가. 타입 에러 없음.

- [ ] **Step 4: 수동 검증**

```powershell
npm run dev
```

1. 시크릿 창 로그인 → 등록된 카페24 자격증명이 있는 브랜드로 이동 (없으면 Task 9 Step 3 다시 진행해서 1개 추가)
2. 카페24 카드의 ✕ 버튼 클릭
3. 페이지 새로고침 → 자격증명 행이 사라졌는지 확인

Supabase SQL Editor:
```sql
-- brand_credentials에서 삭제됨
SELECT * FROM brand_credentials WHERE channel_account = '{삭제한 mall_id}';
-- vault.secrets에서도 삭제됨
SELECT * FROM vault.secrets WHERE name LIKE '%{삭제한 mall_id}%';
```

기대: 둘 다 0행.

dev 서버 종료.

- [ ] **Step 5: 커밋**

```powershell
git add "app/api/credentials/[credentialId]/delete/route.ts" "app/(dashboard)/brands/[brandId]/settings/connections/page.tsx"
git commit -m "feat(connections): 자격증명 해제 (brand_credentials + Vault secret 함께 삭제)"
git push
```

---

### Task 11: 통합 수동 검증 + 프로덕션 배포

**Files:**
- 외부 설정만 (카페24 콘솔, Vercel, Supabase)

**Interfaces:**
- Produces: spec의 7개 검증 시나리오를 프로덕션에서 모두 통과

- [ ] **Step 1: Vercel 환경변수 점검**

Vercel 프로젝트 → Settings → Environment Variables. 다음 4개가 **Production**에 등록되어 있어야 함:

| Key | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Plan 1에서 등록됨 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Plan 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Plan 1 |
| `SUPER_ADMIN_EMAILS` | `ssakwon@kbh.kr` (Plan 1) |
| `NEXT_PUBLIC_APP_URL` | `https://order-manager-saas-bay.vercel.app` |
| `OAUTH_COOKIE_SECRET` | **신규** — Task 1 Step 4에서 생성한 값 (또는 별개 값 새로 생성) |

마지막 한 줄(`OAUTH_COOKIE_SECRET`)이 없으면 Add:
- Key: `OAUTH_COOKIE_SECRET`
- Value: Task 1 Step 4에서 생성한 base64 문자열 (또는 새로 생성한 다른 값. 로컬과 일치할 필요 없음)
- Environments: Production, Preview, Development 모두 체크

- [ ] **Step 2: 푸시 후 자동 재배포 트리거**

Task 10의 커밋이 main에 push되면 Vercel이 자동 빌드 + 배포. Vercel Deployments 탭에서 Ready 상태 확인.

빌드 실패 시: 환경변수 누락(OAUTH_COOKIE_SECRET 없으면 빌드 통과되지만 런타임 throw) 또는 다른 원인. 빌드 로그 확인.

- [ ] **Step 3: 카페24 콘솔에 프로덕션 redirect_uri 추가**

운영자가 보유한 카페24 앱(검증용)의 Redirect URI 목록에 다음 추가:

```
https://order-manager-saas-bay.vercel.app/auth/cafe24/callback
```

기존 `http://localhost:3030/auth/cafe24/callback`는 유지 (개발용).

저장.

- [ ] **Step 4: spec의 7개 시나리오를 프로덕션에서 검증**

`https://order-manager-saas-bay.vercel.app`에 시크릿 창으로 접속.

1. **운영자 로그인** (`ssakwon@kbh.kr`)
2. **브랜드 추가**: /brands → 헤더 스위처에서 "+ 브랜드 추가" 또는 /brands/new → 이름 "Plan 2 검증" → 추가
3. **카페24 연결**: 자동 이동된 /brands/{id}/settings/connections → "+ 카페24 계정 추가" → 사전 안내 확인 → 입력값(실제 mall + app_id/secret) 입력 → "OAuth 시작" → 카페24 동의 → 콜백 → ✅ 토스트
4. **brand_credentials 확인** (Supabase SQL Editor):
   ```sql
   SELECT id, channel, channel_account, status, secret_id IS NOT NULL AS has_secret
   FROM brand_credentials
   WHERE brand_id = '{Plan 2 검증 brand id}';
   ```
   기대: 1행, channel='cafe24', has_secret=true, status='active'
5. **vault.secrets 확인**:
   ```sql
   SELECT name, description FROM vault.secrets WHERE name LIKE 'cafe24:%' ORDER BY created_at DESC LIMIT 1;
   ```
   기대: 1행, name='cafe24:{brandId}:{mallId}'
6. **payload 복호화 확인**:
   ```sql
   SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name LIKE 'cafe24:%' ORDER BY created_at DESC LIMIT 1;
   ```
   기대: JSON에 appId/appSecret/accessToken/refreshToken 모두 있음
7. **UI 표시 확인**: connections 페이지 새로고침 → 카페24 카드에 ✅ {mall_id} 행
8. **RLS 격리 검증**: 다른 시크릿 창에서 임시 사용자(또는 다른 직원 계정) 로그인 → `/brands/{Plan 2 검증 brand id}/settings/connections` 직접 접근 → 404 (RLS로 brand가 안 보임)
9. **부정 검증**: connections에서 "+ 카페24 계정 추가" → 잘못된 app_secret으로 시도 → 에러 표시 + brand_credentials INSERT 안 됨
10. **자격증명 해제**: 카드의 ✕ 버튼 → brand_credentials + vault.secrets 둘 다 사라졌는지 SQL로 확인

10개 다 통과해야 Plan 2 완료. (spec의 7개를 더 자세히 쪼갠 셈)

- [ ] **Step 5: 검증 정리**

```sql
DELETE FROM brands WHERE name = 'Plan 2 검증';
-- CASCADE로 brand_credentials도 삭제. vault.secrets만 별도 삭제 필요:
DELETE FROM vault.secrets WHERE name LIKE 'cafe24:%{Plan 2 검증 brand id}%';
-- 또는 모두 cleanup:
DELETE FROM vault.secrets WHERE id NOT IN (SELECT secret_id FROM brand_credentials WHERE secret_id IS NOT NULL);
```

- [ ] **Step 6: Plan 2 완료 표시 + README 갱신 (선택)**

`README.md`에 한 줄 추가 또는 그대로 둠. Plan 1처럼 별도 메시지 없이 끝내도 OK.

이번엔 README 그대로 두자. 코드 변경 0.

```powershell
# 코드 변경 없음 — 커밋 없이 종료
git status   # 변경 사항 없음 확인
```

Plan 2 끝.

---

## Plan 2 완료 기준 체크리스트

- [ ] `lib/supabase/admin.ts` — service_role 클라이언트 (`server-only` 가드)
- [ ] `lib/adapters/_types.ts` — ChannelAdapter 인터페이스
- [ ] `lib/adapters/cafe24.ts` — getAuthUrl / handleCallback / validate 구현
- [ ] `lib/adapters/_registry.ts` — getAdapter('cafe24') 동작
- [ ] `lib/brand-colors.ts` — 8색 팔레트 + pickBrandColor
- [ ] `lib/oauth-cookie.ts` — jose 기반 서명 쿠키 helper
- [ ] `POST /api/brands` — RLS 통과 + owner_id 자동 채움
- [ ] `/brands/new` — 폼 + 추가 후 자동 이동
- [ ] `components/brand-switcher.tsx` — 스위처 드롭다운
- [ ] `components/header.tsx` — 스위처 통합
- [ ] `/brands/[id]` — 홈 placeholder
- [ ] `/brands/[id]/settings/connections` — 매체 카드 3개 (카페24만 활성)
- [ ] `/brands/[id]/settings/connections/cafe24/new` — 입력 폼 + 가이드
- [ ] `POST /api/oauth/cafe24/start` — 쿠키 set + 303 to 카페24
- [ ] `GET /auth/cafe24/callback` — token 교환 + validate + Vault + INSERT
- [ ] `POST /api/credentials/{id}/delete` — brand_credentials + vault.secrets 함께 삭제
- [ ] 로컬 통합 검증 통과 (Task 9 Step 3)
- [ ] 프로덕션 통합 검증 통과 (Task 11 Step 4의 10개 시나리오)

## Plan 2 이후 — Plan 3 준비

Plan 3에서 다룰 것:
- `lib/adapters/smartstore.ts` — 스마트스토어 client_credentials 어댑터 (bcrypt 서명)
- `lib/adapters/naver-ad.ts` — 네이버광고 HMAC 서명 어댑터
- `lib/adapters/_types.ts`에 `credentialFields` 활성 (스마트스토어/네이버광고는 OAuth 아니라 키 입력 폼)
- `/settings/connections`의 스마트스토어/네이버광고 카드 활성
- 같은 채널 카드 패턴 재사용 → 두 어댑터만 추가하면 UI 동작

Plan 4에서 다룰 것:
- pg_cron 잡 등록 (active credentials → sync_jobs INSERT)
- 카페24 가상서버 워커 (PM2) — sync_jobs polling + 어댑터 sync 메서드 호출
- `_types.ts`에 `refreshToken`, `syncOrders`, `syncAdStats`, `syncProducts`, `syncAdUnits` 추가
- 토큰 자동 refresh (호출 직전 expiresAt 체크)

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| `OAUTH_COOKIE_SECRET` 누락 → 런타임 throw | Task 1 Step 5/6에서 .env 명시. Task 11 Step 1에서 Vercel에도 추가 |
| Vault extension 비활성 → create_secret RPC 실패 | Task 1 Step 1에서 사전 점검. 비활성 시 토글 ON |
| 카페24 콘솔 redirect_uri 미등록 → callback 시 redirect 차단 | Task 7 Step 1의 안내 박스 + Task 11 Step 3에서 명시적으로 등록 |
| Vault secret 정리(Task 10)가 best-effort라 stale 가능 | brand_credentials 삭제는 보장. vault.secrets 누락 시 운영자 정기 cleanup 쿼리로 회수 (Plan 4 또는 별도) |
| 한 mall_id 중복 등록 시도 | DB UNIQUE (brand_id, channel, channel_account) → 23505 catch → "이미 등록되어 있습니다" |
| token 교환 직후 access_token만 받아두고 2시간 후 만료 | Plan 2 검증 시점엔 OK. 자동 refresh는 Plan 4 sync 워커에서 |
| service_role 키가 클라이언트 번들에 들어감 | Task 2의 `import 'server-only'`가 빌드 시점에 차단 |
| OAuth state cookie 만료 (5분 초과) → 콜백 시 검증 실패 | Task 9의 에러 처리로 명확한 메시지 + 사용자가 다시 시도 |
