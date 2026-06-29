# Plan 3 — 스마트스토어 + 네이버광고 어댑터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 2의 어댑터 + 매체 연동 인프라 위에 스마트스토어(naver commerce) + 네이버광고(searchad) 어댑터를 같은 패턴으로 추가하고, API 키 매체용 동적 폼 페이지 + register endpoint를 일반화해서 운영자가 두 매체의 자격증명을 등록·즉시 검증·Vault 저장까지 끝까지 흐를 수 있게 한다.

**Architecture:** `ChannelAdapter` 인터페이스를 `credentialFields: FieldDef[]` + `buildPayload(formValues)` 옵셔널로 확장. 두 어댑터 신규(`smartstore.ts`, `naver-ad.ts`)는 client_credentials + bcrypt 서명(스마트스토어), HMAC-SHA256 서명(네이버광고)으로 validate. `[channel]/new` 동적 폼 페이지가 어댑터의 credentialFields를 읽어 자동 렌더, POST → `/api/credentials/[channel]/register`로 통합 처리. 카페24 OAuth 페이지(`/cafe24/new`)는 변경 없음.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Tailwind v4, shadcn/ui, `@supabase/ssr` + `@supabase/supabase-js`, `bcryptjs` 신규 (스마트스토어 서명용), node `crypto` 내장 (네이버광고 HMAC), Supabase Vault.

**Spec:** `docs/superpowers/specs/2026-06-30-plan3-smartstore-naverad-design.md`

## Global Constraints

- **레포 위치 (로컬)**: `C:\Users\Jangkwon\Desktop\order-manager-saas`
- **GitHub 레포**: `andre21382138-jpg/order-manager-saas`
- **Production URL**: `https://order-manager-saas-bay.vercel.app`
- **Supabase 프로젝트**: 기존 `order-manager` 재사용
- **운영자 user_id**: `4bfab62c-f8b7-4c07-b170-70485e4a6266` (`ssakwon@kbh.kr`)
- **DB 변경 없음** — Plan 1·2에서 만든 `brand_credentials` + Plan 2의 vault wrapper(`public.create_vault_secret`, `public.delete_vault_secret`) 그대로 재사용
- **새 환경변수 없음** — Plan 1·2의 env 그대로 (`OAUTH_COOKIE_SECRET`는 cafe24 전용으로 이미 등록됨, API 키 매체는 쿠키 사용 안 함)
- **새 의존성**: `bcryptjs` + `@types/bcryptjs` (스마트스토어 서명 — Vercel 빌드 호환을 위해 pure JS 패키지 선택)
- **스마트스토어 API base**: `https://api.commerce.naver.com`
- **스마트스토어 token endpoint**: `POST /external/v1/oauth2/token` (form-urlencoded, body: `client_id`, `timestamp`, `client_secret_sign`, `grant_type=client_credentials`, `type=SELF`)
- **네이버광고 API base**: `https://api.searchad.naver.com`
- **네이버광고 validate endpoint**: `GET /ncc/campaigns` (헤더 `X-Timestamp`, `X-API-KEY`, `X-Customer`, `X-Signature`)
- **HMAC 서명 규칙**: `HMAC-SHA256(secretKey, "${timestamp}.${method}.${uri}")` → base64
- **자동 테스트 인프라 없음** — 빌드 통과 + 운영자 수동 검증
- **TypeScript strict 유지**
- **모든 `lib/**` 파일 첫 줄에 `import 'server-only'`**
- **모든 어댑터 어떤 시점에도 Vault payload를 console.log/응답에 노출 금지**

## File Structure (Plan 3 완료 시점)

```
order-manager-saas/
├── app/
│   ├── (dashboard)/
│   │   ├── brands/[brandId]/
│   │   │   └── settings/
│   │   │       └── connections/
│   │   │           ├── page.tsx                       # ★ 변경 — smartstore/naver_ad 카드 활성
│   │   │           ├── cafe24/new/page.tsx            # Plan 2 그대로
│   │   │           └── [channel]/new/page.tsx         # ★ 신규 — API 키 매체 동적 폼
│   ├── api/
│   │   ├── brands/route.ts                            # Plan 2 그대로
│   │   ├── oauth/cafe24/start/route.ts                # Plan 2 그대로
│   │   ├── credentials/
│   │   │   ├── [credentialId]/delete/route.ts         # Plan 2 그대로
│   │   │   └── [channel]/
│   │   │       └── register/route.ts                  # ★ 신규 — API 키 매체 등록
│   ├── auth/cafe24/callback/route.ts                  # Plan 2 그대로
│   └── ...
├── components/                                        # Plan 2 그대로 (header, brand-switcher 등)
├── lib/
│   ├── adapters/
│   │   ├── _types.ts                                  # ★ 변경 — FieldDef + buildPayload? 추가
│   │   ├── _registry.ts                               # ★ 변경 — smartstore, naver_ad 등록
│   │   ├── cafe24.ts                                  # Plan 2 그대로
│   │   ├── smartstore.ts                              # ★ 신규
│   │   └── naver-ad.ts                                # ★ 신규
│   ├── supabase/
│   │   ├── server.ts                                  # Plan 1 그대로
│   │   ├── client.ts                                  # Plan 1 그대로
│   │   ├── middleware.ts                              # Plan 1 그대로
│   │   └── admin.ts                                   # Plan 2 그대로
│   ├── brand-colors.ts                                # Plan 2 그대로
│   ├── oauth-cookie.ts                                # Plan 2 그대로 (카페24 전용)
│   └── utils.ts                                       # Plan 1 그대로
├── package.json                                       # ★ bcryptjs + @types/bcryptjs 추가
└── ...
```

---

### Task 1: bcryptjs 의존성 + 어댑터 인터페이스 확장

**Files:**
- Modify: `package.json` (bcryptjs, @types/bcryptjs)
- Modify: `lib/adapters/_types.ts`

**Interfaces:**
- Produces:
  - `bcryptjs` 라이브러리 — 스마트스토어 어댑터(Task 2)에서 `bcrypt.hashSync(password, salt)` 사용
  - `FieldDef` 타입 — `{ key, label, placeholder?, secret?, hint? }`. 매체별 폼 필드 정의용
  - `ChannelAdapter`에 옵셔널 `credentialFields?: FieldDef[]`, `buildPayload?(formValues): CredentialPayload` 추가
  - cafe24 어댑터는 두 필드 모두 미구현이라 영향 없음

- [ ] **Step 1: bcryptjs 설치**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
npm install bcryptjs
npm install --save-dev @types/bcryptjs
```

기대: `package.json` dependencies에 `bcryptjs`, devDependencies에 `@types/bcryptjs` 추가.

- [ ] **Step 2: `lib/adapters/_types.ts` 갱신**

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
}
```

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음. cafe24 어댑터는 두 신규 필드 미구현이지만 옵셔널이라 빌드 통과.

- [ ] **Step 4: 커밋**

```powershell
git add package.json package-lock.json lib/adapters/_types.ts
git commit -m "feat(adapters): bcryptjs 의존성 + ChannelAdapter에 credentialFields/buildPayload 옵셔널 추가"
git push
```

---

### Task 2: 스마트스토어 어댑터

**Files:**
- Create: `lib/adapters/smartstore.ts`

**Interfaces:**
- Consumes:
  - `ChannelAdapter`, `FieldDef`, `CredentialPayload`, `ValidateResult` from `./_types` (Task 1)
  - `bcryptjs` (Task 1)
- Produces:
  - `smartstoreAdapter: ChannelAdapter` 객체 — Task 3에서 `_registry.ts`에 등록

- [ ] **Step 1: `lib/adapters/smartstore.ts` 작성**

```typescript
import 'server-only'
import bcrypt from 'bcryptjs'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
} from './_types'

const NAVER_COMMERCE_BASE = 'https://api.commerce.naver.com'

function buildPayload(formValues: Record<string, string>): CredentialPayload {
  return {
    clientId: formValues.clientId,
    clientSecret: formValues.clientSecret,
  }
}

async function validate(creds: CredentialPayload): Promise<ValidateResult> {
  const clientId = String(creds.clientId ?? '')
  const clientSecret = String(creds.clientSecret ?? '')
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'clientId/clientSecret 누락' }
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

  let r: Response
  try {
    r = await fetch(`${NAVER_COMMERCE_BASE}/external/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error'
    return { ok: false, error: `스마트스토어 호출 실패: ${msg}` }
  }

  if (r.ok) {
    const data = (await r.json().catch(() => null)) as { access_token?: string } | null
    if (data?.access_token) return { ok: true }
    return { ok: false, error: '응답에 access_token 없음' }
  }
  if (r.status === 400 || r.status === 401) {
    return { ok: false, error: 'Client ID 또는 Secret이 올바르지 않습니다' }
  }
  const text = await r.text().catch(() => '')
  return { ok: false, error: `스마트스토어 API 에러 (${r.status}): ${text.slice(0, 200)}` }
}

export const smartstoreAdapter: ChannelAdapter = {
  channel: 'smartstore',
  category: 'shop',
  authType: 'api_key',
  credentialFields: [
    {
      key: 'accountLabel',
      label: '계정 이름 (별칭)',
      placeholder: '예: 메인스토어',
      hint: '이 SaaS에서 식별용. 실제 매체 ID 아님.',
    },
    {
      key: 'clientId',
      label: 'Client ID',
      placeholder: 'naver commerce 개발자센터에서 발급',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      secret: true,
    },
  ],
  buildPayload,
  validate,
}
```

- [ ] **Step 2: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음. 어댑터는 아직 registry에 미등록이라 dead code 경고 정도.

- [ ] **Step 3: 커밋**

```powershell
git add lib/adapters/smartstore.ts
git commit -m "feat(adapters): smartstore 어댑터 (client_credentials + bcrypt 서명)"
git push
```

---

### Task 3: 네이버광고 어댑터 + registry 갱신

**Files:**
- Create: `lib/adapters/naver-ad.ts`
- Modify: `lib/adapters/_registry.ts`

**Interfaces:**
- Consumes:
  - `ChannelAdapter`, `CredentialPayload`, `ValidateResult` from `./_types` (Task 1)
  - node `crypto.createHmac` (built-in)
  - `cafe24Adapter` (Plan 2), `smartstoreAdapter` (Task 2)
- Produces:
  - `naverAdAdapter: ChannelAdapter` 객체
  - `_registry.ts`의 `adapters` 맵에 `cafe24` + `smartstore` + `naver_ad` 모두 등록됨

- [ ] **Step 1: `lib/adapters/naver-ad.ts` 작성**

```typescript
import 'server-only'
import { createHmac } from 'crypto'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
} from './_types'

const NAVERAD_BASE = 'https://api.searchad.naver.com'

function signHmac(
  method: string,
  uri: string,
  timestamp: string,
  secretKey: string
): string {
  return createHmac('sha256', secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest('base64')
}

function buildPayload(formValues: Record<string, string>): CredentialPayload {
  return {
    customerId: formValues.customerId,
    accessLicense: formValues.accessLicense,
    secretKey: formValues.secretKey,
  }
}

async function validate(creds: CredentialPayload): Promise<ValidateResult> {
  const customerId = String(creds.customerId ?? '')
  const accessLicense = String(creds.accessLicense ?? '')
  const secretKey = String(creds.secretKey ?? '')
  if (!customerId || !accessLicense || !secretKey) {
    return { ok: false, error: 'customerId/accessLicense/secretKey 필드 누락' }
  }

  const uri = '/ncc/campaigns'
  const timestamp = Date.now().toString()
  const signature = signHmac('GET', uri, timestamp, secretKey)

  let r: Response
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
    const msg = e instanceof Error ? e.message : 'network error'
    return { ok: false, error: `네이버광고 호출 실패: ${msg}` }
  }

  if (r.ok) return { ok: true }
  if (r.status === 401 || r.status === 403) {
    return {
      ok: false,
      error: '키가 유효하지 않습니다. customer_id / access license / secret key 확인',
    }
  }
  const text = await r.text().catch(() => '')
  return { ok: false, error: `네이버광고 API 에러 (${r.status}): ${text.slice(0, 200)}` }
}

export const naverAdAdapter: ChannelAdapter = {
  channel: 'naver_ad',
  category: 'ad',
  authType: 'api_key',
  credentialFields: [
    {
      key: 'accountLabel',
      label: '계정 이름 (별칭)',
      placeholder: '예: 주력광고계정',
    },
    {
      key: 'customerId',
      label: 'Customer ID',
      placeholder: '숫자',
      hint: '네이버광고 우측 상단 표시',
    },
    {
      key: 'accessLicense',
      label: 'Access License',
    },
    {
      key: 'secretKey',
      label: 'Secret Key',
      secret: true,
    },
  ],
  buildPayload,
  validate,
}
```

- [ ] **Step 2: `lib/adapters/_registry.ts` 갱신**

전체 파일을 다음으로 교체:

```typescript
import 'server-only'
import type { ChannelAdapter } from './_types'
import { cafe24Adapter } from './cafe24'
import { smartstoreAdapter } from './smartstore'
import { naverAdAdapter } from './naver-ad'

const adapters: Record<string, ChannelAdapter> = {
  cafe24: cafe24Adapter,
  smartstore: smartstoreAdapter,
  naver_ad: naverAdAdapter,
}

export function getAdapter(channel: string): ChannelAdapter | undefined {
  return adapters[channel]
}

export function listEnabledChannels(): string[] {
  return Object.keys(adapters)
}
```

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 타입 에러 없음. 세 어댑터 모두 등록됨.

- [ ] **Step 4: 커밋**

```powershell
git add lib/adapters/naver-ad.ts lib/adapters/_registry.ts
git commit -m "feat(adapters): naver-ad 어댑터 (HMAC 서명) + registry에 smartstore/naver_ad 등록"
git push
```

---

### Task 4: connections 메인 페이지 카드 활성화

**Files:**
- Modify: `app/(dashboard)/brands/[brandId]/settings/connections/page.tsx`

**Interfaces:**
- Consumes: Plan 2의 `ChannelCard` 컴포넌트 (이미 같은 파일에 정의됨, `available: boolean` prop 지원)
- Produces: 스마트스토어/네이버광고 카드가 active 상태가 됨. 사용자가 "+ ... 계정 추가" 클릭 시 `/brands/[id]/settings/connections/smartstore/new` 또는 `/naver_ad/new`로 이동 가능

- [ ] **Step 1: 기존 ChannelCard 호출부 찾기**

`app/(dashboard)/brands/[brandId]/settings/connections/page.tsx`에서 다음 두 곳 찾기:

```tsx
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
```

- [ ] **Step 2: `available={false}` → `available`로 변경**

```tsx
<ChannelCard
  title="스마트스토어"
  channelKey="smartstore"
  brandId={brand.id}
  credentials={credsByChannel['smartstore'] ?? []}
  available
/>
<ChannelCard
  title="네이버광고"
  channelKey="naver_ad"
  brandId={brand.id}
  credentials={credsByChannel['naver_ad'] ?? []}
  available
/>
```

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 빌드 성공.

- [ ] **Step 4: 수동 검증 (선택, 로컬)**

```powershell
npm run dev
```

시크릿 창에서 로그인 → 팔레오 → /settings/connections 진입 → 스마트스토어/네이버광고 카드가 활성 상태로 표시. "+ 스마트스토어 계정 추가" 버튼이 활성. 클릭 시 `/smartstore/new`로 이동 → 404 (Task 5에서 만듦. OK).

`Ctrl+C`로 dev 종료.

- [ ] **Step 5: 커밋**

```powershell
git add "app/(dashboard)/brands/[brandId]/settings/connections/page.tsx"
git commit -m "feat(connections): smartstore/naver_ad 카드 활성화"
git push
```

---

### Task 5: `[channel]/new` 동적 폼 페이지

**Files:**
- Create: `app/(dashboard)/brands/[brandId]/settings/connections/[channel]/new/page.tsx`

**Interfaces:**
- Consumes:
  - `createServerClient()` (Plan 1)
  - `getAdapter()` (Task 3)
  - `Button`, `Input`, `Label`, `Card` (shadcn — Plan 1)
- Produces:
  - `/brands/[brandId]/settings/connections/smartstore/new` + `/naver_ad/new` 페이지 — 어댑터의 `credentialFields` 기반 동적 폼
  - cafe24 channel param이 들어오면 next.js의 명시적 폴더가 우선 매칭되어 Plan 2 페이지로 이동 (이 동적 페이지는 안 들름)
  - 어댑터 없거나 `authType !== 'api_key'`면 `notFound()`
  - 폼 action: `POST /api/credentials/${channel}/register` (Task 6에서 만듦)

- [ ] **Step 1: 디렉토리 생성**

```powershell
New-Item -ItemType Directory -Path "C:\Users\Jangkwon\Desktop\order-manager-saas\app\(dashboard)\brands\[brandId]\settings\connections\[channel]\new" -Force
```

- [ ] **Step 2: `page.tsx` 작성**

전체 파일:

```tsx
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getAdapter } from '@/lib/adapters/_registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const CHANNEL_TITLES: Record<string, string> = {
  smartstore: '스마트스토어',
  naver_ad: '네이버광고',
}

const CHANNEL_GUIDES: Record<string, { lines: string[]; link?: { href: string; label: string } }> = {
  smartstore: {
    lines: [
      'naver commerce 개발자센터(commerce.naver.com)에 로그인 → 앱 등록',
      '발급된 Client ID와 Client Secret을 아래 입력',
      'SaaS는 client_credentials grant로 매번 토큰을 새로 발급하므로 IP 등록 불필요',
    ],
    link: { href: 'https://apicenter.commerce.naver.com/', label: 'naver commerce 개발자센터' },
  },
  naver_ad: {
    lines: [
      '네이버광고(searchad.naver.com) 로그인 → 도구 → API 관리',
      'Customer ID, Access License, Secret Key 발급',
      '서명 방식 인증이라 IP 등록 불필요',
    ],
    link: { href: 'https://searchad.naver.com/customers/api', label: '네이버광고 API 관리' },
  },
}

export default async function NewApiKeyCredentialPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string; channel: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { brandId, channel } = await params
  const sp = await searchParams

  const adapter = getAdapter(channel)
  if (!adapter || adapter.authType !== 'api_key' || !adapter.credentialFields) {
    notFound()
  }

  const supabase = await createServerClient()
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('id', brandId)
    .single()

  if (!brand) notFound()

  const title = CHANNEL_TITLES[channel] ?? channel
  const guide = CHANNEL_GUIDES[channel]

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {brand.name} — {title} 계정 추가
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {guide && (
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-2">
              <p className="font-medium">사전 준비</p>
              <ol className="list-decimal space-y-1 pl-5">
                {guide.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
              {guide.link && (
                <p>
                  <a
                    href={guide.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {guide.link.label} 바로가기
                  </a>
                </p>
              )}
            </div>
          )}

          {sp.error && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              ⚠️ {decodeURIComponent(sp.error)}
            </div>
          )}

          <form
            action={`/api/credentials/${channel}/register`}
            method="POST"
            className="space-y-4"
          >
            <input type="hidden" name="brand_id" value={brand.id} />

            {adapter.credentialFields!.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  name={field.key}
                  type={field.secret ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  required
                  autoComplete="off"
                />
                {field.hint && (
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                )}
              </div>
            ))}

            <Button type="submit" className="w-full">
              검증 후 등록
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 새 라우트 `/brands/[brandId]/settings/connections/[channel]/new`가 빌드 출력에 추가. 타입 에러 없음.

- [ ] **Step 4: 수동 검증 (선택, 로컬)**

```powershell
npm run dev
```

시크릿 창: 로그인 → 팔레오 → /settings/connections → "+ 스마트스토어 계정 추가" 클릭 → 동적 폼 페이지 진입.

확인:
- 안내 박스에 3줄 + naver commerce 개발자센터 링크
- 폼 4개 필드 (accountLabel, clientId, clientSecret)
- "검증 후 등록" 버튼 — 누르면 `/api/credentials/smartstore/register` POST → 404 (Task 6에서 만듦. OK)

같은 흐름으로 네이버광고도 확인 — 폼 5개 필드 + 안내 박스.

다른 시도: `/brands/[id]/settings/connections/cafe24/new` 직접 입력 → Plan 2의 cafe24 페이지가 떠야 함 (명시적 폴더 우선). `/[channel]/new`가 이 URL 가로채면 안 됨.

또 다른 시도: `/brands/[id]/settings/connections/unknown/new` → notFound() → 404 표시.

`Ctrl+C`로 dev 종료.

- [ ] **Step 5: 커밋**

```powershell
git add "app/(dashboard)/brands/[brandId]/settings/connections/[channel]/new/page.tsx"
git commit -m "feat(connections): API 키 매체용 [channel]/new 동적 폼 페이지"
git push
```

---

### Task 6: `POST /api/credentials/[channel]/register` endpoint

**Files:**
- Create: `app/api/credentials/[channel]/register/route.ts`

**Interfaces:**
- Consumes:
  - `createServerClient()` (Plan 1)
  - `createAdminClient()` (Plan 2)
  - `getAdapter()` (Task 3)
- Produces:
  - `POST /api/credentials/[channel]/register` — body(formData): `brand_id`, `accountLabel`, 그리고 어댑터별 credentialFields key의 값들. → buildPayload → validate → vault.create_secret → brand_credentials INSERT → 303 redirect

- [ ] **Step 1: 디렉토리 생성**

```powershell
New-Item -ItemType Directory -Path "C:\Users\Jangkwon\Desktop\order-manager-saas\app\api\credentials\[channel]\register" -Force
```

- [ ] **Step 2: `route.ts` 작성**

전체 파일:

```typescript
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdapter } from '@/lib/adapters/_registry'

function errorRedirect(
  reqUrl: URL,
  brandId: string | null,
  channel: string,
  message: string
) {
  const target = brandId
    ? `/brands/${brandId}/settings/connections/${channel}/new?error=${encodeURIComponent(message)}`
    : `/brands?error=${encodeURIComponent(message)}`
  return NextResponse.redirect(new URL(target, reqUrl), { status: 303 })
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ channel: string }> }
) {
  const { channel } = await ctx.params
  const reqUrl = new URL(request.url)

  const form = await request.formData()
  const brandId = String(form.get('brand_id') ?? '').trim()
  const accountLabel = String(form.get('accountLabel') ?? '').trim()

  if (!brandId) {
    return NextResponse.redirect(
      new URL('/brands?error=invalid_brand', reqUrl),
      { status: 303 }
    )
  }
  if (!accountLabel) {
    return errorRedirect(reqUrl, brandId, channel, '계정 이름 (별칭)을 입력해주세요')
  }

  const adapter = getAdapter(channel)
  if (!adapter || adapter.authType !== 'api_key' || !adapter.buildPayload || !adapter.credentialFields) {
    return errorRedirect(reqUrl, brandId, channel, '지원하지 않는 매체입니다')
  }

  // 인증 + brand 소유 검증
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', reqUrl), { status: 303 })
  }
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('id', brandId)
    .single()
  if (!brand) {
    return errorRedirect(reqUrl, null, channel, '브랜드를 찾을 수 없습니다')
  }

  // 어댑터의 credentialFields key별 formData 추출 (accountLabel 제외)
  const formValues: Record<string, string> = {}
  for (const field of adapter.credentialFields) {
    if (field.key === 'accountLabel') continue
    const v = String(form.get(field.key) ?? '').trim()
    if (!v) {
      return errorRedirect(reqUrl, brandId, channel, `${field.label} 필드를 입력해주세요`)
    }
    formValues[field.key] = v
  }

  // payload 빌드 + 즉시 검증
  const payload = adapter.buildPayload(formValues)
  const v = await adapter.validate(payload)
  if (!v.ok) {
    return errorRedirect(reqUrl, brandId, channel, v.error)
  }

  // Vault + brand_credentials INSERT
  const admin = createAdminClient()

  const { data: secretId, error: vaultErr } = await admin.rpc('create_vault_secret', {
    secret: JSON.stringify(payload),
    name: `${channel}:${brandId}:${accountLabel}`,
    description: `${brand.name} / ${accountLabel}`,
  })
  if (vaultErr || !secretId) {
    return errorRedirect(
      reqUrl,
      brandId,
      channel,
      `Vault 저장 실패: ${vaultErr?.message ?? 'unknown'}`
    )
  }

  const { error: insertErr } = await admin.from('brand_credentials').insert({
    brand_id: brandId,
    channel,
    channel_account: accountLabel,
    secret_id: secretId,
    status: 'active',
    metadata: {},
  })

  if (insertErr) {
    const msg =
      insertErr.code === '23505'
        ? '이 별칭은 같은 브랜드에 이미 등록되어 있습니다'
        : `자격증명 저장 실패: ${insertErr.message}`
    // best-effort: 방금 만든 vault secret 정리 (Plan 2의 delete wrapper 재사용)
    await admin.rpc('delete_vault_secret', { secret_id: secretId })
    return errorRedirect(reqUrl, brandId, channel, msg)
  }

  // 성공 → connections 페이지로
  return NextResponse.redirect(
    new URL(
      `/brands/${brandId}/settings/connections?connected=${encodeURIComponent(`${channel}:${accountLabel}`)}`,
      reqUrl
    ),
    { status: 303 }
  )
}
```

- [ ] **Step 3: 빌드 확인**

```powershell
npm run build
```

기대: 새 라우트 `/api/credentials/[channel]/register` (POST)가 빌드 출력에 추가. 타입 에러 없음.

- [ ] **Step 4: 수동 검증 (선택, 로컬)**

```powershell
npm run dev
```

시크릿 창에서 로그인 → 팔레오 → /settings/connections → "+ 스마트스토어 계정 추가" → 폼 입력.

빠른 부정 검증:
- accountLabel만 입력하고 clientId 비우면 — 폼의 `required` HTML attribute가 client-side에서 막음
- 모든 필드 입력 + 잘못된 clientSecret → submit → 카페24 페이지처럼 에러 메시지 + 같은 폼으로 redirect 확인

정상 검증 시도(검증 실제 키 사용)는 Task 7에서 진행.

`Ctrl+C`로 종료.

- [ ] **Step 5: 커밋**

```powershell
git add "app/api/credentials/[channel]/register/route.ts"
git commit -m "feat(credentials): POST /api/credentials/[channel]/register (buildPayload + validate + Vault + INSERT)"
git push
```

---

### Task 7: 통합 수동 검증 (로컬 + 프로덕션)

**Files:**
- 외부 작업 (브라우저 + Supabase SQL Editor)

**Interfaces:**
- Produces: 스마트스토어 + 네이버광고 두 매체의 자격증명이 운영자 본인 키로 등록·검증·해제까지 전 흐름 통과. 프로덕션 검증 완료.

이 task는 모두 사용자가 수동으로 진행. subagent로 자동화 불가능 (실제 본인 mall/광고 계정 자격증명 + Supabase SQL Editor + 브라우저 작업).

- [ ] **Step 1: 로컬 dev 서버 — 스마트스토어 검증**

```powershell
npm run dev
```

시크릿 창에서:
1. 로그인 (`ssakwon@kbh.kr`)
2. 팔레오 또는 새 임시 브랜드 (`/brands/new`로 "Plan 3 검증" 추가) 선택
3. `/settings/connections` → "+ 스마트스토어 계정 추가"
4. 입력:
   - 계정 이름 (별칭): `테스트스토어`
   - Client ID: 본인 naver commerce 발급 값
   - Client Secret: 본인 secret
5. "검증 후 등록" → 자동 이동된 connections에 `✅ smartstore:테스트스토어 연결되었습니다` 배너

Supabase SQL Editor 검증 (3 쿼리):

```sql
SELECT channel, channel_account, status, secret_id IS NOT NULL AS has_secret
FROM brand_credentials
WHERE channel = 'smartstore' ORDER BY created_at DESC LIMIT 1;

SELECT name, description FROM vault.secrets WHERE name LIKE 'smartstore:%' ORDER BY created_at DESC LIMIT 1;

SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name LIKE 'smartstore:%' ORDER BY created_at DESC LIMIT 1;
```

기대:
- 1번: channel=`smartstore`, channel_account=`테스트스토어`, status=`active`, has_secret=`true`
- 2번: name=`smartstore:{brand_id}:테스트스토어`
- 3번: payload JSON에 `clientId`, `clientSecret` 2개 필드

- [ ] **Step 2: 로컬 — 부정 검증 (스마트스토어)**

같은 페이지에서 "+ 스마트스토어 계정 추가" → 별칭 `오류테스트` + 잘못된 clientSecret 입력 → 등록.

기대: 빨간 ⚠️ 배너에 "Client ID 또는 Secret이 올바르지 않습니다" + `brand_credentials` INSERT 안 됨 (위 1번 쿼리 결과 변화 없음).

- [ ] **Step 3: 로컬 — 같은 별칭 중복 등록 시도**

`테스트스토어` 별칭으로 같은 값 한 번 더 등록 → "이 별칭은 같은 브랜드에 이미 등록되어 있습니다" 표시.

- [ ] **Step 4: 로컬 — 네이버광고 검증**

같은 브랜드 → "+ 네이버광고 계정 추가":
- 계정 이름: `테스트광고계정`
- Customer ID: 본인 customer_id (숫자)
- Access License: 본인 access_license
- Secret Key: 본인 secret_key

등록 → `✅ naver_ad:테스트광고계정 연결되었습니다`.

SQL 검증:

```sql
SELECT channel, channel_account, status, secret_id IS NOT NULL AS has_secret
FROM brand_credentials WHERE channel = 'naver_ad' ORDER BY created_at DESC LIMIT 1;

SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name LIKE 'naver_ad:%' ORDER BY created_at DESC LIMIT 1;
```

기대:
- 1번: 1행 — naver_ad / 테스트광고계정 / active / true
- 2번: payload에 `customerId`, `accessLicense`, `secretKey` 3개 필드

- [ ] **Step 5: 로컬 — 네이버광고 부정 검증**

잘못된 secretKey 입력 → "키가 유효하지 않습니다" 표시 + INSERT 안 됨.

- [ ] **Step 6: 로컬 — 자격증명 해제 (✕) 검증**

connections 페이지에서 등록된 스마트스토어/네이버광고 행의 `✕` 버튼 클릭. 각각 정상 해제되어 카드에서 사라지는지 확인. SQL로:

```sql
SELECT channel, channel_account FROM brand_credentials
WHERE brand_id = '{검증용 brand id}' ORDER BY channel;
```

해제한 행이 없는지 확인.

`Ctrl+C`로 dev 종료.

- [ ] **Step 7: 프로덕션 — 자동 배포 확인**

Task 1~6의 커밋이 push되면 Vercel이 자동 빌드. Vercel Deployments에서 최신 배포 Ready 확인.

빌드 실패 시 로그 확인 (가능 원인: bcryptjs native bind 이슈 — 사실상 없음. pure JS).

- [ ] **Step 8: 프로덕션 — 같은 시나리오 반복 (압축)**

`https://order-manager-saas-bay.vercel.app`에 시크릿 창으로:
1. 운영자 로그인
2. 검증용 브랜드 → /settings/connections
3. 스마트스토어 등록 → ✅
4. 네이버광고 등록 → ✅
5. 두 자격증명 모두 ✕ 해제

SQL은 Step 1·4의 쿼리 재사용.

- [ ] **Step 9: cleanup (선택)**

검증용 임시 브랜드 만들었다면 정리:

```sql
DELETE FROM brands WHERE name IN ('Plan 3 검증', 'Plan 2 검증');
DELETE FROM vault.secrets WHERE id NOT IN (SELECT secret_id FROM brand_credentials WHERE secret_id IS NOT NULL);

SELECT COUNT(*) AS brand_credentials_count FROM brand_credentials;
SELECT COUNT(*) AS vault_secrets_count FROM vault.secrets;
```

기대 (검증 데이터만 있었다면): 둘 다 0.

- [ ] **Step 10: README 갱신 (선택)**

`README.md`에 Plan 3 끝 표시 또는 그대로 둠. Plan 2처럼 별도 갱신 없이 끝내도 OK. 갱신 없으면 커밋 없음.

---

## Plan 3 완료 기준 체크리스트

- [ ] `package.json`에 `bcryptjs` + `@types/bcryptjs` 추가
- [ ] `lib/adapters/_types.ts`에 `FieldDef` + `credentialFields?` + `buildPayload?` 추가
- [ ] `lib/adapters/smartstore.ts` — bcrypt 서명 + token endpoint validate
- [ ] `lib/adapters/naver-ad.ts` — HMAC 서명 + /ncc/campaigns validate
- [ ] `lib/adapters/_registry.ts`에 세 어댑터 모두 등록
- [ ] connections 메인 페이지의 스마트스토어/네이버광고 카드 `available={true}`
- [ ] `[channel]/new` 동적 폼 페이지 — credentialFields 기반 자동 렌더 + 안내 박스 + 에러 배너
- [ ] `POST /api/credentials/[channel]/register` — buildPayload + validate + Vault + INSERT + 23505 처리 + vault best-effort 정리
- [ ] 로컬 검증: 스마트스토어 ✅ 6개 시나리오 통과
- [ ] 로컬 검증: 네이버광고 ✅ 6개 시나리오 통과
- [ ] 로컬 검증: 부정 케이스 3개 통과 (스마트스토어 secret 오류, 네이버광고 secret_key 오류, 같은 별칭 중복)
- [ ] 프로덕션 검증: 두 매체 등록 + 해제 통과
- [ ] cleanup 후 brand_credentials/vault.secrets 정리

## Plan 3 이후 — Plan 4 준비

- pg_cron 잡 등록: active brand_credentials를 sync_jobs에 INSERT
- 카페24 가상서버 워커 (PM2) — sync_jobs polling + 어댑터 sync 메서드 호출
- 어댑터 인터페이스 확장: `refreshToken?`, `syncOrders?`, `syncAdStats?`, `syncProducts?`, `syncAdUnits?`
- 카페24 토큰 자동 refresh (호출 직전 expiresAt 체크)
- 스마트스토어 access_token 캐시 패턴 결정 (vault payload에 토큰 저장 vs 매번 발급)
- Vault decrypt RPC wrapper 추가 (`public.read_vault_secret(secret_id) returns text`)

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| bcryptjs를 Vercel Edge runtime에서 못 쓰는 경우 | Vercel은 기본 Node.js runtime이라 OK. Plan 3의 모든 어댑터/route는 명시적 runtime 지정 없음 = Node.js |
| 스마트스토어 token endpoint가 일시적 5xx 응답 | validate 결과 ok=false로 사용자에게 표시. 재시도는 다음 plan(sync 워커)에서 |
| 네이버광고 /ncc/campaigns가 0개 캠페인 반환 시 200 OK인지 401인지 매체 정책 변경 | 우리 코드는 r.ok로 판단. 200이면 통과, 401이면 키 오류 메시지 |
| 사용자가 같은 별칭으로 다른 브랜드에 등록 시 — 다른 brand_id라 UNIQUE 통과 (정상) | 다른 브랜드는 독립이라 의도된 동작. 같은 brand에 같은 별칭만 차단됨 |
| 사용자 입력 secret이 server log에 남음 | route.ts에서 console.log 없음. validate에서 fetch body를 직접 로깅 안 함. 다만 매체 측 error 메시지에 body 내용 일부가 들어올 수 있음 — text.slice(0, 200)로 제한 |
| `[channel]` 동적 route가 `cafe24/new`를 가로채면 OAuth 깨짐 | Next.js는 명시적 폴더(`cafe24/new`) 우선 매칭. 동적 `[channel]/new`는 다른 channel(`smartstore`, `naver_ad`)에만 동작 |
| 어댑터 register endpoint가 vault.create 후 INSERT 실패 시 vault에 orphan 남음 | 23505 등 INSERT 실패 시 `delete_vault_secret`으로 best-effort cleanup. 그래도 cleanup 실패 시 운영자가 주기적 `vault.secrets WHERE id NOT IN (...)` 쿼리로 정리 |
