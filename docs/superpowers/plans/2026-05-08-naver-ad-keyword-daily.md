# 네이버 광고 일자별 조회 (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 광고 탭에 단일 날짜 셀렉터 추가 — 한 번 동기화한 데이터로 "전체 기간" 또는 "특정 날짜" 양쪽 뷰 제공.

**Architecture:** `naver_ad_keyword_stats`를 일별 row 저장으로 schema 변경. 프론트엔드는 `naverCampaignRawRows` + `naverKeywordStats(일별)`를 raw로 보유하고 렌더 시점에 dateFilter에 따라 합산/필터.

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), Vercel serverless function, Naver Search Ad API

**Spec:** `docs/superpowers/specs/2026-05-08-naver-ad-keyword-daily-design.md`

---

### Task 1: Supabase 스키마 마이그레이션 + 재동기화 안내

**Files:**
- Manual SQL execution in Supabase Dashboard (no code file)

- [ ] **Step 1: Supabase Dashboard → SQL Editor에서 다음 SQL 실행**

```sql
-- 기존 데이터 truncate (period 단위 데이터는 의미 없어짐)
TRUNCATE naver_ad_keyword_stats;

-- 컬럼 변경
ALTER TABLE naver_ad_keyword_stats DROP COLUMN period_start;
ALTER TABLE naver_ad_keyword_stats DROP COLUMN period_end;
ALTER TABLE naver_ad_keyword_stats ADD COLUMN date DATE NOT NULL;

-- UNIQUE 제약 변경
ALTER TABLE naver_ad_keyword_stats DROP CONSTRAINT keyword_brand_mall_kw;
ALTER TABLE naver_ad_keyword_stats
  ADD CONSTRAINT keyword_brand_mall_kw_date UNIQUE(brand_id, mall_type, keyword_id, date);

-- 신규 인덱스 (date 포함 조회 성능용)
CREATE INDEX IF NOT EXISTS idx_kwstats_brand_mall_date
  ON naver_ad_keyword_stats(brand_id, mall_type, date);
```

- [ ] **Step 2: 검증**

Supabase Table Editor → `naver_ad_keyword_stats` → 컬럼 목록 확인:
- `period_start`, `period_end` 사라짐
- `date` 컬럼 신규 (DATE NOT NULL)
- Constraints 탭에서 `keyword_brand_mall_kw_date` UNIQUE 표시
- Indexes 탭에서 `idx_kwstats_brand_mall_date` 표시

기대 결과: 위 4가지 모두 확인. 데이터는 빈 상태(0 row).

---

### Task 2: API — `action=keywords` per-day 루프

**Files:**
- Modify: `api/naver-ad.js`

- [ ] **Step 1: Step 6(키워드 stats) 부분을 per-day 루프로 변경**

`api/naver-ad.js`의 `if (action === "keywords")` 블록 안, 기존:

```js
      // 6. 키워드 stats bulk (100개씩 chunk, 병렬 5)
      const keywordFields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const chunks = [];
      for (let i = 0; i < allKeywordIds.length; i += 100) {
        chunks.push(allKeywordIds.slice(i, i + 100));
      }
      const statsArrays = await parallelLimit(chunks, 5, async (chunk) => {
        const uri = `/stats?ids=${encodeURIComponent(chunk.join(","))}&fields=${encodeURIComponent(keywordFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
        const r = await naverAdGet(uri, creds);
        if (!r.ok) { warnings.push({ stage: "keyword_stats", chunkSize: chunk.length, status: r.status }); return []; }
        return r.data?.data || [];
      });
      const keywordStats = statsArrays.flat();
```

을 다음으로 통째 교체:

```js
      // 6. 키워드 stats — 일자별 × 100개 chunk (per-day loop)
      const keywordFields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const dates = [];
      let cursor = new Date(`${from}T00:00:00Z`);
      const endD = new Date(`${to}T00:00:00Z`);
      while (cursor <= endD) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor = new Date(cursor.getTime() + 86400000);
      }
      const keywordChunksPerDay = chunkIds(allKeywordIds);
      const tasks = [];
      for (const day of dates) {
        for (const chunk of keywordChunksPerDay) {
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
      const keywordStats = taskResults.flat();
```

- [ ] **Step 2: Step 7(응답 가공)에 date 필드 추가**

기존:
```js
      const keywords = keywordStats
        .filter(s => Number(s.salesAmt || 0) > 0)
        .map(s => {
          const kw = idToKeyword[s.id] || {};
          const ag = idToAdgroup[kw.adgroup_id] || {};
          const camp = idToCampaign[ag.campaign_id] || {};
          return {
            keyword_id: s.id,
            keyword_name: kw.name || s.id,
            ad_group_id: kw.adgroup_id || null,
            ad_group_name: ag.name || null,
            campaign_id: ag.campaign_id || null,
            campaign_name: camp.name || null,
            campaign_type: camp.type || null,
            impressions: Number(s.impCnt || 0),
            clicks: Number(s.clkCnt || 0),
            cost: Number(s.salesAmt || 0),
            conversions: Number(s.ccnt || 0),
            conversion_value: Number(s.convAmt || 0),
          };
        });
```

`return { ... }` 안에 `date: s._date,`를 `keyword_id` 다음 줄에 추가하면 됨. 즉 mapped 객체에:

```js
return {
  keyword_id: s.id,
  date: s._date,    // ← 추가
  keyword_name: kw.name || s.id,
  ...
};
```

- [ ] **Step 3: _debug에 dayCount 추가**

```js
return res.status(200).json({
  keywords,
  _debug: {
    campaignsScanned: activeCampaignIds.length,
    adgroupsScanned: activeAdgroupIds.length,
    keywordsFetched: allKeywordIds.length,
    keywordsActive: keywords.length,
    dayCount: dates.length,    // ← 추가
    warnings,
    elapsedMs: Date.now() - t0,
  },
});
```

- [ ] **Step 4: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대: 빌드 성공.

추가 syntax check:
```bash
node --check api/naver-ad.js
```

기대: SYNTAX_OK.

- [ ] **Step 5: 커밋**

```bash
git add api/naver-ad.js
git commit -m "feat(naver-ad-api): action=keywords per-day 루프 + date 필드"
```

---

### Task 3: Frontend — 데이터 레이어 리팩터 (raw rows + 일별 keyword)

이번 task의 목적: 프론트엔드 데이터 구조를 일별 row 기반으로 변경하면서 **UI는 외관상 동일**하게 유지(렌더 시점 합산). 다음 task에서 dateFilter UI 추가.

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: state 변경 — naverCampaignStats 제거, naverCampaignRawRows 도입**

`src/App.js`에서 `const [naverCampaignStats, setNaverCampaignStats] = useState([]);` 라인을 다음으로 교체:

```js
  const [naverCampaignRawRows, setNaverCampaignRawRows] = useState([]); // 캠페인별 raw 일별 row (campaign_id != ''인 naver_ad_stats row)
```

- [ ] **Step 2: syncNaverAdStats에서 setNaverCampaignStats 호출 제거, raw rows 직접 보유**

`syncNaverAdStats` 함수 안의 다음 블록:

```js
      // 캠페인별 row 갱신
      const { data: refreshedCamp } = await supabase.from("naver_ad_stats")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("mall_type", "자사몰")
        .neq("campaign_id", "")
        .gte("date", newFrom)
        .lte("date", newTo);
      const byCampaign = {};
      (refreshedCamp || []).forEach(r => {
        if (!byCampaign[r.campaign_id]) byCampaign[r.campaign_id] = {
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name || r.campaign_id,
          campaign_type: r.campaign_type || null,
          impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0
        };
        const c = byCampaign[r.campaign_id];
        c.impressions += r.impressions || 0;
        c.clicks += r.clicks || 0;
        c.cost += r.cost || 0;
        c.conversions += r.conversions || 0;
        c.conversion_value += r.conversion_value || 0;
      });
      setNaverCampaignStats(Object.values(byCampaign).filter(c => c.cost > 0).sort((a, b) => b.cost - a.cost));
      setNaverAdSyncResult(`✅ 일별 ${stats.length}건 + 캠페인 ${Object.keys(byCampaign).length}개 동기화 완료`);
```

을 다음으로 교체:

```js
      // 캠페인별 raw 일별 row 갱신 (렌더 시점 합산)
      const { data: refreshedCamp } = await supabase.from("naver_ad_stats")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("mall_type", "자사몰")
        .neq("campaign_id", "")
        .gte("date", newFrom)
        .lte("date", newTo);
      setNaverCampaignRawRows(refreshedCamp || []);
      const uniqueCampaigns = new Set((refreshedCamp || []).map(r => r.campaign_id));
      setNaverAdSyncResult(`✅ 일별 ${stats.length}건 + 캠페인 ${uniqueCampaigns.size}개 동기화 완료`);
```

- [ ] **Step 3: 캠페인 데이터 로드 useEffect도 raw rows로 변경**

기존 `naverCampaignStats` 로드 useEffect를 grep해서 찾고 (대략 600줄대), `setNaverCampaignStats(Object.values(byCampaign).filter(...))` 줄을 다음 패턴으로 변경:

```js
  useEffect(() => {
    if (!currentBrand?.id) { setNaverCampaignRawRows([]); return; }
    if (mainTab !== "광고") return;
    let alive = true;
    supabase.from("naver_ad_stats")
      .select("*")
      .eq("brand_id", currentBrand.id)
      .eq("mall_type", "자사몰")
      .neq("campaign_id", "")
      .gte("date", filter.from)
      .lte("date", filter.to)
      .then(({ data }) => { if (alive) setNaverCampaignRawRows(data || []); });
    return () => { alive = false; };
  }, [currentBrand?.id, filter.from, filter.to, mainTab]);
```

(찾을 때: `eq("brand_id", currentBrand.id)` + `neq("campaign_id", "")` 같이 있는 useEffect가 그것. 의존성/조건 패턴은 기존 그대로 유지하면서 setter만 raw rows로 변경)

- [ ] **Step 4: syncNaverAdKeywords의 row 매핑에서 period_start/period_end 제거, date 추가**

기존:
```js
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
        period_start: startDate,
        period_end: endDate,
        impressions: k.impressions,
        clicks: k.clicks,
        cost: k.cost,
        conversions: k.conversions,
        conversion_value: k.conversion_value,
      }));
```

을 다음으로 교체:

```js
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
        date: k.date,
        impressions: k.impressions,
        clicks: k.clicks,
        cost: k.cost,
        conversions: k.conversions,
        conversion_value: k.conversion_value,
      }));
```

- [ ] **Step 5: 캠페인별 표 IIFE 변경 — naverCampaignStats 사용 → naverCampaignRawRows를 렌더 시점 합산**

`{naverCampaignStats.length > 0 && (() => {` 으로 시작하는 IIFE를 grep으로 찾고, 그 안에서 `naverCampaignStats`를 직접 정렬·합산하는 로직을 raw rows를 합산하는 로직으로 변경:

기존 IIFE 시작 부분(검색·필터·정렬을 위한 source 데이터):
```js
                    {naverCampaignStats.length > 0 && (() => {
                      const q = naverCampaignSearch.trim().toLowerCase();
                      const availableTypes = Array.from(new Set(naverCampaignStats.map(c => c.campaign_type || ""))).sort();
                      const typeFilterActive = naverCampaignTypeFilter !== null && naverCampaignTypeFilter.size !== availableTypes.length;
                      const byType = typeFilterActive
                        ? naverCampaignStats.filter(c => naverCampaignTypeFilter.has(c.campaign_type || ""))
                        : naverCampaignStats;
                      const baseCampaigns = q ? byType.filter(c => (c.campaign_name||"").toLowerCase().includes(q)) : byType;
```

이 부분에서 `naverCampaignStats`를 사용하던 자리에 raw rows를 캠페인별로 합산한 결과를 사용하도록 변경:

```js
                    {naverCampaignRawRows.length > 0 && (() => {
                      // raw 일별 row를 캠페인별로 합산 (렌더 시점)
                      const aggCampaigns = {};
                      naverCampaignRawRows.forEach(r => {
                        if (!aggCampaigns[r.campaign_id]) aggCampaigns[r.campaign_id] = {
                          campaign_id: r.campaign_id,
                          campaign_name: r.campaign_name || r.campaign_id,
                          campaign_type: r.campaign_type || null,
                          impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0
                        };
                        const c = aggCampaigns[r.campaign_id];
                        c.impressions += r.impressions || 0;
                        c.clicks += r.clicks || 0;
                        c.cost += r.cost || 0;
                        c.conversions += r.conversions || 0;
                        c.conversion_value += r.conversion_value || 0;
                      });
                      const naverCampaignStats = Object.values(aggCampaigns).filter(c => c.cost > 0).sort((a, b) => b.cost - a.cost);
                      const q = naverCampaignSearch.trim().toLowerCase();
                      const availableTypes = Array.from(new Set(naverCampaignStats.map(c => c.campaign_type || ""))).sort();
                      // ... 이하 동일 (typeFilterActive, byType, baseCampaigns, ... 모두 그대로)
```

(IIFE 내부 로컬 변수로 `naverCampaignStats`를 만들면 IIFE 안의 기존 로직은 그대로 동작.)

- [ ] **Step 6: 광고영역별 표 IIFE도 raw rows 기반으로 변경**

광고영역별 광고 성과 카드를 grep으로 찾기 (`광고영역별 광고 성과` 또는 `naverCampaignStats.length > 0 && (() => {` 이전에 있는 별도 IIFE).

원래 코드(예시):
```js
                    {naverCampaignStats.length > 0 && (() => {
                      const byTypeMap = {};
                      naverCampaignStats.forEach(c => {
                        const key = c.campaign_type || "_etc";
                        ...
```

변경: `naverCampaignStats` 대신 raw rows를 합산해서 광고영역별 만들기:

```js
                    {naverCampaignRawRows.length > 0 && (() => {
                      const byTypeMap = {};
                      naverCampaignRawRows.forEach(r => {
                        const key = r.campaign_type || "_etc";
                        if (!byTypeMap[key]) byTypeMap[key] = {
                          type_code: r.campaign_type || null,
                          impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0
                        };
                        const t = byTypeMap[key];
                        t.impressions += r.impressions || 0;
                        t.clicks += r.clicks || 0;
                        t.cost += r.cost || 0;
                        t.conversions += r.conversions || 0;
                        t.conversion_value += r.conversion_value || 0;
                      });
                      // ... 이하 기존 IIFE 로직 (display, sort 등) 그대로
```

(IIFE 내부에서 naverCampaignStats를 직접 보던 부분만 raw rows 기반 합산으로 교체. IIFE 외관과 출력은 동일.)

- [ ] **Step 7: 키워드별 표 IIFE — 키워드별 합산 (일별 row를 키워드별로 sum)**

`{naverKeywordStats.length === 0 ? null : (() => {` IIFE를 찾고, 시작 부분에 키워드별 합산 추가:

기존:
```js
                    {naverKeywordStats.length === 0 ? null : (() => {
                      const q = naverKeywordSearch.trim().toLowerCase();
                      const availableCampaigns = Array.from(new Set(naverKeywordStats.map(k => k.campaign_id || ""))).sort();
                      const campaignFilterActive = naverKeywordCampaignFilter !== null && naverKeywordCampaignFilter.size !== availableCampaigns.length;
                      const byCampaign = campaignFilterActive
                        ? naverKeywordStats.filter(k => naverKeywordCampaignFilter.has(k.campaign_id || ""))
                        : naverKeywordStats;
                      const baseKeywords = q ? byCampaign.filter(k => (k.keyword_name||"").toLowerCase().includes(q)) : byCampaign;
                      ...
```

변경: 시작부에 일별 row를 키워드별로 합산해서 `aggKeywords` 만들고, 이후 로직에서 `naverKeywordStats` 대신 `aggKeywords` 사용:

```js
                    {naverKeywordStats.length === 0 ? null : (() => {
                      // 일별 row를 키워드별로 합산 (렌더 시점)
                      const aggMap = {};
                      naverKeywordStats.forEach(k => {
                        if (!aggMap[k.keyword_id]) aggMap[k.keyword_id] = {
                          keyword_id: k.keyword_id,
                          keyword_name: k.keyword_name,
                          ad_group_id: k.ad_group_id,
                          ad_group_name: k.ad_group_name,
                          campaign_id: k.campaign_id,
                          campaign_name: k.campaign_name,
                          campaign_type: k.campaign_type,
                          impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0
                        };
                        const a = aggMap[k.keyword_id];
                        a.impressions += k.impressions || 0;
                        a.clicks += k.clicks || 0;
                        a.cost += k.cost || 0;
                        a.conversions += k.conversions || 0;
                        a.conversion_value += k.conversion_value || 0;
                      });
                      const aggKeywords = Object.values(aggMap);
                      const q = naverKeywordSearch.trim().toLowerCase();
                      const availableCampaigns = Array.from(new Set(aggKeywords.map(k => k.campaign_id || ""))).sort();
                      const campaignFilterActive = naverKeywordCampaignFilter !== null && naverKeywordCampaignFilter.size !== availableCampaigns.length;
                      const byCampaign = campaignFilterActive
                        ? aggKeywords.filter(k => naverKeywordCampaignFilter.has(k.campaign_id || ""))
                        : aggKeywords;
                      const baseKeywords = q ? byCampaign.filter(k => (k.keyword_name||"").toLowerCase().includes(q)) : byCampaign;
                      // ... 이하 기존 정렬·렌더 동일
```

`naverKeywordStats[0].period_start` / `period_end`로 만들던 `periodLabel`은 잠시 비워두기:

```js
                      const periodLabel = "";  // Phase 2a 단계에서 dateFilter UI가 추가되면 거기서 표시
```

- [ ] **Step 8: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대: 빌드 성공, 새 ESLint warning 없음.

- [ ] **Step 9: 수동 회귀 테스트 (사용자에게 공유)**

이 task 완료 시점에 사용자가:
1. Task 1 SQL 실행 (이미 진행했어야 함)
2. 광고 탭 진입 → 동기화 → "✅ 일별 7건 + 캠페인 67개 + 키워드 N개 동기화 완료"
3. 캠페인별 표 / 광고영역별 표 / 키워드별 표 모두 외관 변화 없이 정상 표시
4. 검색·필터·정렬 모두 정상 동작

위가 OK면 커밋. 문제 있으면 implementer가 fix 후 다시 검증.

- [ ] **Step 10: 커밋**

```bash
git add src/App.js
git commit -m "refactor(naver-ad): 캠페인 raw rows + 키워드 일별 row, 렌더 시점 합산"
```

---

### Task 4: Frontend — 날짜 셀렉터 + 표별 dateFilter 적용

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: 새 state 추가**

`naverAdStats` 같은 광고 관련 state들과 함께 추가:

```js
  const [naverAdDateFilter, setNaverAdDateFilter] = useState(""); // "" = 전체 기간, "YYYY-MM-DD" = 특정 날짜
```

- [ ] **Step 2: 날짜 포맷 헬퍼 (필요 시) — 한국 요일 표시**

`src/App.js` 상단(헬퍼 모음 영역, fmt 함수 근처)에 추가:

```js
const KOREAN_DAY = ["일","월","화","수","목","금","토"];
function formatDateKr(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00Z`);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const wk = KOREAN_DAY[d.getUTCDay()];
  return `${m}월 ${day}일 (${wk})`;
}
```

- [ ] **Step 3: 광고 탭 헤더에 날짜 셀렉터 추가**

`📣 네이버 검색광고 — {currentBrand.name}` 헤더 + 🔍 동기화 버튼이 있는 영역(grep으로 찾기)을 다음 구조로 변경:

```jsx
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, gap:10, flexWrap:"wrap" }}>
                  <div style={{ fontSize:18, fontWeight:800, color:"#1E293B" }}>📣 네이버 검색광고 — {currentBrand.name}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    {naverAdStats.length > 0 && (
                      <select
                        value={naverAdDateFilter}
                        onChange={e=>setNaverAdDateFilter(e.target.value)}
                        style={{ padding:"7px 12px", borderRadius:8, border:"1px solid #E2E8F0", fontSize:13, background:"white", cursor:"pointer", color:"#1E293B" }}
                      >
                        <option value="">📅 전체 기간</option>
                        {[...naverAdStats].sort((a,b)=>a.date.localeCompare(b.date)).map(s => (
                          <option key={s.date} value={s.date}>{formatDateKr(s.date)}</option>
                        ))}
                      </select>
                    )}
                    <button onClick={()=>{ setShowNaverAdModal(true); setNaverAdSyncResult(""); }} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #BFDBFE", background:"#EFF6FF", color:"#3B82F6", cursor:"pointer", fontSize:13, fontWeight:700 }}>🔍 동기화</button>
                  </div>
                </div>
```

- [ ] **Step 4: KPI 카드 4개 — 날짜 필터 적용**

KPI 카드 IIFE를 grep으로 찾기 (광고비/노출/클릭/CTR 4개 카드 렌더링하는 부분):

```js
                    <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)", gap:12, marginBottom:14 }}>
                      {[
                        {label:"광고비", val:fmt(totalCost), icon:"💰", color:"#EF4444"},
                        ...
```

KPI 합산 이전에 dateFilter 적용된 stats 변수를 만들고 그것 기반으로 합산:

기존(앞쪽에 있을 것):
```js
            const totalCost = naverAdStats.reduce((s,r)=>s+(r.cost||0), 0);
            const totalImpr = naverAdStats.reduce((s,r)=>s+(r.impressions||0), 0);
            const totalClk = naverAdStats.reduce((s,r)=>s+(r.clicks||0), 0);
            const ctr = totalImpr>0 ? (totalClk/totalImpr*100).toFixed(2) : "0";
```

변경:
```js
            const filteredAdStats = naverAdDateFilter
              ? naverAdStats.filter(r => r.date === naverAdDateFilter)
              : naverAdStats;
            const totalCost = filteredAdStats.reduce((s,r)=>s+(r.cost||0), 0);
            const totalImpr = filteredAdStats.reduce((s,r)=>s+(r.impressions||0), 0);
            const totalClk = filteredAdStats.reduce((s,r)=>s+(r.clicks||0), 0);
            const ctr = totalImpr>0 ? (totalClk/totalImpr*100).toFixed(2) : "0";
```

- [ ] **Step 5: 일별 광고 성과 표 — 단일 날짜 모드에서 숨김**

일별 광고 성과 표 카드를 grep으로 찾고, `<div style={card}>` 또는 비슷한 카드 시작점을 conditional하게:

```jsx
                    {naverAdDateFilter === "" && (
                      <div style={card}>
                        <h2 style={{...cardTitle, marginBottom:14}}>📅 일별 광고 성과</h2>
                        ...일별 표 본문...
                      </div>
                    )}
```

(일별 표 카드 전체를 `naverAdDateFilter === ""` 조건으로 wrap)

- [ ] **Step 6: 광고영역별 표 — 날짜 필터 적용**

Task 3 Step 6에서 변경한 광고영역별 IIFE 안의 `naverCampaignRawRows`를 dateFilter 적용된 rows로 변경:

```js
                    {naverCampaignRawRows.length > 0 && (() => {
                      const filteredRawRows = naverAdDateFilter
                        ? naverCampaignRawRows.filter(r => r.date === naverAdDateFilter)
                        : naverCampaignRawRows;
                      const byTypeMap = {};
                      filteredRawRows.forEach(r => {
                        ...
```

- [ ] **Step 7: 캠페인별 표 — 날짜 필터 적용**

Task 3 Step 5에서 변경한 캠페인별 IIFE도 동일 패턴:

```js
                    {naverCampaignRawRows.length > 0 && (() => {
                      const filteredRawRows = naverAdDateFilter
                        ? naverCampaignRawRows.filter(r => r.date === naverAdDateFilter)
                        : naverCampaignRawRows;
                      const aggCampaigns = {};
                      filteredRawRows.forEach(r => {
                        ...
```

- [ ] **Step 8: 키워드별 표 — 날짜 필터 적용**

Task 3 Step 7에서 변경한 키워드 IIFE도 동일 패턴:

```js
                    {naverKeywordStats.length === 0 ? null : (() => {
                      const filteredKwRows = naverAdDateFilter
                        ? naverKeywordStats.filter(k => k.date === naverAdDateFilter)
                        : naverKeywordStats;
                      const aggMap = {};
                      filteredKwRows.forEach(k => {
                        ...
```

키워드 IIFE의 `naverKeywordStats.length === 0 ? null` 가드도 dateFilter 적용 후 빈 경우 동일 처리:

```js
                    {naverKeywordStats.length === 0 ? null : (() => {
                      const filteredKwRows = naverAdDateFilter
                        ? naverKeywordStats.filter(k => k.date === naverAdDateFilter)
                        : naverKeywordStats;
                      if (filteredKwRows.length === 0) return null;  // 그 날짜에 키워드 없음
                      ...
```

또한 카드 헤더의 `periodLabel`을 dateFilter에 맞게 표시:

```js
                      const periodLabel = naverAdDateFilter ? formatDateKr(naverAdDateFilter) : "전체 기간";
```

- [ ] **Step 9: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대: 빌드 성공.

- [ ] **Step 10: 커밋 + 푸시**

```bash
git add src/App.js
git commit -m "feat(naver-ad): 일자별 조회 — 날짜 셀렉터로 KPI/광고영역/캠페인/키워드 필터"
git push
```

---

### Task 5: 배포 후 end-to-end 검증

**Files:** (없음 — 사용자 수동 테스트)

- [ ] **Step 1: Vercel 배포 완료 대기** (1~3분)

- [ ] **Step 2: 동기화 — 7일 기간**

광고 탭 → 🔍 동기화 → "키워드까지 동기화" 체크 → 당월(또는 7일치) 동기화. 35~50초 예상. 결과 메시지에 캠페인 + 키워드 모두 표시되는지 확인.

- [ ] **Step 3: 전체 기간 모드 — 회귀 없음 확인**

날짜 셀렉터에서 "📅 전체 기간" 유지(default). 모든 표(KPI/일별/광고영역/캠페인/키워드)가 Phase 1과 동일하게 표시.

- [ ] **Step 4: 특정 날짜 모드 — 5/1 같은 하루 선택**

날짜 셀렉터에서 "5월 1일 (월)" 선택. 확인:
- KPI 카드 4개: 그 날 합산으로 변경
- 일별 표 카드: 자동으로 사라짐
- 광고영역별 표: 그 날 데이터로
- 캠페인별 표: 그 날 캠페인별 합산 (1행/캠페인, 광고비 0인 캠페인 자동 제외)
- 키워드별 표: 그 날 키워드 row 표시. 헤더 옆 기간 표시가 "5월 1일 (월)"로

- [ ] **Step 5: 다른 날짜로 변경**

5/2, 5/3, ... 5/7 각각 선택해보면서 모든 표가 정상 갱신되는지 확인.

- [ ] **Step 6: 검색·필터·정렬 동작 확인 (단일 날짜 모드)**

특정 날짜 선택한 상태에서:
- 키워드 검색 input → 필터 정상
- 캠페인 ▼ 필터 → 정상
- 광고영역 ▼ 필터 (캠페인별 표) → 정상
- 컬럼 정렬 클릭 → 정상

- [ ] **Step 7: 다른 브랜드/mall 이동 시 셀렉터 갱신**

사이드바에서 다른 브랜드 클릭 → 광고 탭 → 셀렉터의 옵션이 그 브랜드의 sync된 일자만 표시되는지 확인.

- [ ] **Step 8: DB 검증**

Supabase Table Editor → `naver_ad_keyword_stats` → 컬럼 `date` 채워짐, `period_start/period_end` 없음. row 수 ≈ 키워드 수 × 동기화 일수.

---

## 완료 시 사용자에게 제안

모든 task 완료 후, 사용자에게:

> Phase 2a 완료. 한 번 동기화로 전체 기간 + 특정 날짜 양쪽 뷰 사용 가능. 다음 후보:
> - **Phase 2b**: 트렌드 라인 차트 — 키워드 row 클릭 시 일별 변화 시각화
> - **두 날짜 비교**: 5/1 vs 5/7 좌우 비교 컬럼
> - **다른 광고 채널 통합**: Meta/구글/유튜브 광고비 통합 ROAS
>
> 어느 방향으로 가시겠어요?
