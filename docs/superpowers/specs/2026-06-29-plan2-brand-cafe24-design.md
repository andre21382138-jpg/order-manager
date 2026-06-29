# Plan 2 — 브랜드 CRUD + 카페24 연동 디자인 문서

- **작성일**: 2026-06-29
- **상태**: 디자인 합의 완료 → 구현 계획 작성 예정
- **대상 레포**: `order-manager-saas` (`C:\Users\Jangkwon\Desktop\order-manager-saas`)
- **상위 spec**: [2026-06-29-order-manager-saas-design.md](./2026-06-29-order-manager-saas-design.md)
- **이전 plan**: [2026-06-29-foundation.md](../plans/2026-06-29-foundation.md) (Plan 1, 완료)

---

## 1. 배경과 범위

Plan 1로 인프라(Next.js 부트스트랩, 멀티테넌트 스키마 7개, RLS, 운영자 로그인, 빈 brands 페이지)가 완료된 상태. 운영자(`ssakwon@kbh.kr`)는 로그인해서 기존 brands 3개를 볼 수 있고, RLS 격리도 검증됨.

이 plan은 **사용자가 자기 손으로 브랜드를 만들고 카페24 mall을 연결해서 자격증명이 Vault에 안전하게 저장되고 즉시 유효성이 확인되는 흐름까지**를 다룬다.

### 범위 (In Scope)

1. **브랜드 Create + Read**
   - `/brands/new` — 이름 입력, 색상은 미리 정한 팔레트에서 자동 부여
   - `/brands` 목록 카드 UI 확장 (Plan 1의 빈 상태 + 등록된 brands 표시)
   - 헤더에 브랜드 스위처 (한 사용자 N 브랜드 지원)
2. **매체 연동 UI**
   - `/brands/[id]/settings/connections` — 카페24/스마트스토어/네이버광고 3개 카드 (스마트스토어·네이버광고는 "준비 중" 비활성 상태)
   - `/brands/[id]/settings/connections/cafe24/new` — mall_id + app_id + app_secret 입력 폼
   - 카페24 카드에 등록된 mall 목록 + "+ 카페24 계정 추가" 버튼 (한 브랜드 N 계정)
3. **카페24 OAuth 흐름**
   - 입력값 cookie 임시 보관 (CSRF nonce 포함) → 카페24 authorize URL로 redirect → callback에서 code 교환 → Vault 저장 → brand_credentials INSERT → 연결 페이지로 redirect
4. **Vault 자격증명 저장**
   - `lib/supabase/admin.ts`로 service_role 클라이언트
   - `vault.create_secret` RPC로 secret 저장, secret_id를 brand_credentials.secret_id에 INSERT
5. **카페24 validate (즉시 검증)**
   - 토큰 교환 직후 카페24 `GET /admin/store` 호출 → 200 OK 확인 후에만 brand_credentials INSERT
6. **어댑터 인터페이스 기반 설계**
   - `lib/adapters/_types.ts`에 ChannelAdapter 인터페이스 (Plan 2 시점 subset)
   - `lib/adapters/cafe24.ts`에 cafe24 어댑터 (getAuthUrl/handleCallback/validate)
   - `lib/adapters/_registry.ts`에 channel → adapter 매핑

### Out of Scope

| 항목 | 다룰 plan |
|---|---|
| 브랜드 수정/삭제 UI | 운영자 SQL로 처리. UI는 추후 plan |
| 스마트스토어 / 네이버광고 어댑터 + UI 활성 | Plan 3 |
| 동기화 워커 (pg_cron + sync_jobs + 어댑터 sync 메서드) | Plan 4 |
| 토큰 자동 refresh | Plan 4 (sync 워커 호출 직전) |
| 광고/주문 데이터 조회 화면 | Plan 5+ |
| 통합 ROAS 대시보드 | Plan 5+ |
| 운영자 admin 페이지 (외부 사용자 초대) | 별도 plan |
| 자동 테스트 인프라 | 검토 후 별도 plan |

---

## 2. 의사결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| 카페24 OAuth 모델 | 각자 앱 (사용자가 카페24 콘솔에서 자기 앱 등록 후 app_id/secret 입력) | 기존 3브랜드 컷오버 쉬움, 카페24 Public App 심사 회피, 외부 사용자도 자기 mall 운영자라 자조 가능 |
| validate 호출 위치 | 모두 Vercel API route에서 직접 외부 API 호출 | 기존 `api/cafe24.js`·`api/naver-ad.js`가 이미 Vercel에서 호출 중. 검증은 짧은 호출이라 가상서버 의존 불필요 |
| Plan 2 매체 범위 | 카페24만. 스마트스토어/네이버광고는 Plan 3 | 인증 메커니즘이 매체별로 완전 달라서 한 plan에 셋 넣으면 디버깅 부담 곱셈. 팔레오 카페24 베타가 첫 milestone |
| 브랜드 삭제/수정 | 운영자 SQL만. Plan 2엔 UI 없음 | 사용자 실수 한 번에 ROAS 이력 전체 삭제 위험. MVP에선 수요 적음 |
| 브랜드 추가 폼 | 이름만. 색상은 8~10개 팔레트에서 자동 부여 | 사용자에게 색 매번 묻는 건 귀찮음. 수정은 추후 |
| 다중 채널 · 다중 계정 | 한 브랜드 안에 카페24 mall 여러 개 등록 가능 (`channel_account` UNIQUE 키로 보장) | 팔레오 = 브랜드스토어 + 도깨비나라 등 실제 운영 케이스 |
| 브랜드 스위처 | 헤더에 포함 (Plan 2 작업) | 한 사용자 N 브랜드 모델이라 사실상 필수 |
| OAuth 상태 보관 | http-only · secure · sameSite=lax · 5분 만료 쿠키에 입력값 + CSRF nonce 저장 | DB 임시 행 없이 정리 자동. 쿠키 크기 한도 안 넘음 |
| 카페24 redirect_uri | `https://order-manager-saas-bay.vercel.app/auth/cafe24/callback` (프로덕션) + `http://localhost:3030/auth/cafe24/callback` (개발) | 사용자 카페24 앱 콘솔에 둘 다 등록 가이드 |

---

## 3. 화면 구조와 흐름

### 새 화면 4개

| 경로 | 역할 |
|---|---|
| `/brands/new` | 브랜드 추가 (이름 입력, 색상 자동) |
| `/brands/[brandId]` | 브랜드 상세 홈 (Plan 2엔 placeholder, 매체 연결로 가는 안내) |
| `/brands/[brandId]/settings/connections` | 매체 연동 (카페24 카드 활성, 다른 매체 "준비 중") |
| `/brands/[brandId]/settings/connections/cafe24/new` | 카페24 자격증명 입력 폼 |

### 헤더 브랜드 스위처 추가

기존 Plan 1 헤더:
```
[Order Manager SaaS]                    ssakwon@kbh.kr  [로그아웃]
```

Plan 2 헤더 (`/brands/[id]/...` 경로에서):
```
[Order Manager SaaS]  [● 팔레오 ▼]       ssakwon@kbh.kr  [로그아웃]
                       ├ ● 팔레오 ✓
                       ├ ● 코코엘
                       └ + 브랜드 추가
```

- `●`는 brand.color 색상 점
- 현재 brandId는 URL path에서 추출
- 스위처에서 다른 브랜드 클릭 시 같은 페이지의 brandId만 바꿔서 이동 (예: `/brands/A/settings/connections` → `/brands/B/settings/connections`)
- `/brands` 목록 페이지에는 스위처 표시 안 함 (그 자체가 목록)

### 매체 연동 화면 (`/settings/connections`)

```
[카페24]
─────────────────────────────────────
✅ paleo        🔄 -        [재인증] [✕]
✅ dokebi       🔄 -        [재인증] [✕]
[+ 카페24 계정 추가]

[스마트스토어]                              (준비 중)
[네이버광고]                                (준비 중)
```

- 등록된 brand_credentials를 channel별로 그룹화
- 각 행: `channel_account` (= mall_id), `last_synced_at` (현재는 NULL이라 `-`), 액션 버튼
- `[✕]`은 단일 자격증명 해제 (해당 brand_credentials 행 + Vault secret 삭제). 확인 모달 + 텍스트 재입력 강제
- `[재인증]`은 Plan 2 시점에선 일단 placeholder (작동 안 함, Plan 3 + 토큰 만료 시점에 의미. 또는 Plan 4)
- 스마트스토어/네이버광고 카드는 disabled 상태, "+ 계정 추가" 버튼 비활성

### 첫 사용자 흐름 (해피 패스)

```
로그인 → /brands (빈 상태)
   ↓ "+ 브랜드 추가" 클릭
/brands/new (이름만 입력)
   ↓ 저장 (color 자동 부여 + RLS owner_id = auth.uid())
/brands/[id]/settings/connections (카페24 카드 + "+ 계정 추가")
   ↓ "+ 카페24 계정 추가" 클릭
/brands/[id]/settings/connections/cafe24/new
   - 사전 안내: 카페24 콘솔에서 앱 등록 + redirect_uri 등록 가이드 (스크린샷 1장)
   - 폼: mall_id, app_id, app_secret
   ↓ "OAuth 시작"
서버: 입력 검증 + 쿠키 set + 카페24 authorize URL로 302
   ↓
카페24 동의 화면 → 사용자 동의
   ↓
서버: /auth/cafe24/callback?code=...&state=...&mall_id=...
   - 쿠키 nonce 검증
   - 카페24 token endpoint 호출 → access/refresh token
   - validate (GET /admin/store) → 200 확인
   - Vault create_secret + brand_credentials INSERT
   - 쿠키 삭제
   - 302 → /brands/[id]/settings/connections?connected=cafe24:{mall_id}
   ↓
UI: "✅ {mall_id} 연결됨" 토스트 + 카페24 카드에 새 행
```

---

## 4. API + 카페24 OAuth 흐름

### 새 API 엔드포인트

| 메서드/경로 | 책임 |
|---|---|
| `POST /api/brands` | 브랜드 INSERT (이름 받기, 색상 팔레트에서 자동 선택, owner_id = auth.uid()) |
| `POST /api/oauth/cafe24/start` | 입력값 받아 쿠키 set + 카페24 authorize URL로 303 See Other |
| `GET /auth/cafe24/callback` | OAuth 콜백 — code 교환 + validate + Vault + brand_credentials INSERT + redirect |

> 시작 endpoint를 POST + 303으로 한 이유: `app_secret`이 URL query에 들어가면 브라우저 히스토리·리퍼러에 노출됨. 폼 body로 받고 즉시 303으로 매체 authorize URL로 보냄.

### OAuth 단계별 동작

```
1. /brands/[id]/settings/connections/cafe24/new 폼 제출
   form action="POST /api/oauth/cafe24/start"
   body: brand_id, mall_id, app_id, app_secret
       ↓
2. /api/oauth/cafe24/start (Vercel API route):
   - 입력 4개 비어있는지 검증 (비어있으면 폼 페이지로 303 redirect, 에러는 cookie 또는 query에)
   - 인증된 사용자가 brand_id의 owner인지 RLS로 검증 (createServerClient → brands SELECT)
   - 32바이트 nonce 생성
   - redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/auth/cafe24/callback` 조립
   - 쿠키 set:
       name=cafe24_oauth
       value=signed({ brandId, mallId, appId, appSecret, nonce })
       httpOnly + secure + sameSite=lax + path=/auth/cafe24 + maxAge=300초
   - adapter.getAuthUrl({ appId, mallId, state: nonce, redirectUri }) 호출
   - 303 See Other → authorize URL
       ↓
3. 카페24 동의 화면 → 사용자 [동의]
       ↓
4. /auth/cafe24/callback?code=...&state={nonce}&mall_id=... (Vercel API route):
   - 쿠키 cafe24_oauth 복원 → nonce 비교 (CSRF 검증). 실패 시 /brands/[id]/settings/connections?error=oauth_state로 redirect
   - 쿠키 값에서 brandId/mallId/appId/appSecret 추출
   - adapter.handleCallback({ code, mallId, appId, appSecret, redirectUri }) 호출
     → { appId, appSecret, accessToken, refreshToken, expiresAt }
   - adapter.validate(payload) 호출 → ok 아니면 error로 redirect
   - createAdminClient()로:
       a. admin.rpc('create_secret', { new_secret: JSON.stringify(payload), new_name: `cafe24:${brandId}:${mallId}`, new_description: ... })
          → secretId
       b. admin.from('brand_credentials').insert({
            brand_id: brandId,
            channel: 'cafe24',
            channel_account: mallId,
            secret_id: secretId,
            status: 'active',
            metadata: { scope: SCOPES }
          })
          (UNIQUE 위반 시 catch → /brands/[id]/settings/connections?error=duplicate_account)
   - 쿠키 삭제 (`Set-Cookie: cafe24_oauth=; Max-Age=0`)
   - 302 to /brands/{brandId}/settings/connections?connected=cafe24:{mallId}
```

### 실패 케이스 매핑

| 케이스 | 처리 | 사용자가 보는 것 |
|---|---|---|
| 사용자가 카페24에서 거부 | `?error=access_denied` 콜백 | 연결 페이지에 "카페24 연결이 취소되었습니다" 토스트 |
| state nonce 불일치 | 콜백에서 차단 | "보안 검증 실패, 다시 시도해주세요" |
| state cookie 만료 (5분 초과) | 콜백에서 차단 | "시간이 초과되었습니다, 다시 시도해주세요" |
| 토큰 교환 실패 (app_id/secret 오타) | adapter.handleCallback throw | "app_id 또는 app_secret이 올바르지 않습니다" |
| validate 실패 (권한 부족) | adapter.validate ok=false | "토큰은 받았으나 권한이 부족합니다. scope 설정을 확인해주세요" |
| brand_credentials UNIQUE 위반 | INSERT catch | "이 mall은 이미 등록되어 있습니다" |
| Vault create_secret 실패 | catch | "자격증명 저장 실패. 다시 시도해주세요. 문제가 계속되면 운영자에게 문의" |

### 폼 → OAuth 시작 방식

`<form action="/api/oauth/cafe24/start" method="POST">`로 일반 form submit. body가 application/x-www-form-urlencoded로 전달. 서버는 받은 즉시 쿠키 set + 303 See Other로 카페24로 보냄. 브라우저 히스토리에 `app_secret`이 남지 않음.

입력 검증 실패는 폼 페이지로 303 redirect + 에러는 쿠키(`oauth_error`)에 한 번만 set, 페이지가 읽어서 표시 후 자동 만료.

### redirect_uri 결정

- 환경변수 `NEXT_PUBLIC_APP_URL` 사용 (Plan 1 Task 10에서 등록함)
  - 프로덕션: `https://order-manager-saas-bay.vercel.app/auth/cafe24/callback`
  - 개발: `http://localhost:3030/auth/cafe24/callback`
- 사용자가 카페24 앱 콘솔에 두 redirect_uri를 모두 등록 (개발·프로덕션 둘 다 쓸 거면)

---

## 5. Vault 통합

### service_role 클라이언트 (신규)

`lib/supabase/admin.ts`:

```typescript
import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
```

- `import 'server-only'`로 클라이언트 번들 유입 시 빌드 차단
- RLS bypass + Vault 접근 가능

### Vault payload 형식

```json
{
  "appId": "...",
  "appSecret": "...",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2026-06-29T15:00:00Z"
}
```

- `name`: `cafe24:{brand_id}:{mall_id}` (vault 대시보드에서 식별 가능)
- `description`: `{브랜드명} / {mall_id}`

### RPC 호출

생성:
```typescript
const admin = createAdminClient()
const { data: secretId, error } = await admin.rpc('create_secret', {
  new_secret: JSON.stringify(payload),
  new_name: `cafe24:${brandId}:${mallId}`,
  new_description: `${brandName} / ${mallId}`,
})
```

조회 (Plan 4 동기화 워커가 사용):
```typescript
const { data } = await admin
  .from('vault.decrypted_secrets')
  .select('decrypted_secret')
  .eq('id', secretId)
  .single()
const creds = JSON.parse(data.decrypted_secret)
```

### Plan 2 시작 전 사전 점검

운영자가 한 번 확인:

1. Supabase 대시보드 → Database → Extensions → `vault` 활성 여부
2. 검증 쿼리:
   ```sql
   SELECT extname FROM pg_extension WHERE extname IN ('pgsodium', 'vault');
   ```
   기대: 2행 반환

→ Plan 2의 Task 1 첫 step으로 명시.

---

## 6. 어댑터 인터페이스

### 디렉토리 (신규 3개 파일)

```
lib/adapters/
├── _types.ts          # ChannelAdapter 인터페이스
├── _registry.ts       # channel → adapter 매핑
└── cafe24.ts          # 카페24 어댑터
```

### `_types.ts` (Plan 2 시점 subset)

```typescript
import 'server-only'

export type Channel = 'cafe24' | 'smartstore' | 'naver_ad'
export type AuthType = 'oauth' | 'api_key'

export interface CredentialPayload {
  [key: string]: string | number | undefined
}

export interface ChannelAdapter {
  channel: Channel
  category: 'shop' | 'ad'
  authType: AuthType

  // OAuth 매체 — Plan 2 (cafe24)
  getAuthUrl?(input: {
    appId: string
    mallId: string
    state: string
    redirectUri: string
  }): string

  handleCallback?(input: {
    code: string
    mallId: string
    appId: string
    appSecret: string
    redirectUri: string
  }): Promise<CredentialPayload>

  // API 키 매체 — Plan 3 (smartstore, naver_ad)
  credentialFields?: { key: string; label: string; secret?: boolean }[]

  // 모든 매체 공통
  validate(creds: CredentialPayload): Promise<{ ok: true } | { ok: false; error: string }>
}
```

Plan 3에서 credentialFields 활성, Plan 4에서 refreshToken/syncOrders 등 추가.

### `cafe24.ts` 책임 3개

1. **`getAuthUrl`** — `https://{mallId}.cafe24api.com/api/v2/oauth/authorize?response_type=code&client_id={appId}&state={state}&redirect_uri={redirectUri}&scope={SCOPES}` 조립
2. **`handleCallback`** — `POST https://{mallId}.cafe24api.com/api/v2/oauth/token` (Basic auth `{appId}:{appSecret}`, body `grant_type=authorization_code&code={code}&redirect_uri={redirectUri}`) → `{ access_token, refresh_token, expires_at }` 받기
3. **`validate`** — `GET https://{mallId}.cafe24api.com/api/v2/admin/store` (Authorization: Bearer {accessToken}). 200이면 ok, 401이면 토큰 무효, 그 외 매체 측 에러

`SCOPES`는 기존 `c:\Users\Jangkwon\Desktop\order-manager\api\cafe24.js`에서 사용 중인 값 그대로 추출해서 사용 (plan 작성 단계에서 정확한 목록 확정).

### `_registry.ts`

```typescript
import 'server-only'
import type { ChannelAdapter } from './_types'
import { cafe24Adapter } from './cafe24'

const adapters: Record<string, ChannelAdapter> = {
  cafe24: cafe24Adapter,
}

export function getAdapter(channel: string): ChannelAdapter | undefined {
  return adapters[channel]
}
```

Plan 3에서 `smartstore`, `naver_ad` 추가만 하면 UI 활성.

### 분리 책임

| 책임 | 위치 |
|---|---|
| 외부 API 호출 (HTTP) | 어댑터 (`cafe24.ts`) |
| 토큰 교환 / 검증 호출 | 어댑터 |
| brand_credentials INSERT/SELECT | API route |
| Vault create_secret | API route |
| 쿠키 set/get | API route |
| 화면 redirect | API route |

→ 어댑터는 단위 테스트 가능 (fetch만 mock).

---

## 7. DB 변경 · 보안 가드레일 · 검증

### DB 변경

**없음.** Plan 1에서 만든 테이블에 INSERT/SELECT만. SQL 마이그레이션 파일 추가 없음.

### 보안 가드레일

| 위험 | 가드레일 |
|---|---|
| service_role 키가 클라이언트 번들에 들어감 | `lib/supabase/admin.ts`, `lib/adapters/*.ts` 상단에 `import 'server-only'` 추가 |
| 다른 사용자의 brand_id로 자격증명 INSERT 시도 | `/api/oauth/cafe24/start`와 `/auth/cafe24/callback`에서 createServerClient로 brand 소유 확인 후에만 admin 클라이언트 사용 |
| CSRF | OAuth 시작 시 nonce 생성 → 쿠키 → 콜백에서 비교. 5분 만료 |
| OAuth code 갈취 | 카페24 앱 콘솔의 redirect_uri 화이트리스트로 매체 측 보호. 사용자에게 등록 가이드 명시 |
| Vault payload 평문 로깅 | `console.log(creds)` 금지 — 에러 로그 시 필드별 마스킹 |
| `appSecret`/`accessToken` 응답 노출 | `/api/brands/[id]/credentials` 같은 조회 endpoint는 channel/channel_account/status/last_synced_at만 반환 |
| app_secret이 URL query에 노출 (히스토리/리퍼러) | OAuth 시작 form을 GET이 아닌 **POST → 303 redirect**로 |

### 검증 (Plan 2 완료 기준 시나리오)

운영자 본인이 보유한 카페24 mall 1개로 다음 7개 확인:

1. ✅ `brand_credentials` 행 1개 INSERT (`channel='cafe24'`, `channel_account=mallId`, `secret_id` not null, `status='active'`)
2. ✅ `vault.secrets` 행 1개 (`name='cafe24:{brandId}:{mallId}'`)
3. ✅ `vault.decrypted_secrets`로 payload 조회 → appId/appSecret/accessToken/refreshToken/expiresAt 모두 있음
4. ✅ UI: 카페24 카드에 ✅ mall_id 행 표시
5. ✅ validate 단독 호출 → 그 secret으로 카페24 store API 호출 200
6. ✅ 부정 검증: 잘못된 app_secret으로 시도 → 토큰 교환 실패 → brand_credentials INSERT 안 됨 + UI 에러 메시지
7. ✅ RLS 격리: 시크릿 창에서 다른 사용자로 로그인 → 같은 brand_id로 callback 시도 → 403 + INSERT 차단

---

## 8. 위험과 완화

| 위험 | 완화 |
|---|---|
| 사용자가 카페24 redirect_uri 등록 단계 빠뜨림 | 등록 가이드 스크린샷 1장 + redirect_uri 복사 버튼을 입력 폼 옆에 |
| OAuth 도중 사용자가 창 닫음 → 쿠키 만료 → 재시도 시 다시 입력 | 입력값이 쿠키에만 있으므로 자동 정리. UX 비용은 한 번 더 입력 |
| Vault에 토큰 저장 후 sync 워커가 없어 데이터 안 들어옴 | `last_synced_at = NULL`. 카드에 "아직 데이터 수집 안 됨, Plan 4 활성 후 시작" 안내 |
| 사용자가 같은 mall_id를 같은 brand에 두 번 등록 | DB UNIQUE 위반 → catch → "이미 등록된 계정입니다" |
| 카페24 토큰 만료 (2시간) — Plan 2엔 refresh 없음 | Plan 2 검증 직후엔 OK. 2시간 후 validate 재호출하면 401. Plan 4에서 자동 refresh. 그 사이엔 사용자가 "재인증" 버튼 (Plan 3+) |
| 카페24 scope 부족 | validate 실패 메시지에 "scope 확인" 안내. 사용자가 카페24 앱 콘솔에서 scope 추가 후 재연동 |

---

## 9. 산출물 (코드 변경 요약)

### 신규 파일

| 파일 | 역할 |
|---|---|
| `lib/supabase/admin.ts` | service_role 클라이언트 |
| `lib/adapters/_types.ts` | ChannelAdapter 인터페이스 |
| `lib/adapters/_registry.ts` | channel → adapter 매핑 |
| `lib/adapters/cafe24.ts` | 카페24 어댑터 |
| `components/brand-switcher.tsx` | 헤더 브랜드 드롭다운 |
| `app/(dashboard)/brands/new/page.tsx` | 브랜드 추가 폼 |
| `app/(dashboard)/brands/[brandId]/page.tsx` | 브랜드 상세 holder |
| `app/(dashboard)/brands/[brandId]/settings/connections/page.tsx` | 매체 연동 메인 |
| `app/(dashboard)/brands/[brandId]/settings/connections/cafe24/new/page.tsx` | 카페24 자격증명 입력 |
| `app/api/brands/route.ts` | POST 브랜드 생성 |
| `app/api/oauth/cafe24/start/route.ts` | OAuth 시작 (POST → 303) |
| `app/auth/cafe24/callback/route.ts` | OAuth 콜백 |
| `lib/brand-colors.ts` | 8~10개 색상 팔레트 + 자동 부여 함수 |

### 변경 파일

| 파일 | 변경 |
|---|---|
| `components/header.tsx` | 브랜드 스위처 추가 |
| `app/(dashboard)/brands/page.tsx` | 등록된 brands 카드 UI 강화, 색상 점, 클릭 시 `/brands/[id]` 이동 |

### DB 변경

**없음.** 사전 점검(vault extension)만 필요.

---

## 10. 다음 단계

이 spec이 사용자 리뷰 후 확정되면 `writing-plans` 스킬로 넘어가 Task 단위 구현 계획을 작성한다. 예상 Task 흐름:

1. 사전 점검 — vault extension 활성 확인
2. service_role 클라이언트 + 어댑터 인터페이스 + cafe24 어댑터
3. 브랜드 색상 팔레트 + POST /api/brands + /brands/new 폼
4. 헤더 브랜드 스위처
5. 매체 연동 목록 페이지 + 카페24 카드 UI
6. 카페24 자격증명 입력 폼 (POST → /api/oauth/cafe24/start)
7. /api/oauth/cafe24/start (쿠키 + redirect)
8. /auth/cafe24/callback (token 교환 + validate + Vault + INSERT)
9. 운영자 본인이 실제 mall로 7개 검증 시나리오 통과
10. Vercel 배포 + 프로덕션 검증

자세한 task 분할/의존성/검증 방법은 plan 문서에서.
