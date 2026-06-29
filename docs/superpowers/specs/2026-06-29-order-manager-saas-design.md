# Order Manager SaaS 전환 — 디자인 문서

- **작성일**: 2026-06-29
- **상태**: 디자인 합의 완료 → 구현 계획 작성 예정
- **레포 이름(가칭)**: `order-manager-saas` (신규)
- **기존 시스템**: `order-manager` (내부용으로만 유지, 마이그레이션 후 archive)

---

## 1. 배경과 목표

### 배경

`order-manager`는 내부 영업팀을 위한 단일 사용자 React (CRA) 앱이었다. 현재 3개 브랜드를 운영 중:

| 업체 | 브랜드 | 매체 |
|---|---|---|
| (주)한국생활건강 | 팔레오, 코코엘 | 카페24, 스마트스토어 |
| (주)순진 | 아프리모 | 카페24 |

### 목표

외부 업체가 가입해 자기 브랜드의 쇼핑몰·광고 API를 등록하면, **상품별 ROAS**(매출+광고비)를 한 화면에서 볼 수 있는 멀티테넌트 SaaS로 전환한다.

### 핵심 가치

> "광고비 1만원이 어느 상품을 팔았는가" — 매체별 광고 데이터와 상품별 매출을 **상품 단위에서 매칭**하는 통합 대시보드.

### Out of Scope (MVP에서 제외)

- **결제·구독 시스템** — 별도 진행. 사용자 발언 반영.
- **외부 고객 영업·마케팅** — MVP 작업 범위가 아님.
- **셀프 회원가입** — 운영자가 계정 발급(초대 이메일).
- **팀 멤버 / SSO** — 업체당 1계정 모델로 출발.
- **자동 매핑** — 광고-상품 매칭은 수동.

---

## 2. 의사결정 요약

| 항목 | 결정 |
|---|---|
| 아키텍처 접근 | **C-2**: 새 레포 + Next.js 신규 작성 + 기존 Supabase 재사용 + 베타로 기존 3 브랜드 흡수 |
| 계정-브랜드 모델 | 1 계정 = N 브랜드 (한국생활건강 = 1 계정 + 팔레오·코코엘 2 브랜드) |
| 회원가입 | 운영자가 계정 발급 (초대 이메일) |
| Day 1 매체 | 카페24, 스마트스토어, 네이버광고 (기존 코드 활용) |
| Phase 2 매체 | Google Ads → 이후 Meta, 쿠팡, 모비온 (API 확인 후) |
| 광고 수집 단위 | 모든 레벨 (캠페인·광고그룹·키워드·소재) |
| 광고-상품 매핑 단위 | 광고그룹 (MVP) |
| 매핑 방식 | 수동 지정. 검색 보조용 키워드 자동 입력은 OK |
| 자격증명 보관 | Supabase Vault (pgsodium 기반) |
| 멀티테넌트 격리 | `brand_id` + Supabase RLS (`owner_id` 기반) |
| 동기화 빈도 | 주문 30분, 카탈로그 1일, 광고 1일 2회 |
| 인프라 분담 | Vercel(짧은 호출) + 카페24 가상서버(고정IP 매체) |

---

## 3. 시스템 전체 구조

### 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui |
| 인증·DB | Supabase (Postgres + Auth + Storage + pg_cron + Vault) |
| 호스팅 | Vercel (신규 프로젝트) |
| 외부 API 프록시 | 카페24 가상서버(203.245.41.105) + PM2 + Cloudflare Tunnel — 그대로 유지 |
| 작업 큐 | `pg_cron` + `sync_jobs` 테이블 (별도 인프라 X) |

### 4개 컴포넌트와 책임

```
┌─────────────────────────────────────┐
│        Next.js 앱 (Vercel)           │
│  - UI (로그인, 브랜드, 매핑, 대시보드) │
│  - 가벼운 API (OAuth 콜백, 검증)     │
└──────────────┬──────────────────────┘
               │
       ┌───────┴───────┐
       │               │
┌──────▼─────┐  ┌─────▼──────────────┐
│  Supabase  │  │ 카페24 가상서버      │
│  - Auth     │  │ - 프록시 (고정IP)    │
│  - Postgres │  │ - 동기화 워커        │
│  - Vault    │  │   (sync_jobs 폴링)   │
│  - pg_cron  │  │                     │
└─────────────┘  └─────────────────────┘
```

- **Next.js 앱**: UI + 가벼운 API (OAuth 콜백, 자격증명 즉시 검증)
- **Supabase**: 인증·데이터·자격증명 저장(Vault)·잡 스케줄링
- **카페24 가상서버**: 고정IP 필요한 외부 API 호출(스마트스토어/네이버광고) + 무거운 동기화 잡 실행
- **어댑터 레이어**: 매체별 호출 로직을 격리한 TypeScript 모듈 (`adapters/cafe24.ts` 등)

---

## 4. 데이터 모델

### 핵심 테이블 관계

```
auth.users (Supabase 내장)
  │ 1:N
  ▼
brands  (owner_id 컬럼 신규 추가)
  │ 1:N
  ├──────────────────┬──────────────────┬─────────────────┐
  ▼                  ▼                  ▼                 ▼
brand_credentials   channel_products   ad_units          orders
(매체별 자격증명)    (매체별 상품)      (광고 단위 통합)   ...
  │
  └─→ vault.secrets (암호화 본체)

ad_units ──────┐
               ▼
        ad_product_mappings ──→ channel_products
        (사용자 수동 매핑)
        
ad_units ──→ ad_stats (일별 광고 통계)
```

### 4.1 brands (기존 + 컬럼 추가)

```sql
ALTER TABLE brands
  ADD COLUMN owner_id uuid REFERENCES auth.users(id) NOT NULL;

-- 기존 컬럼은 유지: id, name, color, created_at
```

### 4.2 brand_credentials (신규)

```sql
CREATE TABLE brand_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,            -- 'cafe24' | 'smartstore' | 'naver_ad' | 'google_ads' | 'meta_ads' | 'mobion'
  channel_account text NOT NULL,    -- '메인몰', '도깨비나라' 등 (한 브랜드의 같은 매체에 N 계정 가능)
  secret_id uuid,                   -- vault.secrets 참조
  status text DEFAULT 'active',     -- 'active' | 'expired' | 'error'
  last_synced_at timestamptz,
  metadata jsonb,                   -- 비밀 아닌 메타 (mall_id, customer_id 등)
  created_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, channel, channel_account)
);
```

**`channel_account` 도입 이유**: 한 브랜드가 같은 매체에 여러 계정 운영 케이스 대응 (예: 팔레오가 카페24에 '메인몰' + '도깨비나라' 2개 운영).

### 4.3 channel_products (신규)

```sql
CREATE TABLE channel_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  channel_account text NOT NULL,
  external_product_id text NOT NULL,    -- 카페24 product_no, 스마트스토어 origin_product_no 등
  external_product_name text,
  thumbnail_url text,
  alias text,                            -- 사용자가 통합 표시명 지정 시 (선택)
  metadata jsonb,
  synced_at timestamptz,
  UNIQUE(brand_id, channel, channel_account, external_product_id)
);
```

**통합 상품 마스터 추상화는 두지 않음**. 사용자 멘탈 모델("플랫폼 선택 → 그 안의 상품")에 맞춤. 통합 표시는 `alias` 필드로 처리 — 같은 alias를 가진 channel_products는 ROAS 집계 시 자동 그룹핑.

### 4.4 ad_units (신규 — 모든 광고 단위 통합)

```sql
CREATE TABLE ad_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  channel_account text NOT NULL,
  external_id text NOT NULL,
  external_name text,
  level text NOT NULL,                  -- 'campaign' | 'ad_group' | 'keyword' | 'creative'
  parent_id uuid REFERENCES ad_units(id),   -- 계층 (광고그룹 → 캠페인)
  metadata jsonb,                        -- 매체별 특수 필드 (입찰가, URL, 매체타입 등)
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, channel, external_id)
);
```

캠페인·광고그룹·키워드·소재를 동일 테이블에서 표현. 새 매체 추가 시 스키마 변경 불필요.

### 4.5 ad_stats (신규 — 일별 통계, 모든 레벨)

```sql
CREATE TABLE ad_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  ad_unit_id uuid REFERENCES ad_units(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  impressions int DEFAULT 0,
  clicks int DEFAULT 0,
  cost numeric DEFAULT 0,
  conversions int DEFAULT 0,
  conversion_revenue numeric DEFAULT 0,
  metadata jsonb,
  UNIQUE(ad_unit_id, date)
);
```

### 4.6 ad_product_mappings (신규)

```sql
CREATE TABLE ad_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  ad_unit_id uuid REFERENCES ad_units(id) ON DELETE CASCADE NOT NULL,
  channel_product_id uuid REFERENCES channel_products(id) ON DELETE CASCADE NOT NULL,
  weight numeric DEFAULT 1.0,            -- 1 광고가 N 상품 광고 시 비용 안분 가중치
  created_at timestamptz DEFAULT now(),
  UNIQUE(ad_unit_id, channel_product_id)
);
```

**MVP에서 매핑은 광고그룹 단위만**. 키워드/소재 단위 매핑은 Phase 2.

### 4.7 sync_jobs (신규 — 동기화 큐)

```sql
CREATE TABLE sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  credential_id uuid REFERENCES brand_credentials(id) ON DELETE CASCADE NOT NULL,
  channel text NOT NULL,
  job_type text NOT NULL,                -- 'orders' | 'ad_stats' | 'products' | 'token_refresh'
  status text DEFAULT 'pending',         -- 'pending' | 'running' | 'completed' | 'failed'
  date_range_start date,
  date_range_end date,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  retry_count int DEFAULT 0,
  error_message text,
  result_summary jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON sync_jobs (status, scheduled_at) WHERE status IN ('pending', 'running');
```

### 4.8 기존 테이블 처리

| 테이블 | 처리 |
|---|---|
| `brands` | 유지 + `owner_id` 컬럼 추가 |
| `orders`, `order_items` | 유지 (`brand_id` 이미 있음, RLS만 재설계) |
| `catalog_products` | `channel_products`로 이전 (별도 마이그레이션 스크립트) |
| `product_category_map` | 유지 (`brand_id` 이미 있음) |
| `naver_ad_stats` | `ad_units` + `ad_stats`로 이전 |
| `cafe24_tokens` | **삭제** → `brand_credentials` + vault로 통합 |
| `profiles`, `brand_managers` | **삭제** (직원·부서 개념 SaaS에선 불필요) |
| `notices`, `notice_comments` | **삭제** (내부 공지였음) |

### 4.9 자격증명 암호화 — Supabase Vault

```
사용자가 OAuth 콜백 / 키 입력 완료
  ↓
Next.js API Route가 vault.create_secret({...credentials}, name='<channel>:<brand_id>:<account>')
  ↓
반환된 secret_id를 brand_credentials.secret_id에 저장
  ↓
프록시 서버가 호출 직전 Service Role로 vault.decrypted_secrets 조회 → 사용 후 메모리 폐기
```

### 4.10 RLS 정책

```sql
-- brands: 본인 소유만
CREATE POLICY brands_owner ON brands
  FOR ALL USING (owner_id = auth.uid());

-- 자식 테이블 (brand_credentials, channel_products, ad_units, ad_stats, ad_product_mappings, orders, order_items, sync_jobs):
CREATE POLICY <table>_owner ON <table>
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM brands
      WHERE brands.id = <table>.brand_id
        AND brands.owner_id = auth.uid()
    )
  );

-- 프록시 서버는 Service Role 키로 RLS bypass (서버에서만 사용)
```

---

## 5. 어댑터 패턴 · 동기화 오케스트레이션

### 5.1 어댑터 인터페이스

```typescript
interface ChannelAdapter {
  channel: string;
  category: 'shop' | 'ad';
  authType: 'oauth' | 'api_key';

  // 인증
  getAuthUrl?(brandId: string): string;
  handleCallback?(code: string, brandId: string): Promise<CredentialPayload>;
  credentialFields?: FieldDef[];
  validate(creds: CredentialPayload): Promise<boolean>;

  // 동기화
  syncOrders?(creds, brand, dateRange): Promise<SyncResult>;
  syncAdStats?(creds, brand, dateRange): Promise<SyncResult>;
  syncProducts?(creds, brand): Promise<SyncResult>;
  syncAdUnits?(creds, brand): Promise<SyncResult>;

  // 토큰 갱신
  refreshToken?(creds): Promise<CredentialPayload>;
}
```

### 5.2 어댑터 디렉토리

```
adapters/
├── _registry.ts        # channel → adapter 매핑
├── _types.ts           # ChannelAdapter 인터페이스
├── cafe24.ts           # Day 1
├── smartstore.ts       # Day 1
├── naver-ad.ts         # Day 1
├── google-ads.ts       # Phase 2
├── meta-ads.ts         # Phase 3
├── coupang.ts          # Phase 3
└── mobion.ts           # Phase 3 (CSV 업로드 방식 예정)
```

### 5.3 어댑터 실행 위치

| 매체 | 호출 위치 | 이유 |
|---|---|---|
| 카페24 | 양쪽 가능 (인증=Vercel, 배치=서버) | IP 제한 없음 |
| 스마트스토어 | **카페24 가상서버만** | 고정IP 필요 |
| 네이버광고 | **카페24 가상서버만** | 고정IP 필요 |
| 쿠팡 | Vercel | IP 제한 없음 |
| Google Ads / Meta | Vercel | IP 제한 없음 |
| 모비온 | Vercel (CSV 파싱) | API 없음 |

### 5.4 동기화 오케스트레이션

```
[pg_cron] (Supabase 내장)
  매 30분: active 자격증명을 sync_jobs에 INSERT
        ↓
[sync_jobs 테이블] (큐)
        ↓
[카페24 서버 워커] (Node + PM2, 5초 폴링)
  - status='pending' 잡 가져옴 → status='running'
  - sync_jobs.channel으로 어댑터 라우팅
  - 어댑터 실행 → 결과를 orders/ad_stats/channel_products에 upsert
  - 결과 기록 → status='completed' / 'failed'
```

**MVP는 모든 동기화 잡을 카페24 가상서버에서 처리.** Vercel Function은 짧은 호출(OAuth 콜백, 자격증명 즉시 검증)에만 사용 — Vercel Pro 함수 timeout(60초)이 30일치 주문 수집에는 부족할 수 있어 안전하게 서버 워커로 통일.

Phase 2+ 매체 중 IP 제한 없고 호출이 가벼운 경우(예: 모비온 CSV 파싱)에 한해 Vercel Function 처리를 추가할 수 있다.

### 5.5 동기화 빈도 (MVP 기본값)

| 매체·잡 | 빈도 |
|---|---|
| 주문 (카페24, 스마트스토어) | 30분 |
| 상품 카탈로그 (카페24) | 1일 1회 (새벽 3시) |
| 광고 통계 (네이버광고) | 1일 2회 (08시, 17시) |
| 광고 단위 구조 (ad_units) | 1일 1회 |

### 5.6 에러 / 재시도 / 토큰 만료

| 상황 | 처리 |
|---|---|
| 일시적 실패 (네트워크, 5xx) | 5분 후 재시도, 최대 3회 |
| 3회 실패 | `brand_credentials.status = 'error'` + UI 빨간 배지 |
| OAuth 토큰 만료 | 자동 `refreshToken()` → 실패 시 `status='expired'` + 재인증 UI |
| 자격증명 잘못 등록 | `validate()`가 등록 시점에 차단 |

---

## 6. 프론트 구조 · 가입 흐름 · 핵심 화면

### 6.1 App Router 디렉토리

```
app/
├── (auth)/
│   ├── login/
│   └── invite/[token]/             # 초대 수락 + 비밀번호 설정
│
├── (dashboard)/
│   ├── layout.tsx                  # 사이드바 + 브랜드 스위처
│   ├── page.tsx                    # 홈 (활성 브랜드 요약)
│   ├── brands/
│   │   ├── page.tsx                # 브랜드 목록
│   │   ├── new/page.tsx            # 브랜드 추가
│   │   └── [brandId]/
│   │       ├── dashboard/          # 통합 ROAS 대시보드 ⭐
│   │       ├── orders/             # 주문 조회
│   │       ├── ads/                # 광고 조회 + 매핑 ⭐
│   │       ├── products/           # 상품 카탈로그 조회 + alias 편집
│   │       └── settings/
│   │           ├── connections/    # 매체 연동
│   │           └── dictionaries/   # 불용어 사전
│   └── account/                    # 본인 계정 (비번 변경)
│
├── admin/
│   └── users/                      # 운영자 전용: 계정 발급
│
└── api/
    ├── oauth/[channel]/callback/
    ├── credentials/                # POST/GET/DELETE
    ├── sync/trigger/               # 수동 동기화
    └── admin/users/                # 운영자 전용
```

### 6.2 계정 발급 흐름 (운영자가 생성)

```
1. 운영자가 /admin/users에서 이메일 + 업체명 입력
   ↓
2. 서버에서 Supabase Auth Admin API (inviteUserByEmail) 호출
   - service_role 키 필요 → 서버 사이드에서만 실행
   ↓
3. 고객이 메일 링크 클릭 → /invite/[token]
   ↓
4. 비밀번호 설정 폼 → 저장
   ↓
5. 자동 로그인 → /brands (브랜드 없음 안내)
```

→ **MVP에 셀프 회원가입 폼 없음.** 운영자 페이지에서만 발급.

### 6.3 첫 로그인 온보딩 (3단계)

```
[Step 1] 브랜드 만들기
  - 이름 + 색상 입력 → 저장
  → /brands/[brandId]/settings/connections로 이동

[Step 2] 첫 매체 연결
  - 카드 그리드로 매체 선택 (카페24/스마트스토어/네이버광고)
  - 카페24 → OAuth 팝업
  - 스마트스토어/네이버광고 → API 키 입력 폼
  → 검증 통과 시 즉시 첫 동기화 잡 생성

[Step 3] 대기 화면
  - "데이터 수집 중 (예상 5분)" 진행 표시
  - 완료 시 자동 /brands/[brandId]/dashboard로 이동
```

### 6.4 브랜드 스위처

```
[팔레오 ▼]   ← 상단 헤더에 항상 노출
  ├ 팔레오 ✓
  ├ 코코엘
  └ + 브랜드 추가
```

URL은 경로 기반 `/brands/[brandId]/...` — 북마크 가능, 탭별로 다른 브랜드 보기 가능.

### 6.5 매체 연동 UI (`/settings/connections`)

```
[카페24]                       [스마트스토어]
─────────────────────────      ─────────────────────────
✅ 메인몰        🔄 5분 전     ✅ 브랜드스토어  🔄 1시간 전
✅ 도깨비나라    🔄 5분 전     ⚠️ 토큰 만료
[+ 계정 추가]                  [+ 계정 추가]

[네이버광고]                   [Google Ads]
─────────────────────────      ─────────────────────────
✅ 메인계정      🔄 2시간 전   [+ 연결]   (Phase 2)

[Meta] [쿠팡] [모비온]
[준비 중]
```

### 6.6 광고 조회 + 매핑 (`/ads`) ⭐ 핵심

```
[광고 조회]                                          [날짜 선택]

▼ 캠페인: 다이어트 검색광고                           노출    클릭    비용
  ▶ 광고그룹: 다이어트 분말 효과                     85K   1,200   2.1M
      매핑: 🛒 팔레오 다이어트 분말 [✕]  [+ 상품]
      ▶ 키워드: 다이어트 분말             ← 펼치기
      ▶ 키워드: 분말 다이어트
  ▶ 광고그룹: 단백질 보충제 추천                     62K     890   1.5M
      매핑: ⚠️ 없음  [+ 상품]
```

- 기본 표시: 광고그룹 + 매핑
- 펼치기: 키워드/소재 드릴다운
- **매핑은 광고그룹 단위만** (MVP)

### 6.7 매핑 모달

```
┌─ "다이어트 분말 효과"에 상품 매핑 ────────────────┐
│ Step 1) 플랫폼: [○ 카페24]  [○ 스마트스토어]    │
│ Step 2) 계정 선택: [메인몰 ▼]                   │
│ Step 3) 상품 검색                                │
│   [다이어트 분말        ] 🔍                     │
│   ↑ 광고그룹명에서 자동 추출 (꺼도 됨)           │
│   ☐ 팔레오 다이어트 분말 (오리지널)             │
│   ☐ 팔레오 다이어트 분말 (베리)                 │
│                            [선택한 상품 매핑]     │
└──────────────────────────────────────────────────┘
```

**키워드 자동 추출 로직** (검색 보조용 — 매핑 자체는 사용자가 클릭으로 확정):
- 입력: 매핑 대상이 광고그룹이면 광고그룹 이름, 키워드이면 키워드 텍스트
- 공백·괄호·특수문자로 토큰화 → 불용어 사전으로 필터
- 검색 박스에 토큰들을 공백 join으로 자동 입력
- `channel_products.external_product_name` 및 `alias` 컬럼에 대해 LIKE OR 검색
- 결과 0건이면 토큰 1개씩 줄여가며 fallback
- 사용자가 모달에서 자동 입력을 꺼고 직접 입력해도 됨
- 불용어 사전은 `/settings/dictionaries`에서 브랜드별 편집 가능

### 6.8 통합 ROAS 대시보드 (`/dashboard`) ⭐ 메인

```
┌────────────────────────────────────────────────────────────────┐
│ 상품 (alias 그룹)     매출   광고비   ROAS   노출    클릭   CPC│
├────────────────────────────────────────────────────────────────┤
│ 팔레오 다이어트 분말  12.4M   2.1M   5.9x   85K   1,200  1,750│
│ 팔레오 단백질          8.2M   1.5M   5.5x   62K     890  1,685│
│ 코코엘 비타민          3.1M   0.8M   3.9x   34K     450  1,778│
│ ─────────────────                                              │
│ [매핑 없음]                                                    │
│ 신상 PR                  -    0.9M     -   21K     280  3,214│
└────────────────────────────────────────────────────────────────┘
```

- alias 같은 channel_products의 매출은 자동 그룹핑
- 매핑 안 된 광고는 하단에 별도 섹션 (사용자가 매핑하도록 유도)

### 6.9 MVP 페이지 9개

| 페이지 | 경로 |
|---|---|
| 로그인 | `/login` |
| 초대 수락 | `/invite/[token]` |
| 브랜드 목록 / 추가 | `/brands`, `/brands/new` |
| 통합 ROAS 대시보드 ⭐ | `/brands/[id]/dashboard` |
| 광고 조회 + 매핑 ⭐ | `/brands/[id]/ads` |
| 주문 조회 | `/brands/[id]/orders` |
| 상품 카탈로그 + alias | `/brands/[id]/products` |
| 매체 연동 | `/brands/[id]/settings/connections` |
| 운영자: 계정 발급 | `/admin/users` |

### 6.10 권한

- 일반 사용자: 자기 소유 brands만 (RLS로 보장)
- 운영자: 환경변수 `SUPER_ADMIN_EMAILS` 화이트리스트로 식별 → `/admin/*` 접근. Service Role 사용 시 별도 처리

---

## 7. 마이그레이션 · 베타 컷오버

### 7.1 6 Phase 흐름

```
A. 새 레포 부트스트랩 (1~2일)
   ↓
B. DB 스키마 마이그레이션 (1일, 대부분 무중단)
   ↓
C. 자격증명 .env → vault 이전 (반일)
   ↓
D. 신규 코드 작성 (3~4주)
   ↓
E. 베타 컷오버 (1주)
   ↓
F. 모니터링 + 기존 종료 (1주)
```

**총 6~7주 추정.** 세부화는 writing-plans 단계에서.

### Phase A — 새 레포 부트스트랩

1. `order-manager-saas` 새 GitHub 레포 생성
2. `npx create-next-app@latest` (TS + App Router + Tailwind)
3. shadcn/ui init, Supabase 클라이언트 셋업 (**기존 프로젝트 재사용**)
4. 카페24 가상서버 코드(`server/`) 복사
5. Vercel 새 프로젝트 + 도메인 연결

### Phase B — DB 스키마 마이그레이션

**무중단 작업**:
- 신규 테이블 6개 생성 (`brand_credentials`, `channel_products`, `ad_units`, `ad_stats`, `ad_product_mappings`, `sync_jobs`)
- `brands.owner_id` 컬럼 추가 + 기존 brands를 일단 운영자(Kwon) 계정으로 채움

**일시 영향 작업 (새벽 03시 진행)**:
- 기존 RLS 정책 DROP + `owner_id` 기반 새 정책 CREATE (다운타임 1~2분)

**기존 데이터 이전**:
- `catalog_products` → `channel_products` 마이그레이션 스크립트
- `naver_ad_stats` → `ad_units` + `ad_stats` 마이그레이션 스크립트

**미사용 테이블은 Phase F까지 DROP하지 않음** (안전망):
- `profiles`, `brand_managers`, `notices`, `notice_comments`, `cafe24_tokens`

### Phase C — 자격증명 이전

```
.env에 하드코딩된 자격증명들 ──┐
  PALEO_APP_ID/SECRET            │
  COCOEL_APP_ID/SECRET           │
  DOKEBI_APP_ID/SECRET           ├─→ 운영자 페이지에서 한 건씩 등록
  네이버광고 키들                 │   → vault.create_secret
  카페24 토큰 (cafe24_tokens)    │   → brand_credentials 행 생성
─────────────────────────────────┘
  
server/proxy.js 수정:
  .env.PALEO_APP_ID  →  vault.decrypted_secrets에서 brand+channel로 동적 조회
```

**안전망**: `.env`는 1주간 유지 (롤백용). 검증 후 제거.

### Phase D — 신규 코드 작성 (3~4주)

병행 가능한 8개 영역:
1. 인증 (로그인, 초대 수락, 비밀번호 재설정)
2. 브랜드 관리 (목록, 추가, 스위처)
3. 매체 연동 UI (OAuth + 키 입력 폼)
4. 어댑터 (cafe24, smartstore, naver-ad — TS로 재작성)
5. 동기화 워커 (pg_cron + sync_jobs)
6. 광고 + 매핑 UI
7. 통합 ROAS 대시보드
8. 운영자 페이지

**writing-plans에서 작업 단위로 쪼개고 의존성 정리.**

### Phase E — 베타 컷오버

```
Step 1. 운영자 계정으로 자체 검증 — 양쪽 시스템 데이터 일치 확인
Step 2. 한국생활건강 초대 → 비밀번호 설정 → 로그인
        운영자가 SQL로 brands.owner_id 이전 (팔레오, 코코엘 동시)
Step 3. 순진 초대 → 아프리모 owner_id 이전
Step 4. 1주간 베타 운영 — 기존 시스템 그대로 살려둠
```

### Phase F — 기존 시스템 종료

```
1. 베타 1주 무문제 확인
2. 기존 시스템 read-only 안내 → 1주 후 Vercel 일시정지
3. 1개월 후 기존 GitHub 레포 archive
4. 미사용 테이블 DROP (안전 확인 후)
```

### 7.2 위험과 완화

| 리스크 | 완화 |
|---|---|
| RLS 재배포 중 잠시 영향 | 새벽(03시) 진행. 다운타임 1~2분 미만 |
| .env→vault 이전 후 동기화 실패 | .env 1주 유지(롤백). 한 브랜드씩 단계 적용 |
| 운영 데이터 손실 | DROP은 마지막. ALTER만 무중단. 사전 백업 |
| 베타 사용자 혼란 | 사전 안내 + 1주 양쪽 운영 + 간단 사용법 가이드 |
| 신규 코드 버그 | 베타 사용자(기존 잘 아는 3 브랜드)부터 시작 → 외부 신규 가입은 안정화 후 |

---

## 8. 단계별 매체 롤아웃

### Day 1 (MVP 출시)

| 종류 | 매체 |
|---|---|
| 쇼핑몰 | 카페24, 스마트스토어 |
| 광고 | 네이버광고 |

→ 모두 **현재 코드가 이미 돌아가는 매체**. SaaS화 작업이 가벼움.

### Phase 2

| 종류 | 매체 |
|---|---|
| 광고 | Google Ads |

→ OAuth 흐름 + 어댑터 신규 구현. Developer Token 심사 2~4주 사전 필요.

### Phase 3+ (API 확인 후 결정)

| 종류 | 매체 |
|---|---|
| 쇼핑몰 | 쿠팡 |
| 광고 | Meta (Facebook/Instagram), 모비온 |

→ 각각 API 정책·심사 절차 검토 후 진행. 모비온은 공식 API 없을 가능성 — CSV 업로드 방식 검토.

---

## 9. 핵심 결정 정리표

| 영역 | 결정 |
|---|---|
| 전환 방식 | C-2: 새 레포 + Next.js + Supabase 기존 재사용 |
| 계정-브랜드 | 1계정 = N브랜드 |
| 회원가입 | 운영자 발급 (셀프 가입 X) |
| 매체 확장 | 어댑터 패턴 (파일 하나 추가) |
| 광고 수집 단위 | 모든 레벨 (캠페인·광고그룹·키워드·소재) |
| 매핑 단위 | 광고그룹 (MVP), 키워드/소재는 Phase 2 |
| 매핑 방식 | 수동 (검색 보조용 자동 입력은 OK) |
| 자격증명 | Supabase Vault |
| 멀티테넌트 | brand_id + RLS (owner_id 기반) |
| 동기화 | pg_cron + sync_jobs 큐 + 카페24 서버 워커 |
| 컷오버 | 기존 3 브랜드를 베타로 자연스럽게 흡수 |

---

## 10. 다음 단계

이 문서가 사용자 리뷰 후 확정되면 **writing-plans 스킬**로 넘어가 Phase A~F의 작업 단위 plan을 작성한다.

작업 plan은 다음을 다룬다:
- 의존성 그래프 (어떤 작업이 어떤 작업을 막는지)
- 병행 가능한 작업 식별
- 각 작업의 검증 방법 (테스트, 수동 검증 절차)
- 베타 컷오버 체크리스트

---

## 부록 A — 용어 정리

| 용어 | 의미 |
|---|---|
| 업체 | 외부 고객 회사 (예: 한국생활건강, 순진). 1 업체 = 1 계정 |
| 브랜드 | 업체가 운영하는 단일 브랜드 (예: 팔레오). 1 업체 = N 브랜드 |
| 매체 / 채널 | 외부 API 제공 플랫폼 (카페24, 스마트스토어, 네이버광고 등) |
| 채널 계정 | 같은 매체 내 별도 계정 (예: 카페24 메인몰 vs 도깨비나라) |
| 광고 단위 (ad_unit) | 캠페인·광고그룹·키워드·소재 등 광고의 계층 단위 |
| 어댑터 | 매체별 API 호출을 격리한 TypeScript 모듈 |
| ROAS | Return on Ad Spend = 광고 매출 / 광고비 |
