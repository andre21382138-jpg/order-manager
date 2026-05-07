# 네이버 광고 — 캠페인별 성과 (2단계)

작성일: 2026-05-08
대상: `src/App.js`, `api/naver-ad.js`
선행 변경: `2026-05-07-naver-ad-integration-design.md` (1단계)

## 배경

1단계로 일별 광고비 + ROAS 표시를 구현 완료. 다음 단계로 광고 운영자가 어느 캠페인이 잘 돌아가는지 의사결정할 수 있도록 캠페인별 성과(노출/클릭/광고비/전환/ROAS)를 추가.

## 단계 분리

- **1단계 완료**: 일별 합산.
- **2단계 (이번)**: 캠페인별 기간 합산 표.
- **3단계 (추후)**: 일별 row 클릭 → 그 날의 캠페인별 펼침 (확장형) 또는 별도 탭. 사용자가 운영해보고 결정.

## 데이터 모델 (스키마 변경 없음)

기존 `naver_ad_stats` 테이블 그대로 활용:
- `campaign_id=''` 일별 합산 row (1단계, 기존)
- `campaign_id='cmp-xxx', campaign_name='캠페인명'` 캠페인별 일별 row (2단계, 신규)
- UNIQUE(brand_id, date, campaign_id) 제약이 두 종류 row 공존 처리

스토리지 추정: 팔레오 166 캠페인 × 30일 = ~5,000 row/월. 무리 없음.

## 백엔드 (api/naver-ad.js)

### 응답 구조 변경
기존:
```json
{ "stats": [...], "_debug": {...} }
```
변경:
```json
{
  "stats": [
    {"date":"2026-05-07","impressions":18000,"clicks":500,"cost":50000,"conversions":12,"conversion_value":120000},
    ...
  ],
  "campaigns": [
    {"date":"2026-05-07","campaign_id":"cmp-a001-...","campaign_name":"캠페인A","impressions":10000,"clicks":300,"cost":30000,"conversions":7,"conversion_value":70000},
    ...
  ],
  "_debug": {...}
}
```

### 구현 흐름
1. `/ncc/campaigns` 호출 → 캠페인 목록. `nccCampaignId`와 `name` 추출, id→name 맵 생성.
2. 각 일자 별로 `/stats?ids=...&timeRange={since:day,until:day}` 호출 → 응답이 캠페인별 row.
3. 두 가지 형태로 가공:
   - **stats[]**: 일별로 캠페인 합산 (기존과 동일)
   - **campaigns[]**: 일자 + 캠페인 ID + 이름 + 통계 그대로 (campaign_id로 name 조인)
4. 광고비 0인 캠페인 row는 응답에서 제외 (저장 노이즈 감소)

## 프론트엔드

### sync 함수 (`syncNaverAdStats`)

응답의 두 배열을 모두 upsert:
```js
const dailyRows = (data.stats || []).map(s => ({
  brand_id: brand.id,
  mall_type: "자사몰",
  date: s.date,
  campaign_id: "",
  campaign_name: null,
  impressions: s.impressions, clicks: s.clicks, cost: s.cost,
  conversions: s.conversions, conversion_value: s.conversion_value,
}));
const campaignRows = (data.campaigns || []).map(c => ({
  brand_id: brand.id,
  mall_type: "자사몰",
  date: c.date,
  campaign_id: c.campaign_id,
  campaign_name: c.campaign_name,
  impressions: c.impressions, clicks: c.clicks, cost: c.cost,
  conversions: c.conversions, conversion_value: c.conversion_value,
}));
const allRows = [...dailyRows, ...campaignRows];
await supabase.from("naver_ad_stats").upsert(allRows, { onConflict: "brand_id,date,campaign_id" });
```

성공 메시지: `✅ ${dailyRows.length}일 × ${campaignRows.length} 캠페인 row 저장 완료`

### 상태 + fetch

추가 state:
```js
const [naverCampaignStats, setNaverCampaignStats] = useState([]);  // 캠페인별 기간 합산
```

useEffect는 기존 일별 fetch + 캠페인별 fetch를 병행:
```js
// 캠페인별 row fetch + 캠페인별 기간 합산
supabase.from("naver_ad_stats")
  .select("*")
  .eq("brand_id", currentBrand.id)
  .eq("mall_type", "자사몰")
  .neq("campaign_id", "")
  .gte("date", filter.from)
  .lte("date", filter.to)
  .then(({ data }) => {
    const byCampaign = {};
    (data || []).forEach(r => {
      if (!byCampaign[r.campaign_id]) byCampaign[r.campaign_id] = {
        campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0
      };
      const c = byCampaign[r.campaign_id];
      c.impressions += r.impressions || 0;
      c.clicks += r.clicks || 0;
      c.cost += r.cost || 0;
      c.conversions += r.conversions || 0;
      c.conversion_value += r.conversion_value || 0;
    });
    const filtered = Object.values(byCampaign)
      .filter(c => c.cost > 0)
      .sort((a, b) => b.cost - a.cost);
    setNaverCampaignStats(filtered);
  });
```

### UI 변경

1. **일별 광고 성과 표** — ROAS 컬럼 제거
   - 컬럼: 날짜 / 광고비 / 노출 / 클릭 / CTR / 자사몰매출 (6개)

2. **캠페인별 광고 성과 표 (신규 카드, 일별 표 아래)**
   - 헤더: 📣 캠페인별 광고 성과
   - 컬럼: 캠페인명 / 광고비 / 노출 / 클릭 / CTR / 전환수 / 전환매출 / ROAS (8개)
   - CTR = 클릭 ÷ 노출 × 100
   - ROAS = 전환매출 ÷ 광고비 × 100 (광고 직접 ROAS, Naver attributed)
   - 정렬: 광고비 내림차순
   - 필터: 합산 광고비 > 0 캠페인만 (이번 기간 미사용 캠페인 자동 숨김)
   - 빈 상태: `naverCampaignStats.length === 0`이면 카드 전체 숨김 (간결성)

## 영향 범위

| 파일 | 변경 |
|------|------|
| `api/naver-ad.js` | 응답에 campaigns[] 추가, /ncc/campaigns에서 name 추출, 캠페인별 row 가공 |
| `src/App.js` | 일별 표 ROAS 컬럼 제거, 캠페인별 표 신규, naverCampaignStats state, useEffect에 캠페인별 fetch 추가, syncNaverAdStats가 두 배열 upsert |
| Supabase | 변경 없음 (campaign_id 컬럼 기존 활용) |

## 비목표 (2단계)

- 일별 row 클릭 → 캠페인별 펼침 (3단계)
- 캠페인별 row 별도 탭 분리 (3단계)
- 키워드별 성과
- cron 자동 동기화
- 캠페인별 자사몰 매출 매칭 (Naver attribute conversion만 사용 가능, 자사몰 매출은 캠페인 분리 불가)

## 검증 기준

- [ ] 동기화 후 응답에 `campaigns[]` 배열 포함, 광고비 > 0인 캠페인만 포함
- [ ] DB에 `campaign_id != ''` row가 캠페인 × 일자 수만큼 저장
- [ ] 결과 메시지: "N일 × M 캠페인 row 저장 완료"
- [ ] 일별 광고 성과 표에서 ROAS 컬럼 사라짐 (6개 컬럼)
- [ ] 일별 표 아래에 캠페인별 광고 성과 카드 노출
- [ ] 캠페인별 표가 광고비 내림차순 정렬
- [ ] 광고비 0인 캠페인은 표에서 제외
- [ ] CTR / ROAS 계산 정상 (노출 0 또는 광고비 0이면 안전 fallback)
- [ ] 활성 캠페인 0개일 때 캠페인별 카드 숨김 (또는 빈 상태 메시지)
- [ ] 다른 브랜드 / 다른 mall로 이동 시 캠페인별 표도 적절히 갱신/숨김
- [ ] 기존 1단계 데이터 (campaign_id='') 행과 새 캠페인별 데이터가 섞이지 않음 (각각 다른 select)
