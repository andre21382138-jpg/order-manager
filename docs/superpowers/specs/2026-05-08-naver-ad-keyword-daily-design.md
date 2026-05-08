# 네이버 광고 — 일자별 조회 (Phase 2a)

작성일: 2026-05-08
대상: `src/App.js`, `api/naver-ad.js`, Supabase
선행 변경: `2026-05-08-naver-ad-keyword-stats-design.md` (Phase 1: 키워드별 기간 합산)

## 배경

Phase 1은 기간 합산 키워드 성과 표시. 사용자 피드백:

> "어차피 어제날짜까지 동기화니깐 동기화 해서 나온 데이터를 가지고 다양한 형태로 보는거잖아? 광고 동기화는 하루에 여러차례 할 필요가 없어."

광고 데이터는 D-1 한도라 동기화는 자주 필요 없고, **한 번 동기화한 데이터로 다양한 뷰** 제공이 핵심 가치. 첫 추가 뷰는 "특정 날짜만 보기".

## 단계 분리

- **Phase 1 완료**: 기간 합산 키워드 성과
- **Phase 2a (이번)**: 일자별 단일 날짜 뷰 — 특정 날짜 선택 시 KPI/광고영역/캠페인/키워드 모두 그 날 데이터로
- **Phase 2b (추후)**: 트렌드 라인 차트 (키워드 row 클릭 → 일별 변화)
- 향후 후보: 두 날짜 비교, 광고그룹/소재 단위, 검색어 보고서

## 데이터 모델

### `naver_ad_keyword_stats` 스키마 변경

기존 (Phase 1):
```sql
period_start DATE NOT NULL,
period_end DATE NOT NULL,
CONSTRAINT keyword_brand_mall_kw UNIQUE(brand_id, mall_type, keyword_id)
```

변경 (Phase 2a):
```sql
ALTER TABLE naver_ad_keyword_stats DROP COLUMN period_start;
ALTER TABLE naver_ad_keyword_stats DROP COLUMN period_end;
ALTER TABLE naver_ad_keyword_stats ADD COLUMN date DATE NOT NULL;

ALTER TABLE naver_ad_keyword_stats DROP CONSTRAINT keyword_brand_mall_kw;
ALTER TABLE naver_ad_keyword_stats
  ADD CONSTRAINT keyword_brand_mall_kw_date UNIQUE(brand_id, mall_type, keyword_id, date);
```

기존 데이터는 새 sync 때 자연스럽게 채워지므로 마이그레이션 불필요. 단, NOT NULL 컬럼 추가하려면 기존 데이터 truncate가 필요:

```sql
-- 마이그레이션 순서
TRUNCATE naver_ad_keyword_stats;
ALTER TABLE naver_ad_keyword_stats DROP COLUMN period_start;
ALTER TABLE naver_ad_keyword_stats DROP COLUMN period_end;
ALTER TABLE naver_ad_keyword_stats ADD COLUMN date DATE NOT NULL;
ALTER TABLE naver_ad_keyword_stats DROP CONSTRAINT keyword_brand_mall_kw;
ALTER TABLE naver_ad_keyword_stats
  ADD CONSTRAINT keyword_brand_mall_kw_date UNIQUE(brand_id, mall_type, keyword_id, date);
CREATE INDEX IF NOT EXISTS idx_kwstats_brand_mall_date
  ON naver_ad_keyword_stats(brand_id, mall_type, date);
```

추정 규모 변화:
- Phase 1: ~5,000 row/sync (브랜드별 기간 합산 1행/키워드)
- Phase 2a: ~5,000 × N일 = 7일 기준 ~35,000 row/sync. 한 달 30일 기준 ~150,000 row.
- 200B/row 가정 시 30일 기준 ~30 MB/브랜드. Supabase 무료 500MB 한도 내 (브랜드 10개 동시 운영 가정해도 300MB).

`naver_ad_stats` (캠페인 레벨)는 변경 없음. 이미 `(brand_id, mall_type, date, campaign_id)` UNIQUE로 일별 row 저장 중.

## 백엔드 (`api/naver-ad.js`)

### `action=keywords` per-day 루프 변경

**기존 (Phase 1)**: 한 번의 `/stats?timeRange={since:from,until:to}` 호출로 기간 합산 stats 받음.

**변경 (Phase 2a)**: 일자별로 N번 호출. 캠페인 stats와 동일 패턴.

```js
// 1~5단계 (활성 캠페인/광고그룹/키워드 식별) 동일

// 6. 키워드 stats — 일자별 × 100개 chunk
const dates = [];
let cursor = new Date(`${from}T00:00:00Z`);
const endD = new Date(`${to}T00:00:00Z`);
while (cursor <= endD) {
  dates.push(cursor.toISOString().slice(0, 10));
  cursor = new Date(cursor.getTime() + 86400000);
}

const keywordChunks = chunkIds(allKeywordIds);
// 각 날짜 × 각 chunk 조합으로 호출 작업 단위 생성
const tasks = [];
for (const day of dates) {
  for (const chunk of keywordChunks) {
    tasks.push({ day, chunk });
  }
}

const taskResults = await parallelLimit(tasks, 5, async ({ day, chunk }) => {
  const dayRange = JSON.stringify({ since: day, until: day });
  const uri = `/stats?ids=${encodeURIComponent(chunk.join(","))}&fields=${encodeURIComponent(keywordFields)}&timeRange=${encodeURIComponent(dayRange)}&datePreset=custom`;
  const r = await naverAdGet(uri, creds);
  if (!r.ok) { warnings.push({ stage: "keyword_stats", date: day, status: r.status }); return []; }
  return (r.data?.data || []).map(s => ({ ...s, _date: day }));
});
const dayKeywordStats = taskResults.flat();
```

**응답 가공**: 키워드 row에 `date` 필드 추가, cost > 0 필터링은 동일.

```js
const keywords = dayKeywordStats
  .filter(s => Number(s.salesAmt || 0) > 0)
  .map(s => ({
    keyword_id: s.id,
    keyword_name: idToKeyword[s.id]?.name || s.id,
    ad_group_id, ad_group_name, campaign_id, campaign_name, campaign_type,
    date: s._date,
    impressions: ..., clicks: ..., cost: ..., conversions: ..., conversion_value: ...,
  }));
```

`_debug`에 `dayCount: dates.length` 추가.

### 예상 시간

- 키워드 ID 124개, 7일 기준: 7 × 2 chunks(100/100) = 14개 task. parallelLimit 5에서 ~3 batches.
- 1 batch ≈ 3초 → 9초. 총 동기화 시간 21초 → ~35~50초 추정.
- 30일 기간 sync: 30 × 2 = 60 task → 12 batches → ~36초 추가. 총 ~60~90초. 60초 Vercel 한도 근접 — **30일 sync는 위험**. 안전망: 사용자에게 "긴 기간은 시간 더 걸림" 안내.

## 프론트엔드 (`src/App.js`)

### 새 state

```js
const [naverAdDateFilter, setNaverAdDateFilter] = useState(""); // "" = 전체 기간, "YYYY-MM-DD" = 특정 날짜
```

### 광고 탭 상단 날짜 셀렉터

광고 탭 헤더 영역(`📣 네이버 검색광고 — {brand}`와 동기화 버튼 사이)에 dropdown 추가:

```jsx
<select
  value={naverAdDateFilter}
  onChange={e => setNaverAdDateFilter(e.target.value)}
  style={{ padding:"7px 12px", borderRadius:8, border:"1px solid #E2E8F0", fontSize:13, background:"white", cursor:"pointer" }}
>
  <option value="">📅 전체 기간</option>
  {availableDates.map(d => (
    <option key={d} value={d}>{formatKoreanDate(d)}</option>
  ))}
</select>
```

`availableDates`는 `naverAdStats` (일별 표 데이터)의 unique dates. 동기화한 기간만 표시.

### KPI 카드 / 광고영역별 / 캠페인별 / 키워드별 — 날짜 필터 적용

각 영역의 데이터 source를 conditional하게:

**KPI 카드 (광고비/노출/클릭/CTR)**:
- `naverAdDateFilter === ""` 이면 기존 그대로 (period sum)
- 특정 날짜면 `naverAdStats.filter(r => r.date === naverAdDateFilter)` 의 합산

**일별 광고 성과 표**:
- `naverAdDateFilter === ""` 이면 표시 (현재 그대로)
- 특정 날짜면 **카드 자체 숨김** (1행 짜리 무의미)

**광고영역별 광고 성과 표**:
- naver_ad_stats에서 캠페인별 row(`campaign_id != ''`)를 그룹핑해서 광고영역별 합산
- 날짜 필터 적용: `WHERE date = naverAdDateFilter` 또는 클라이언트 사이드 필터

**캠페인별 광고 성과 표**:
- 현재 `naverCampaignStats`는 `syncNaverAdStats` 안에서 period 합산을 계산해 저장된 상태.
- **변경 방향**: 캠페인 raw 일별 row를 별도 state(`naverCampaignRawRows`)로 보유하고, 렌더 시점에 `naverAdDateFilter`에 따라 합산.
  - `naverAdDateFilter === ""` → 전체 raw row를 캠페인별 sum
  - 특정 날짜 → 그 날짜 row만 캠페인별 (1행/캠페인) 표시
- 동기화 함수와 brand/mall useEffect 양쪽에서 raw rows 갱신.

**키워드별 광고 성과 표**:
- `naverKeywordStats` 자체가 일별 row 저장 (Phase 2a 변경 후)
- 날짜 필터: `naverKeywordStats.filter(k => k.date === naverAdDateFilter)`
- 그 후 검색·필터·정렬 적용

### useEffect / 합산 로직 변경

기존 캠페인별 합산 useEffect는 `WHERE campaign_id != ''` 가져와서 sum. 이제 날짜 필터를 추가:

```js
const campaignSourceRows = naverAdDateFilter
  ? refreshedCamp.filter(r => r.date === naverAdDateFilter)
  : refreshedCamp;
// 이후 byCampaign 합산
```

키워드 합산은 useEffect로 가져온 `naverKeywordStats` 전체에서 날짜 필터 적용 후 키워드별 sum (날짜 필터 없으면 키워드별 합산, 있으면 그 날짜만 row).

## 영향 범위

| 파일 | 변경 |
|------|------|
| Supabase | `naver_ad_keyword_stats` 스키마 변경 (period 컬럼 제거, date 추가, UNIQUE 변경, 인덱스 추가). 기존 데이터 truncate. |
| `api/naver-ad.js` | `action=keywords` per-day 루프, 응답 row에 `date` 필드 |
| `src/App.js` | `naverAdDateFilter` state, 셀렉터 dropdown, KPI/광고영역/캠페인/키워드 표 모두 날짜 필터 반영, 일별표는 단일 날짜 모드에서 숨김 |

## 비목표 (Phase 2a)

- B. 트렌드 라인 차트 (Phase 2b)
- 두 날짜 비교 모드
- 광고그룹/소재 단위
- 검색어 보고서
- 자동 동기화 cron

## 검증 기준

- [ ] DB 마이그레이션 SQL 실행 — 키워드 테이블 truncate, 컬럼 변경, UNIQUE 변경, 인덱스 추가
- [ ] 동기화 후 키워드 row가 일별로 저장 (브랜드 팔레오 7일 sync → ~35,000 row 예상)
- [ ] 동기화 시간 60초 이내 (7일 기준)
- [ ] 광고 탭 상단에 날짜 셀렉터 노출, default = "전체 기간"
- [ ] 동기화하지 않은 날짜는 옵션에 안 보임
- [ ] **전체 기간** 모드: 모든 표 기존과 동일 동작 (회귀 없음)
- [ ] **특정 날짜** 선택 시:
  - KPI 카드 4개가 그 날 합산으로 갱신
  - 일별 표 카드 자체 숨김
  - 광고영역별 표가 그 날 데이터로
  - 캠페인별 표가 그 날 캠페인별 row 직접 표시 (이미 일별로 저장됨)
  - 키워드별 표가 그 날 키워드 row 표시
- [ ] 캠페인별/키워드별 표의 검색·필터·정렬 UX 단일 날짜 모드에서도 동일하게 동작
- [ ] 다른 브랜드/mall 이동 시 날짜 셀렉터도 동기화 데이터에 맞춰 옵션 갱신
- [ ] 60초 초과 시 frontend에 경고 (현재 30초 추정 → 안전 마진 큰 편)

## 리스크와 대응

**1. 동기화 시간 한도**
- 추정 35~50초 (7일). 30일 sync 시 60초 근접 → 위험.
- 대응: 우선 7일 default로 고정, 30일 옵션은 사용자 경고 함께 표시. Phase 2b 이후 배치 오케스트레이션 도입 검토.

**2. 데이터 일치 (캠페인 vs 키워드)**
- `naver_ad_stats`는 이미 일별 저장. `naver_ad_keyword_stats`도 일별로 변경.
- 두 테이블의 date 컬럼이 일관되게 채워져야 캠페인 표와 키워드 표가 같은 "그날" 데이터를 보여줌.
- API에서 동일 timeRange 사용하므로 자연스럽게 일치.

**3. 마이그레이션 데이터 손실**
- 기존 Phase 1 데이터(period aggregate)는 truncate. 사용자가 다시 동기화 필요.
- 마이그레이션 SQL 실행 직후 사용자에게 "재동기화 필요" 안내.

**4. 셀렉터 UX**
- 동기화한 일자만 옵션 → 안 보이는 날짜 사용자가 혼란할 수 있음.
- 옵션 텍스트에 "5/1 (월)" 형식으로 요일 함께 표시하여 가독성 향상.
