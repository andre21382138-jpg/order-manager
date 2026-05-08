# 네이버 광고 — 키워드별 성과 (3단계, Phase 1: A+B)

작성일: 2026-05-08
대상: `src/App.js`, `api/naver-ad.js`, Supabase
선행 변경: `2026-05-08-naver-ad-campaign-stats-design.md` (2단계 — 캠페인별)

## 배경

캠페인별 성과까지는 운영 의사결정의 큰 그림. 그러나 실제 입찰가 조정/제외 키워드 등록 같은 광고 최적화의 핵심은 **키워드 단위**에서 결정됨. 사용자 의도:

- **A. 낭비 키워드 식별** — 광고비 큰데 전환 없는 키워드를 골라 입찰가 낮추거나 제외
- **B. 성공 키워드 푸시** — ROAS 높은 키워드를 골라 입찰가 올리거나 광고그룹 확장

(C. 트렌드 추적은 Phase 2로 별도 진행)

## 단계 분리

- **Phase 1 (이번)**: A+B — 기간 합산 키워드 성과 표
- **Phase 2 (추후)**: C — 일별 키워드 row + 트렌드 시각화 (사용자 확인 후 제안)

## 데이터 모델

### 신규 테이블: `naver_ad_keyword_stats`

```sql
CREATE TABLE naver_ad_keyword_stats (
  id BIGSERIAL PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  mall_type TEXT NOT NULL DEFAULT '자사몰',
  keyword_id TEXT NOT NULL,
  keyword_name TEXT,
  ad_group_id TEXT,
  ad_group_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  campaign_type TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  cost INT DEFAULT 0,
  conversions INT DEFAULT 0,
  conversion_value INT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT keyword_brand_mall_kw UNIQUE(brand_id, mall_type, keyword_id)
);

CREATE INDEX idx_kwstats_brand_mall ON naver_ad_keyword_stats(brand_id, mall_type);

ALTER TABLE naver_ad_keyword_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_keyword_stats" ON naver_ad_keyword_stats
  FOR ALL USING (auth.role() = 'authenticated');
```

**저장 패턴**: Truncate-and-insert per (brand_id, mall_type) per sync. 누적 안 함, 가장 최근 동기화 결과만 보유. Phase 2에서 일별 row로 확장하면 그 때 schema 변경.

`UNIQUE(brand_id, mall_type, keyword_id)` — 같은 브랜드 같은 키워드는 한 row만 (재동기화 시 DELETE 후 INSERT 또는 upsert).

추정 규모: 활성 키워드 ~5,000개/브랜드/sync × ~200B = **<1 MB/sync**. Supabase 무료 한도 충분.

## 백엔드 (`api/naver-ad.js`)

### 새 action: `keywords`

요청: `GET /api/naver-ad?action=keywords&brand={uuid}&from=YYYY-MM-DD&to=YYYY-MM-DD`

응답:
```json
{
  "keywords": [
    {
      "keyword_id": "nkw-...",
      "keyword_name": "다이어트 보조제",
      "ad_group_id": "grp-...",
      "ad_group_name": "그룹A",
      "campaign_id": "cmp-...",
      "campaign_name": "캠페인A",
      "campaign_type": "WEB_SITE",
      "impressions": 1200,
      "clicks": 80,
      "cost": 12000,
      "conversions": 3,
      "conversion_value": 30000
    }
  ],
  "_debug": { "campaignsScanned": 60, "adgroupsScanned": 180, "keywordsFetched": 4500, "elapsedMs": 35000 }
}
```

### 구현 흐름 (성능 최적화 핵심)

1. **활성 캠페인 식별** — 기존 `/ncc/campaigns` + `/stats` 일별 호출은 이미 기간 합산 광고비를 알게 해줌. 광고비 0인 캠페인 즉시 제외. (실제로 모든 호출 필요 없이 `/stats?ids=[allCampaignIds]&timeRange={since:from,until:to}` 한 번이면 됨)
2. **활성 광고그룹 식별** — 활성 캠페인에 대해서만 `/ncc/adgroups?nccCampaignId={id}` 호출 (Promise.all 병렬 제한 5). 그 다음 모든 adgroup ID들로 한방 `/stats?ids=[adgroupIds]&timeRange=...` → cost > 0 광고그룹만 남김
3. **활성 키워드 fetch** — 활성 광고그룹에 대해서만 `/ncc/keywords?nccAdgroupId={id}` 호출 (Promise.all 병렬 제한 5). 모든 키워드 ID 수집
4. **키워드 stats bulk** — `/stats?ids=[keywordIds]&fields=[impCnt,clkCnt,salesAmt,ccnt,convAmt]&timeRange=...`을 100개 ID씩 chunk해서 호출
5. **응답 가공** — keyword 메타 (name, adgroup_id/name, campaign_id/name/type) + stats 조인. cost > 0만 응답

### 타임아웃 안전장치

- Vercel 함수 한도 60초. 추정 15~40초. 안전 마진 있음.
- 만약 30초 초과 시 응답에 `_debug.partial: true` + 처리한 캠페인까지의 결과만 반환 → 프론트엔드는 alert으로 알림. (실제 발생 시 Phase 2에서 배치 오케스트레이션 도입)
- 1차 구현은 단일 호출. 그래도 모자르면 후속 개선.

## 프론트엔드 (`src/App.js`)

### 동기화 모달 변경

기존 캠페인 동기화 모달에 **체크박스 추가**:

```jsx
<label>
  <input
    type="checkbox"
    checked={syncKeywordsToo}
    onChange={e=>setSyncKeywordsToo(e.target.checked)}
  />
  키워드까지 동기화 (시간 추가 ~30~60초)
</label>
```

기본값: `false` (의도적 선택).

### 새 sync 함수: `syncNaverAdKeywords(brand, from, to)`

체크박스가 켜져 있을 때만 호출. 캠페인 동기화 완료 후 순차 실행.

```js
const r = await fetch(`/api/naver-ad?action=keywords&brand=${brand.id}&from=${from}&to=${to}`);
const data = await r.json();

await supabase.from("naver_ad_keyword_stats")
  .delete()
  .eq("brand_id", brand.id)
  .eq("mall_type", "자사몰");

const rows = (data.keywords || []).map(k => ({
  brand_id: brand.id,
  mall_type: "자사몰",
  keyword_id: k.keyword_id,
  keyword_name: k.keyword_name,
  ad_group_id: k.ad_group_id,
  ad_group_name: k.ad_group_name,
  campaign_id: k.campaign_id,
  campaign_name: k.campaign_name,
  campaign_type: k.campaign_type,
  period_start: from,
  period_end: to,
  impressions: k.impressions,
  clicks: k.clicks,
  cost: k.cost,
  conversions: k.conversions,
  conversion_value: k.conversion_value,
}));

if (rows.length > 0) {
  await supabase.from("naver_ad_keyword_stats").insert(rows);
}

setNaverAdSyncResult(prev => `${prev}\n✅ 키워드 ${rows.length}개 저장 완료`);
```

### 상태 + fetch

```js
const [naverKeywordStats, setNaverKeywordStats] = useState([]);
const [naverKeywordSearch, setNaverKeywordSearch] = useState("");
const [naverKeywordCampaignFilter, setNaverKeywordCampaignFilter] = useState(null); // null=전체, Set=선택된 campaign_id
const [showKeywordCampaignFilter, setShowKeywordCampaignFilter] = useState(false);
const [naverKeywordSort, setNaverKeywordSort] = useState({ key: "cost", dir: "desc" });
const [syncKeywordsToo, setSyncKeywordsToo] = useState(false);
```

useEffect (브랜드/기간 변경 시):
```js
supabase.from("naver_ad_keyword_stats")
  .select("*")
  .eq("brand_id", currentBrand.id)
  .eq("mall_type", currentMallType || "자사몰")
  .then(({ data }) => setNaverKeywordStats(data || []));
```

(period 필터 안 함 — 매번 truncate-and-insert이라 항상 최신 동기화 기간만 있음)

### UI: 새 카드 — 캠페인별 표 아래

```
🔑 키워드별 광고 성과 (기간: {period_start} ~ {period_end})
[검색 input] [✕ 필터 해제]

| 키워드명 | 캠페인 ▼ | 광고영역 | 광고비 ▼ | 노출 | 클릭 | CTR | CPC | 전환수 | 전환매출 | ROAS |
| 다이어트... | 캠페인A | 파워링크 | 12,000 | 1,200 | 80 | 6.7% | 150 | 3 | 30,000 | 250% |
```

기능:
- **검색**: 키워드명 검색 (캠페인별 표와 동일 패턴)
- **캠페인 필터**: 캠페인명으로 체크박스 필터 (광고영역 필터와 동일 패턴)
- **정렬**: 모든 숫자 컬럼 클릭 정렬 (캠페인별 표와 동일 패턴)
- **빈 상태**: 키워드 0건일 때 "키워드 동기화 미수행 — 동기화 모달에서 키워드까지 동기화 체크 후 다시 동기화" 메시지
- 광고비 0 키워드 자동 제외 (DB에 저장 시점에 이미 제외됨)
- 정렬 기본값: 광고비 내림차순

### 캠페인별 표와의 일관성

**같은 패턴 재사용** (코드 중복 줄이기보다는 동작 일관성 우선):
- 검색 input 위치/스타일
- 필터 팝업 (광고영역 → 캠페인으로 컬럼만 다름)
- 정렬 헤더 클릭 + ▼/▲ 화살표
- 빈 상태 행 (`tbody colSpan` row)

## 영향 범위

| 파일 | 변경 |
|------|------|
| Supabase | 신규 테이블 `naver_ad_keyword_stats` + RLS 정책 + 인덱스 |
| `api/naver-ad.js` | action=keywords 분기 추가, 활성 캠페인/광고그룹 필터, bulk /stats |
| `src/App.js` | syncKeywordsToo 체크박스, syncNaverAdKeywords 함수, naverKeywordStats state 그룹, useEffect fetch, 키워드별 표 카드 |

## 비목표 (Phase 1)

- C. 트렌드 추적 (일별 키워드 row) — Phase 2
- 키워드 입찰가 표시 / 변경
- 매칭타입 (정확/구문/광범위) 표시
- 검색어 보고서 (사용자가 검색한 실제 쿼리)
- 광고 소재(ad creative) 단위 성과
- 키워드 비교 (지난 기간 vs 이번 기간)
- 자동 동기화 (cron)

## 검증 기준

- [ ] Supabase에 `naver_ad_keyword_stats` 테이블 + RLS + 인덱스 생성
- [ ] 동기화 모달에 "키워드까지 동기화" 체크박스 노출, 기본 off
- [ ] 체크 안 한 상태로 동기화 → 캠페인까지만 동기화 (기존 동작 그대로)
- [ ] 체크하고 동기화 → 캠페인 + 키워드 양쪽 결과 메시지 노출, 키워드 N개 저장
- [ ] 동기화 시간 60초 이내 (팔레오 기준)
- [ ] DB에 활성 키워드만 저장 (cost > 0)
- [ ] 키워드별 카드 표시: 광고비 내림차순 기본 정렬
- [ ] 컬럼: 키워드명 / 캠페인 / 광고영역 / 광고비 / 노출 / 클릭 / CTR / CPC / 전환수 / 전환매출 / ROAS (11개)
- [ ] 검색: 키워드명 부분일치
- [ ] 캠페인 필터: 캠페인명 체크박스 다중 선택 + "필터 해제" 단축 버튼
- [ ] 정렬: 모든 숫자 컬럼 헤더 클릭 정렬, ▼/▲ 표시
- [ ] 빈 상태: 키워드 0건이면 "동기화 모달에서 키워드까지 동기화 체크" 안내 메시지
- [ ] 다른 브랜드/mall로 이동 시 키워드 표 적절히 갱신
- [ ] Phase 1 데이터(period_aggregate)와 Phase 2 데이터(일별)가 섞이지 않게 schema 분리 가능한 구조

## 성능/타임아웃 처리

- 추정 동기화 시간 (팔레오 기준): 활성 캠페인 30~60개 → 활성 광고그룹 50~120개 → 활성 키워드 1000~3000개 → API 호출 ~150~300회 (병렬 5) → **15~40초**
- Vercel 60초 한도 내. 안전 마진 50% 이상.
- 응답에 `_debug.elapsedMs` 포함하여 사용자/디버깅 용이
- 30초 초과 + 미완료 시 frontend에 alert (1차 구현은 단순, 후속 개선 여지)
