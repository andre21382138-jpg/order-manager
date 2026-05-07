# 팔레오 스마트스토어 2개(브랜드스토어 + 도깨비나라) 분리

작성일: 2026-05-07
대상 파일: `src/App.js`, `server/proxy.js`, `server/sync.js`, `README.md`
선행 변경: 없음 (현재 main 기준)

## 배경

팔레오는 Naver 스마트스토어 플랫폼에 두 개의 스토어를 운영한다 — 메인 "브랜드스토어"와 보조 "도깨비나라". 현재 데이터 모델은 브랜드당 단일 "스마트스토어" mall_type만 지원하므로 두 스토어를 구분할 수 없다.

## 핵심 설계 결정

**`mall_type`은 실제 스토어 이름이다.** "스마트스토어"는 더 이상 모든 Naver Commerce 스토어의 공통 라벨이 아니라, 각 브랜드의 실제 스토어 명을 그대로 저장한다.

- 팔레오: `mall_types = ["자사몰", "브랜드스토어", "도깨비나라"]`
- 코코엘: `mall_types = ["자사몰", "스마트스토어"]` (이름 유지)
- 아프리모: `mall_types = ["자사몰"]`

**플랫폼 판별**: `mallType !== "자사몰"`이면 Naver Commerce 플랫폼(스마트스토어 변종). `"자사몰"`이면 카페24.

## 데이터 모델

### `brands.mall_types` (변경 없음, 값만 갱신)
- 팔레오: `["자사몰", "스마트스토어"]` → `["자사몰", "브랜드스토어", "도깨비나라"]`

### `orders.mall_type` (변경 없음, 값만 갱신)
- 팔레오의 기존 `mall_type='스마트스토어'` → `mall_type='브랜드스토어'` (모두 일괄)
- 신규 도깨비나라 주문은 `mall_type='도깨비나라'`로 저장

### DB 마이그레이션 (Supabase SQL Editor에서 1회 실행)
```sql
UPDATE brands
SET mall_types = ARRAY['자사몰', '브랜드스토어', '도깨비나라']
WHERE name = '팔레오';

UPDATE orders
SET mall_type = '브랜드스토어'
WHERE brand_id = (SELECT id FROM brands WHERE name = '팔레오')
  AND mall_type = '스마트스토어';
```

## 프론트엔드 변경

### `MALL_TYPE_COLORS` 확장 (`src/App.js`)
```js
const MALL_TYPE_COLORS = {
  "자사몰": "#8B5CF6",       // 보라 (cafe24)
  "스마트스토어": "#10B981",  // 초록 (코코엘 등 기존)
  "브랜드스토어": "#10B981",  // 초록 (팔레오 main)
  "도깨비나라": "#F59E0B"     // 주황 (팔레오 보조)
};
```

### 플랫폼 판별 로직
- 결산 요약 카드의 "스토어 결제금액" 분기: `filter.mallType === "스마트스토어"` → `filter.mallType !== "" && filter.mallType !== "자사몰"`
- 네이버페이 분리 로직 (orders.naver_amount): 이미 `mall_type === "자사몰"`만 적용 중 → 변경 없음
- 기타 `=== "스마트스토어"` 비교 사용 위치 점검 후 `!== "자사몰"`로 일반화

### `MALL_TYPES` 상수
```js
const MALL_TYPES = ["자사몰","스마트스토어"];
```
- 그대로 유지 (브랜드 추가 모달에서 새 브랜드 만들 때 default mall 후보)
- 팔레오의 mall_types는 SQL 마이그레이션으로 직접 설정

### Drawer / 본문 헤더 / 결산 화면
- 모두 `brand.mall_types` 또는 `currentMallType` 값을 그대로 노출하므로, DB만 갱신하면 자동 반영
- 도깨비나라 클릭 시 본문 헤더에 `🟢 팔레오 · 🛍️ 도깨비나라` 표시 (현재 `MALL_TYPE_COLORS["도깨비나라"]` 색상 사용)
- 미연동 라벨: `brand.mallTypes?.includes(t) ?? false` 검사. 팔레오의 도깨비나라는 brand.mallTypes에 포함되므로 미연동 표시 안 됨 (아프리모 스마트스토어처럼)

### 모바일/데스크탑 mall 아이콘
현재 코드: `t === "자사몰" ? "🏪" : "🛍️"` — 이 그대로 유지 (자사몰만 🏪, 그 외 모두 🛍️)

## 백엔드 변경

### `server/sync.js`

기존:
```js
const SMARTSTORE_BRAND_IDS = ["팔레오_id", "코코엘_id"];
```

변경:
```js
const SMARTSTORE_TARGETS = [
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "브랜드스토어", credAlias: "PALEO" },
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "도깨비나라",   credAlias: "DOKEBI" },
  { brandId: "0a37b281-f262-4402-979c-e63a739bee53", mallType: "스마트스토어",  credAlias: "COCOEL" },
];
```

`syncBrand` 시그니처를 `syncTarget(target, startDate, endDate)`로 바꿔, 각 target에 대해:
1. `${target.credAlias}_APP_ID` / `${target.credAlias}_APP_SECRET` 환경변수 존재 확인
2. **없으면 경고 로그 출력 후 스킵** (이 target은 동기화 안 됨, 다음 target 진행)
3. proxy 호출 시 `?brandId=X&mallType=Y` 두 파라미터 전달
4. 수집된 주문은 `mall_type: target.mallType`으로 upsert

자격증명 누락 처리 예시:
```
⚠️ [도깨비나라] DOKEBI_APP_ID/DOKEBI_APP_SECRET 미설정 → 동기화 스킵
```

이로써 사용자가 .env에 도깨비나라 자격증명을 채우기 전 자동 동기화는 정상 동작하면서 도깨비나라만 스킵된다.

### `server/proxy.js`

기존: `?brandId=X` → brandId로 credentials 매핑

변경: `?brandId=X&mallType=Y` → `(brandId, mallType)` 조합으로 매핑

내부 매핑 테이블:
```js
const STORE_CRED_ALIAS = {
  "fd66b113-548b-44b0-8510-b7f49e302145|브랜드스토어": "PALEO",
  "fd66b113-548b-44b0-8510-b7f49e302145|도깨비나라":   "DOKEBI",
  "0a37b281-f262-4402-979c-e63a739bee53|스마트스토어":  "COCOEL",
};

function getCreds(brandId, mallType) {
  const key = `${brandId}|${mallType}`;
  const alias = STORE_CRED_ALIAS[key];
  if (!alias) return null;
  const id = process.env[`${alias}_APP_ID`];
  const secret = process.env[`${alias}_APP_SECRET`];
  if (!id || !secret) return null;
  return { id, secret, alias };
}
```

에러 응답 정책:
- 알 수 없는 `(brandId, mallType)` 조합 → **404** (not configured)
- 매핑은 있으나 자격증명 env 미설정 → **503** (service unavailable)
- 기존 Naver Commerce API 인증 실패 (토큰 만료 등) → **401** (변경 없음)

### `.env` 신규 항목

```
# 신규 (사용자가 도깨비나라 Naver Commerce 앱 등록 후 추가)
DOKEBI_APP_ID=
DOKEBI_APP_SECRET=
```

기존 PALEO_*, COCOEL_* 자격증명 그대로 유지.

### Frontend의 SmartStore 동기화 모달

기존: 🔗 버튼 클릭 → 모달에서 brandId로 sync 트리거
변경: 모달이 현재 mall_type도 알아야 함. drawer에서 🔗 클릭 시 `setSmartStoreBrand(currentBrand)`만 호출하던 걸, mall_type도 함께 저장 → 모달이 sync 시 `?brandId=X&mallType=Y` 전송.

State 추가:
```js
const [smartStoreMallType, setSmartStoreMallType] = useState("");
```

🔗 onClick 시 `setSmartStoreMallType(t)`도 호출.

## README 업데이트

기존 "스마트스토어 연동 (팔레오, 코코엘)" 섹션:
- 팔레오는 2개 스토어(브랜드스토어 + 도깨비나라) 명시
- 환경변수 섹션에 `DOKEBI_APP_ID/SECRET` 추가
- 자동 동기화 섹션: 8시/17시 cron이 3 stores 모두 처리, 자격증명 누락 시 해당 store만 스킵

## 영향 범위 / 변경 파일

| 파일 | 변경 |
|------|------|
| `src/App.js` | MALL_TYPE_COLORS 확장, "스마트스토어" 비교 로직 일반화, smartStoreMallType state 추가 |
| `server/sync.js` | SMARTSTORE_BRAND_IDS → SMARTSTORE_TARGETS, syncBrand → syncTarget |
| `server/proxy.js` | brandId-only credentials → (brandId, mallType) credentials |
| `README.md` | 환경변수, 자동 동기화 설명 갱신 |
| Supabase (SQL) | `brands.mall_types` 갱신 + `orders.mall_type` 마이그레이션 |

## 비목표 (Out of Scope)

- 브랜드 모달에서 커스텀 mall 이름 입력 UI (다른 브랜드가 새 store name 추가하려면 SQL로 직접 수정)
- 도깨비나라 외 추가 스토어 동적 등록
- 자동 동기화 시 도깨비나라 자격증명 받기 전후의 데이터 일관성 검증
- 결산조회 본문에서 자사몰/스마트스토어 합산 옵션 (현재 단일 mall만 조회)

## 검증 기준

- [ ] DB 마이그레이션 후 사이드바에서 팔레오 클릭 → drawer에 [자사몰 | 브랜드스토어 | 도깨비나라] 3개 표시
- [ ] 코코엘 클릭 → drawer에 [자사몰 | 스마트스토어] 그대로
- [ ] 팔레오 → 브랜드스토어 → 결산조회: 마이그레이션된 기존 주문 정상 표시
- [ ] 팔레오 → 도깨비나라 → 결산조회: 비어있음 (아직 동기화 전이라 정상)
- [ ] 팔레오 → 도깨비나라 → 🔗 동기화 모달: brandId + mallType=도깨비나라 전달
- [ ] DOKEBI_APP_ID 미설정 상태에서 8시 cron 실행: 도깨비나라만 스킵, 브랜드스토어/코코엘은 정상 동기화
- [ ] DOKEBI_APP_ID 설정 후 cron 실행: 도깨비나라 주문도 수집되어 mall_type='도깨비나라'로 저장
- [ ] 결산 요약 카드 "스토어 결제금액" 라벨이 도깨비나라/브랜드스토어/스마트스토어 모두에서 표시 (자사몰일 때만 "자사몰 결제금액")
- [ ] proxy.js 직접 호출 시 (brandId, mallType) 매핑 안 된 조합 → 적절한 에러 반환
