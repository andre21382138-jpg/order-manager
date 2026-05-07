# 네이버 검색광고 연동 (1단계: 일별 광고비 + ROAS)

작성일: 2026-05-07
대상: `src/App.js`, `api/naver-ad.js` (신규), Vercel 환경변수, Supabase
선행 변경: 없음

## 목적

팔레오 자사몰의 네이버 검색광고 데이터(노출/클릭/광고비/전환)를 가져와 광고 탭에서 일별로 보여주고, 자사몰 매출과 매칭해 ROAS를 계산한다.

## 단계 분리

- **1단계 (이번)**: 일별 광고비 + ROAS. 데이터 모델은 캠페인 단위까지 확장 가능하게 설계.
- **2단계 (추후)**: 캠페인별 성과. 같은 테이블에 `campaign_id` 채운 row 추가.

## 데이터 모델

### Vercel 환경변수
```
PALEO_NAVERAD_CUSTOMER_ID=...
PALEO_NAVERAD_ACCESS_LICENSE=...
PALEO_NAVERAD_SECRET_KEY=...
```
이미 등록 완료. 향후 다른 브랜드 추가 시 `<BRAND>_NAVERAD_*`로 확장.

### Supabase 테이블 `naver_ad_stats`
```sql
CREATE TABLE naver_ad_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  mall_type text NOT NULL DEFAULT '자사몰',
  date date NOT NULL,
  campaign_id text NOT NULL DEFAULT '',      -- 1단계: '' sentinel (일별 합계), 2단계: 실제 캠페인 ID
  campaign_name text,
  impressions int DEFAULT 0,
  clicks int DEFAULT 0,
  cost bigint DEFAULT 0,                     -- 광고비 (원)
  conversions int DEFAULT 0,                 -- Naver attributed 전환수
  conversion_value bigint DEFAULT 0,         -- Naver attributed 전환매출 (원)
  created_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, date, campaign_id)
);
```
이미 생성 완료. RLS 정책은 다른 테이블과 동일 (인증된 사용자 전체 read, admin write).

**캠페인 ID NULL 이슈**: 원래 `campaign_id text` (nullable)로 생성됐다면 PostgreSQL UNIQUE 제약이 NULL을 다중 허용해서 upsert가 안 됨. 1단계에서 일별 row를 NULL 대신 빈 문자열 `''`로 저장하면 기존 UNIQUE 제약이 그대로 작동.

**필요시 1줄 마이그레이션** (이미 NOT NULL DEFAULT ''로 만들었으면 생략):
```sql
ALTER TABLE naver_ad_stats
  ALTER COLUMN campaign_id SET DEFAULT '',
  ALTER COLUMN campaign_id SET NOT NULL;
-- 기존 NULL row가 있다면 먼저 UPDATE naver_ad_stats SET campaign_id='' WHERE campaign_id IS NULL;
```

## 백엔드: `api/naver-ad.js` (신규 Vercel 함수)

### 라우팅
- `?action=stats&brand=PALEO&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - 1단계 핵심. 기간 일별 통계 fetch + DB 저장.

### 인증 (HMAC-SHA256)
```js
const timestamp = Date.now().toString();
const message = `${timestamp}.GET./stats`;
const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('base64');

const headers = {
  'X-Timestamp': timestamp,
  'X-API-KEY': ACCESS_LICENSE,
  'X-Customer': CUSTOMER_ID,
  'X-Signature': signature,
};
```

### Naver 검색광고 API 호출 흐름

1. `GET /ncc/campaigns?recursive=true` — 광고주 소속 캠페인 ID 목록 fetch
2. 캠페인 ID들을 `ids` 배열로 묶어 `GET /stats?ids=[...]&fields=[impCnt,clkCnt,salesAmt,ccnt,convAmt]&timeRange={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}&datePreset=custom`
3. 응답을 일별로 합산 → 각 일자별 1 row로 반환

### 응답 형식
```json
{
  "stats": [
    {"date":"2026-05-01","impressions":18000,"clicks":500,"cost":50000,"conversions":12,"conversion_value":120000},
    ...
  ]
}
```

### 환경변수 lookup
```js
const BRAND_ALIAS = {
  "fd66b113-548b-44b0-8510-b7f49e302145": "PALEO",
};
function getCreds(brandUuid) {
  const alias = BRAND_ALIAS[brandUuid];
  if (!alias) return null;
  const customerId = process.env[`${alias}_NAVERAD_CUSTOMER_ID`];
  const accessLicense = process.env[`${alias}_NAVERAD_ACCESS_LICENSE`];
  const secretKey = process.env[`${alias}_NAVERAD_SECRET_KEY`];
  if (!customerId || !accessLicense || !secretKey) return null;
  return { customerId, accessLicense, secretKey };
}
```

### 에러 응답 정책
- 알 수 없는 brandId → 404 `{error:"브랜드별 자격증명 매핑 없음"}`
- 자격증명 env 누락 → 503 `{error:"PALEO_NAVERAD_* 미설정"}`
- Naver API 인증 실패(401) → 401 그대로 전달
- Naver API 기타 에러 → 502 `{error: ..., raw: ...}`
- 내부 예외 → 500

## 프론트엔드

### `src/App.js` State 추가
```js
const [naverAdStats, setNaverAdStats] = useState([]);            // current brand+date range의 일별 row
const [showNaverAdModal, setShowNaverAdModal] = useState(false);
const [naverAdSyncing, setNaverAdSyncing] = useState(false);
const [naverAdSyncResult, setNaverAdSyncResult] = useState("");
const [naverAdCustomStart, setNaverAdCustomStart] = useState("");
const [naverAdCustomEnd, setNaverAdCustomEnd] = useState("");
```

### Brand 자격증명 매핑 (frontend도 동일 매핑 유지 — UI 표시 목적)
```js
const NAVERAD_CONFIGURED_BRANDS = ["fd66b113-548b-44b0-8510-b7f49e302145"]; // 팔레오
```

### 광고 탭 렌더링 분기

`mainTab === "광고"` 영역을 다음으로 교체:

```
1) 자사몰 + 자격증명 등록 brand → 정상 화면
   - 헤더: 📣 광고 + 🔍 동기화 버튼
   - 날짜 필터 카드
   - 요약 카드 (광고비, 노출, 클릭, CTR)
   - ROAS 카드 (앱 ROAS + Naver attributed ROAS)
   - 일별 표
2) 자사몰 + 미등록 brand → "📣 네이버광고 자격증명 미설정" 안내
3) 자사몰 외 mall → "스마트스토어 내부 광고는 별도 채널 (미지원)"
```

### 데이터 fetch
```js
useEffect(() => {
  if (mainTab !== "광고" || currentMallType !== "자사몰" || !currentBrand) return;
  if (!NAVERAD_CONFIGURED_BRANDS.includes(currentBrand.id)) return;
  supabase.from("naver_ad_stats")
    .select("*")
    .eq("brand_id", currentBrand.id)
    .eq("mall_type", "자사몰")
    .eq("campaign_id", "")                 // 1단계: 일별 row만 (sentinel '')
    .gte("date", filter.from).lte("date", filter.to)
    .order("date")
    .then(({ data }) => setNaverAdStats(data || []));
}, [currentBrand, currentMallType, mainTab, filter.from, filter.to]);
```

### ROAS 계산
- **앱 ROAS** = 자사몰 매출 합계(orders 테이블) / 광고비 합계 × 100
  - 광고 외 매출까지 포함되므로 과대평가될 수 있음 (참고용)
- **Naver attributed ROAS** = conversion_value 합계 / cost 합계 × 100
  - Naver가 추적 가능한 광고-attributed 매출만 (정확하지만 underreporting)
- 두 값 모두 표시 + 짧은 설명

### 동기화 모달 (🔗 클릭 시)
카페24 모달과 동일 패턴:
- 프리셋: 최근 7일 / 당월 / 전월
- 직접 지정: from-to 날짜 input
- 동기화 버튼 → `api/naver-ad.js?action=stats&brand=PALEO&from=...&to=...`
- 응답 받으면 일자별로 `naver_ad_stats` upsert (`onConflict: "brand_id,date,campaign_id"`, 1단계 row는 `campaign_id: ''`)
- 결과 메시지 표시 + 화면 데이터 갱신

### 일별 표 컬럼

| 날짜 | 광고비 | 노출 | 클릭 | CTR | 자사몰매출 | 앱 ROAS |
|------|--------|------|------|-----|-----------|---------|

자사몰매출은 동일 날짜의 `orders.total_amount` 합계 (brand_id + mall_type='자사몰' + 취소 제외).

## 영향 범위

| 파일 | 변경 |
|------|------|
| `api/naver-ad.js` | 신규 — Naver 검색광고 API HMAC 호출 + 응답 정규화 |
| `src/App.js` | 광고 탭 placeholder → 실제 화면 + 모달 + state |
| `package.json` | `crypto` 모듈은 Node 내장이므로 dependency 추가 불필요 |
| Supabase | `naver_ad_stats` 테이블 (이미 생성) |
| Vercel env | `PALEO_NAVERAD_*` 3개 (이미 등록) |

## 비목표 (1단계)

- 캠페인별 성과 (2단계)
- 키워드별 성과
- cron 자동 동기화 (수동 모달만)
- 다른 브랜드 — 자격증명 발급 시 환경변수 + BRAND_ALIAS 추가만으로 확장 가능
- 광고비 직접 입력 / 수정 UI

## 검증 기준

- [ ] 광고 탭 진입(팔레오 + 자사몰) 시 사이드바/헤더 정상, 본문에 빈 표 (동기화 전)
- [ ] 동기화 버튼 → 모달 열림, 프리셋/커스텀 날짜 선택 가능
- [ ] "최근 7일" 클릭 시 7일치 데이터가 일별로 수집되어 표 + 요약 카드 채워짐
- [ ] 자사몰 매출 매칭이 정상 (orders 테이블의 동일 날짜+브랜드+자사몰 매출)
- [ ] 앱 ROAS / Naver attributed ROAS 둘 다 표시
- [ ] 코코엘 자사몰 광고 탭 → "자격증명 미설정" 안내 (`NAVERAD_CONFIGURED_BRANDS`에 없음)
- [ ] 팔레오 브랜드스토어 광고 탭 → "스마트스토어 내부 광고는 별도 채널" 안내
- [ ] HMAC 시그니처 잘못된 경우 (env 잘못 입력 등) → 모달에 401 에러 표시
- [ ] env 미등록 시 → 모달에 503 에러 표시 ("PALEO_NAVERAD_* 미설정")

## 후속 작업 (1단계 완료 후)

- 2단계: 캠페인별 row 추가, 광고 탭에 캠페인 리스트 + 캠페인별 ROAS 표
- 자동 동기화: `server/sync.js`에 NAVERAD 타겟 추가, 매일 cron 실행
