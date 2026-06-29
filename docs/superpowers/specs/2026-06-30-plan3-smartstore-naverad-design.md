# Plan 3 — 스마트스토어 + 네이버광고 어댑터 디자인 문서

- **작성일**: 2026-06-30
- **상태**: 디자인 합의 완료 → 구현 계획 작성 예정
- **대상 레포**: `order-manager-saas` (`C:\Users\Jangkwon\Desktop\order-manager-saas`)
- **상위 spec**: [2026-06-29-order-manager-saas-design.md](./2026-06-29-order-manager-saas-design.md)
- **이전 plan**: [2026-06-29-plan2-brand-cafe24-design.md](./2026-06-29-plan2-brand-cafe24-design.md) (Plan 2, 완료)

---

## 1. 배경과 범위

Plan 2로 카페24 OAuth + Vault wrapper + brand_credentials INSERT + connections UI 패턴이 검증 완료. Plan 3은 그 인프라 위에 **스마트스토어(naver commerce)와 네이버광고(searchad) 어댑터를 같은 패턴으로 추가**한다. 두 매체 모두 OAuth가 아닌 API 키 인증 방식이라, 어댑터 인터페이스를 `credentialFields` + `buildPayload`로 확장하고 UI는 동적 폼 페이지 하나로 통합한다.

### 범위 (In Scope)

1. **어댑터 인터페이스 확장** — `ChannelAdapter`에 `credentialFields: FieldDef[]`와 `buildPayload(formValues): CredentialPayload` 추가 (옵셔널). cafe24는 영향 없음.
2. **스마트스토어 어댑터** — client_credentials + bcrypt 서명으로 validate
3. **네이버광고 어댑터** — HMAC-SHA256 서명으로 매 호출, validate
4. **동적 폼 페이지** — `/brands/[id]/settings/connections/[channel]/new`가 어댑터의 `credentialFields`를 읽어 폼 자동 렌더링. cafe24는 기존 `/cafe24/new` 그대로 유지.
5. **register endpoint** — `POST /api/credentials/[channel]/register` — buildPayload + validate + Vault create + brand_credentials INSERT
6. **connections 카드 활성화** — 스마트스토어/네이버광고 카드를 "준비 중" → 활성으로
7. **새 의존성** — `bcryptjs` (스마트스토어 서명용)

### Out of Scope

| 항목 | 다룰 plan |
|---|---|
| 동기화 워커 (pg_cron + sync_jobs + 어댑터 sync 메서드) | Plan 4 |
| 스마트스토어 access_token 캐싱·재발급 (validate 결과 사용 안 함) | Plan 4 sync 시점에 패턴 결정 |
| 토큰 자동 refresh | Plan 4 |
| 광고/주문 데이터 조회 화면 | Plan 5+ |
| 추가 매체 (Google Ads, Meta, 쿠팡, 모비온) | Phase 2+ 매체 롤아웃 |
| 자동 테스트 인프라 | 검토 후 별도 plan |

---

## 2. 의사결정 요약

| 항목 | 결정 | 이유 |
|---|---|---|
| `channel_account` 입력 방식 | 사용자 별칭 폼 필드 (`accountLabel`) | 기존 STORE_CRED_ALIAS도 "브랜드스토어"/"도깨비나라" 패턴. client_id/customer_id는 가독성 떨어짐 |
| 어댑터 인터페이스 | `credentialFields` + `buildPayload` 메서드 추가 (옵셔널) | OAuth용 메서드와 분리. cafe24는 영향 없음 |
| UI 라우트 | cafe24는 기존 페이지 유지, smartstore/naver_ad는 `/[channel]/new` 동적 통합 | 매체별 페이지 중복 회피. 신규 API 키 매체는 어댑터에 fields만 추가 |
| register endpoint | `POST /api/credentials/[channel]/register` | channel을 URL path로. cafe24의 OAuth flow와 namespace 분리 |
| 폼 실패 시 입력값 복원 | 안 함 (재입력) | 폼 4개 필드 정도라 UX 비용 가볍고 코드 단순 |
| 스마트스토어 access_token vault 저장 | 저장 안 함 — Plan 3는 raw credentials만 | Plan 4에서 sync 시 매번 발급. 일관성은 Plan 4에서 결정 |
| 네이버광고 토큰 개념 | 없음 (서명만) | API 정책상 토큰 발급 없음 — secretKey 매 요청 HMAC |
| bcrypt 라이브러리 | `bcryptjs` (pure JS) | Vercel 빌드 호환. native bcrypt는 Edge 환경 이슈 가능 |
| HMAC 라이브러리 | node 내장 `crypto.createHmac` | 추가 의존성 없음 |

---

## 3. 어댑터 인터페이스 확장

### `_types.ts` 변경

```typescript
import 'server-only'

export type Channel = 'cafe24' | 'smartstore' | 'naver_ad'
export type AuthType = 'oauth' | 'api_key'

export interface CredentialPayload {
  [key: string]: string | number | undefined
}

export interface GetAuthUrlInput { /* Plan 2 그대로 */ }
export interface HandleCallbackInput { /* Plan 2 그대로 */ }
export type ValidateResult = { ok: true } | { ok: false; error: string }

// ★ 신규
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

  // API 키 매체 (smartstore, naver_ad) — Plan 3 ★ 신규
  credentialFields?: FieldDef[]
  buildPayload?(formValues: Record<string, string>): CredentialPayload

  // 공통
  validate(creds: CredentialPayload): Promise<ValidateResult>
}
```

cafe24 어댑터는 `credentialFields`/`buildPayload`가 옵셔널이라 변경 없음. Plan 4에서 `refreshToken`/`syncOrders` 등이 같은 패턴으로 추가될 수 있다.

---

## 4. 스마트스토어 어댑터

### 인증 흐름 (validate)

```
사용자 입력: clientId, clientSecret
  ↓
bcrypt 서명 생성:
  password = `${clientId}_${timestamp_ms}`
  hashed   = bcrypt.hashSync(password, clientSecret)
  sign     = Buffer.from(hashed).toString('base64')
  ↓
POST https://api.commerce.naver.com/external/v1/oauth2/token
  Content-Type: application/x-www-form-urlencoded
  body: client_id=...&timestamp=...&client_secret_sign=...&grant_type=client_credentials&type=SELF
  ↓
응답:
  200 + { access_token, expires_in } → ok
  400/401 → ok=false, "Client ID 또는 Secret이 올바르지 않습니다"
  기타 → ok=false, "스마트스토어 API 에러 ({status})"
```

### credentialFields

```typescript
[
  { key: 'accountLabel',  label: '계정 이름 (별칭)', placeholder: '예: 메인스토어', hint: '이 SaaS에서 식별용. 매체 ID 아님.' },
  { key: 'clientId',      label: 'Client ID' },
  { key: 'clientSecret',  label: 'Client Secret', secret: true },
]
```

### buildPayload

`accountLabel`은 `brand_credentials.channel_account`에 들어가므로 Vault payload에서 제외:

```typescript
buildPayload(formValues) {
  return {
    clientId: formValues.clientId,
    clientSecret: formValues.clientSecret,
  }
}
```

---

## 5. 네이버광고 어댑터

### 인증 흐름 (validate)

```
사용자 입력: customerId, accessLicense, secretKey
  ↓
HMAC 서명 생성:
  message   = `${timestamp}.${method}.${uri}`
  signature = HMAC-SHA256(secretKey, message).base64
  ↓
GET https://api.searchad.naver.com/ncc/campaigns
  Headers:
    X-Timestamp: {timestamp}
    X-API-KEY:   {accessLicense}
    X-Customer:  {customerId}
    X-Signature: {signature}
  ↓
응답:
  200 → ok (빈 배열이어도 OK — 캠페인 0개 마찬가지 200)
  401 → ok=false, "키가 유효하지 않습니다"
  기타 → ok=false, "네이버광고 API 에러 ({status})"
```

### credentialFields

```typescript
[
  { key: 'accountLabel',  label: '계정 이름 (별칭)', placeholder: '예: 주력광고계정' },
  { key: 'customerId',    label: 'Customer ID', placeholder: '숫자', hint: '네이버광고 우측 상단 표시' },
  { key: 'accessLicense', label: 'Access License' },
  { key: 'secretKey',     label: 'Secret Key', secret: true },
]
```

### buildPayload

```typescript
buildPayload(formValues) {
  return {
    customerId: formValues.customerId,
    accessLicense: formValues.accessLicense,
    secretKey: formValues.secretKey,
  }
}
```

---

## 6. UI 라우트 + 동적 폼

### 라우트 구조 (Plan 3 후)

```
app/(dashboard)/brands/[brandId]/settings/connections/
├── page.tsx                       # Plan 2 — 매체 카드 3개 (모두 활성으로 변경)
├── cafe24/new/page.tsx            # Plan 2 — OAuth 흐름 그대로
└── [channel]/new/page.tsx         # ★ 신규 — API 키 매체 동적 폼
```

`cafe24/new`가 명시적 폴더라 라우팅에서 우선 매칭. `[channel]/new`는 `smartstore`/`naver_ad`에만 동작 — `getAdapter(channel)` 결과의 `authType !== 'api_key'`면 `notFound()`.

### connections 메인 카드 변경

기존:
```tsx
<ChannelCard title="스마트스토어" channelKey="smartstore" available={false} />
<ChannelCard title="네이버광고"   channelKey="naver_ad"    available={false} />
```

변경:
```tsx
<ChannelCard title="스마트스토어" channelKey="smartstore" available />
<ChannelCard title="네이버광고"   channelKey="naver_ad"    available />
```

각 카드의 "+ … 계정 추가" 버튼이 `/brands/[id]/settings/connections/{channelKey}/new`로 이어짐.

### `[channel]/new` 동적 폼 페이지

서버 컴포넌트가:
1. URL params에서 `channel` 추출 + `getAdapter(channel)` 호출
2. 어댑터 없거나 `authType !== 'api_key'`면 `notFound()`
3. 어댑터의 `credentialFields` 배열을 map해서 `<Label>` + `<Input>` 렌더
4. 매체별 안내 박스 (어디서 키 발급받는지 — naver commerce 또는 네이버광고 개발자 콘솔 링크)

폼 구조:
```html
<form action="/api/credentials/{channel}/register" method="POST">
  <input type="hidden" name="brand_id" value={brand.id} />
  {credentialFields.map(field =>
    <Label>{field.label}</Label>
    <Input
      name={field.key}
      type={field.secret ? 'password' : 'text'}
      placeholder={field.placeholder}
      required
    />
    {field.hint && <p className="text-xs">{field.hint}</p>}
  )}
  <Button type="submit">검증 후 등록</Button>
</form>
```

매체별 안내 박스는 컴포넌트 분기:
- `smartstore`: "naver commerce 개발자 콘솔에서 앱 등록 후 Client ID/Secret 발급"
- `naver_ad`: "네이버광고 → 도구 → API 관리에서 Access License + Secret Key 발급"

---

## 7. register endpoint

### `POST /api/credentials/[channel]/register`

```
1. params에서 channel 추출 (await params)
2. formData 파싱 (brand_id + 어댑터의 credentialFields key별 값)
3. createServerClient() → getUser() → 없으면 /login으로 303
4. brands SELECT (RLS) → 없으면 /brands?error로 303
5. getAdapter(channel) — authType='api_key' 확인. 아니면 /[channel]/new?error로 303
6. accountLabel = formData.get('accountLabel') — 별도 추출 (channel_account 용)
7. formValues 객체 만들기 (credentialFields key별로 formData 추출)
8. payload = adapter.buildPayload(formValues)
9. result = await adapter.validate(payload)
10. result.ok=false → /[channel]/new?error={result.error}로 303
11. createAdminClient():
    a. admin.rpc('create_vault_secret', {
         secret: JSON.stringify(payload),
         name: `${channel}:${brandId}:${accountLabel}`,
         description: `${brandName} / ${accountLabel}`
       }) → secretId
    b. admin.from('brand_credentials').insert({
         brand_id, channel, channel_account: accountLabel,
         secret_id: secretId, status: 'active',
         metadata: { /* 매체별 필요 시 */ }
       })
    - 23505 → /[channel]/new?error="이미 등록된 별칭입니다"
12. 성공: 303 to /brands/{brandId}/settings/connections?connected={channel}:{accountLabel}
```

### 보안 가드레일 (Plan 2와 동일 원칙)

| 항목 | 처리 |
|---|---|
| service_role 클라이언트 클라이언트 번들 유입 | `lib/supabase/admin.ts` + 모든 어댑터의 `import 'server-only'` 그대로 |
| brand 소유 검증 | `createServerClient`로 user 확인 후 brands RLS lookup |
| Vault payload 평문 로깅 | console.log 금지. 에러 메시지에 payload 필드 노출 안 함 |
| API response에 secret 노출 | 성공/실패 status만. secret_id조차 클라이언트 응답에 없음 — 303 redirect만 |
| UNIQUE 위반 처리 | 친화적 메시지 ("이미 등록된 별칭입니다") |

---

## 8. Vault payload + secret name 규칙

| 매체 | payload JSON | secret name |
|---|---|---|
| 카페24 (Plan 2) | `{ appId, appSecret, mallId, accessToken, refreshToken, expiresAt }` | `cafe24:{brand_id}:{mallId}` |
| 스마트스토어 | `{ clientId, clientSecret }` | `smartstore:{brand_id}:{accountLabel}` |
| 네이버광고 | `{ customerId, accessLicense, secretKey }` | `naver_ad:{brand_id}:{accountLabel}` |

- `accountLabel`은 vault payload에 안 넣음 — 식별은 `brand_credentials.channel_account`로
- secret name에는 한글 별칭 그대로 포함 (Supabase Vault는 UTF-8 OK)
- description은 사람이 읽는 형식: `{브랜드명} / {accountLabel}`

---

## 9. DB 변경

**없음.** Plan 1·2에서 만든 `brand_credentials` 테이블에 INSERT/SELECT만, Plan 2의 `public.create_vault_secret` / `public.delete_vault_secret` wrapper도 그대로 재사용.

마이그레이션 파일 추가 없음.

---

## 10. 검증 시나리오 (Plan 3 완료 기준)

운영자가 본인이 가진 스마트스토어 + 네이버광고 자격증명으로 다음을 통과:

### 스마트스토어 (✅ 6개)

1. 임시 브랜드 → "+ 스마트스토어 계정 추가" → "메인스토어" + 본인 client_id/secret 입력 → "검증 후 등록"
2. 자동 이동된 connections 페이지 상단에 `✅ smartstore:메인스토어 연결되었습니다` 배너
3. 카드 안에 `✅ 메인스토어` 행 표시
4. SQL — `brand_credentials` 1행 (channel='smartstore', channel_account='메인스토어', secret_id 있음, status='active')
5. SQL — `vault.secrets` 1행 (name='smartstore:{brandId}:메인스토어')
6. SQL — `vault.decrypted_secrets` payload에 `{ clientId, clientSecret }`

### 네이버광고 (✅ 6개)

1. 같은 브랜드 → "+ 네이버광고 계정 추가" → "주력광고계정" + 본인 customer_id/access_license/secret_key 입력 → 등록
2. ✅ `naver_ad:주력광고계정` 표시 + 카드 행
3. SQL `brand_credentials` 1행 (channel='naver_ad', channel_account='주력광고계정', has_secret)
4. SQL `vault.secrets` name='naver_ad:{brandId}:주력광고계정'
5. SQL `decrypted_secrets` payload에 `{ customerId, accessLicense, secretKey }`
6. ✕ 버튼 해제 → 두 테이블에서 행 사라짐 (Plan 2의 delete route 그대로 작동)

### 부정 검증 (✅ 3개)

1. 스마트스토어에 잘못된 clientSecret 입력 → 빨간 에러 "Client ID 또는 Secret이 올바르지 않습니다" + brand_credentials INSERT 안 됨
2. 네이버광고에 잘못된 secretKey 입력 → 빨간 에러 "키가 유효하지 않습니다" + INSERT 안 됨
3. 같은 브랜드에 같은 accountLabel로 두 번째 등록 시도 → "이미 등록된 별칭입니다"

→ 총 15개 시나리오가 Plan 3 완료 기준.

---

## 11. 위험 + 완화

| 위험 | 완화 |
|---|---|
| bcrypt 의존성이 Vercel 빌드 환경에서 native 컴파일 실패 | `bcryptjs` (pure JS) 사용 — 성능 약간 낮지만 호환성 OK |
| 사용자가 네이버광고 customer_id를 문자열로 입력 (앞 0 누락 등) | input에 별도 검증 안 함 — 매체가 401 반환 시 에러 표시로 대응 |
| 매체별 다른 에러 응답 포맷 | validate 함수 안에서 status code로만 분기. body 파싱 의존 X |
| 스마트스토어 access_token이 vault에 없음 → Plan 4에서 sync 시 매번 발급 비용 | client_credentials는 빠른 발급 (수백 ms). Plan 4에서 token 캐시 도입 검토 |
| 폼 실패 시 사용자가 secret 재입력 — UX 부담 | 폼 필드 3~4개로 적음. 입력값 복원 코드 복잡도가 더 큰 비용 |
| `accountLabel`에 한글/특수문자 들어가서 secret name 또는 URL 문제 | Vault name은 text 컬럼이라 한글 OK. URL은 `encodeURIComponent` 처리 |
| 다른 매체 추가 시 인터페이스 deviation | `credentialFields` + `buildPayload` 패턴은 일반화 — Google Ads 등 API 키 매체에 그대로 적용 가능. OAuth는 별도 페이지 (cafe24 패턴) |

---

## 12. 산출물 (코드 변경 요약)

### 신규 파일

| 파일 | 역할 |
|---|---|
| `lib/adapters/smartstore.ts` | 스마트스토어 어댑터 |
| `lib/adapters/naver-ad.ts` | 네이버광고 어댑터 |
| `app/(dashboard)/brands/[brandId]/settings/connections/[channel]/new/page.tsx` | 동적 폼 페이지 |
| `app/api/credentials/[channel]/register/route.ts` | API 키 매체 등록 endpoint |

### 변경 파일

| 파일 | 변경 |
|---|---|
| `lib/adapters/_types.ts` | `FieldDef` 추가, `ChannelAdapter`에 `credentialFields?`, `buildPayload?` 옵셔널 추가 |
| `lib/adapters/_registry.ts` | smartstore + naver_ad 어댑터 등록 |
| `app/(dashboard)/brands/[brandId]/settings/connections/page.tsx` | 두 카드의 `available={false}` → `available` (true) |
| `package.json` | `bcryptjs` + `@types/bcryptjs` 추가 |

### DB 변경

**없음.**

---

## 13. 다음 단계

이 spec이 사용자 리뷰 후 확정되면 `writing-plans` 스킬로 Task 단위 구현 계획 작성. 예상 Task 흐름:

1. bcryptjs 의존성 추가 + `_types.ts` 인터페이스 확장 (FieldDef + buildPayload)
2. 스마트스토어 어댑터 구현
3. 네이버광고 어댑터 구현
4. `_registry.ts`에 두 어댑터 등록
5. connections 메인 카드 두 개 활성화
6. `[channel]/new` 동적 폼 페이지
7. `register/route.ts` endpoint
8. 운영자 본인 통합 수동 검증 (15개 시나리오)
9. 프로덕션 검증

Plan 2보다 작은 plan — DB 변경 없음 + Plan 2 인프라 그대로 재사용 + 매체 2개의 어댑터만 추가.

## 14. Plan 3 이후 — Plan 4 준비

- pg_cron 잡 등록 (active credentials → sync_jobs INSERT)
- 카페24 가상서버에 워커 추가 (PM2) — sync_jobs polling
- 어댑터 인터페이스에 `syncOrders` / `syncAdStats` / `syncProducts` / `syncAdUnits` 추가
- 토큰 자동 refresh (cafe24 + smartstore expiresAt 기반)
- Vault decrypt RPC wrapper (현재 `public.create_vault_secret` / `public.delete_vault_secret`에 추가)
