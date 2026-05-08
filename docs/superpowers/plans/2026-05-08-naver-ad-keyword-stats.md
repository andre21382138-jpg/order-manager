# 네이버 광고 키워드별 성과 (Phase 1: A+B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 광고 키워드 단위 기간 합산 성과 표시 — 낭비 키워드 식별(A) + 성공 키워드 푸시(B)

**Architecture:** 신규 `naver_ad_keyword_stats` 테이블 + truncate-and-insert 패턴. Vercel API에서 활성 캠페인 → 활성 광고그룹 → 활성 키워드만 사전 필터해서 호출 수 80% 감소. Bulk `/stats`로 키워드 통계 한 번에 조회. Frontend는 캠페인별 표와 동일한 검색/필터/정렬 UX 패턴 재사용.

**Tech Stack:** React 19, Supabase (Postgres + RLS), Vercel serverless function, Naver Search Ad API (HMAC-SHA256)

**Spec:** `docs/superpowers/specs/2026-05-08-naver-ad-keyword-stats-design.md`

---

### Task 1: Supabase 테이블 + RLS + 인덱스 생성

**Files:**
- Manual SQL execution in Supabase Dashboard (no code file)

- [ ] **Step 1: Supabase Dashboard → SQL Editor에서 다음 SQL 실행**

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

- [ ] **Step 2: 검증**

Supabase Table Editor → `naver_ad_keyword_stats` 테이블 클릭 → 컬럼 17개 + RLS Enabled 표시 확인. UNIQUE 제약과 인덱스도 Database → Indexes 탭에서 확인.

기대 결과: 테이블 생성됨, RLS 켜짐, 인덱스 1개 + 시스템이 만든 PK/UNIQUE 인덱스 표시.

---

### Task 2: API — `action=keywords` 엔드포인트 추가

**Files:**
- Modify: `api/naver-ad.js`

- [ ] **Step 1: 시간 측정 변수 + 병렬 헬퍼 추가**

`api/naver-ad.js` 상단(naverAdGet 바로 아래, module.exports 위)에 헬퍼 추가:

```js
async function parallelLimit(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkRes = await Promise.all(chunk.map(fn));
    results.push(...chunkRes);
  }
  return results;
}
```

- [ ] **Step 2: action=keywords 분기 추가**

`module.exports = async (req, res) => {` 안, `if (action === "stats")` 블록 직후에 다음 블록을 통째로 추가:

```js
  if (action === "keywords") {
    if (!from || !to) return res.status(400).json({ error: "from, to 필요" });
    const t0 = Date.now();
    try {
      // 1. 캠페인 목록 + 메타
      const campResp = await naverAdGet("/ncc/campaigns", creds);
      if (!campResp.ok) {
        return res.status(campResp.status).json({ error: "campaigns fetch 실패", raw: campResp.data });
      }
      const allCampaigns = Array.isArray(campResp.data) ? campResp.data : [];
      const allCampaignIds = allCampaigns.map(c => c.nccCampaignId).filter(Boolean);
      const idToCampaign = {};
      allCampaigns.forEach(c => {
        if (c.nccCampaignId) idToCampaign[c.nccCampaignId] = {
          name: c.name || c.nccCampaignId,
          type: c.campaignTp || null,
        };
      });
      if (allCampaignIds.length === 0) {
        return res.status(200).json({ keywords: [], _debug: { reason: "no_campaigns", elapsedMs: Date.now() - t0 } });
      }

      // 2. 활성 캠페인 식별 — 기간 합산 cost 호출
      const periodFields = JSON.stringify(["salesAmt"]);
      const periodTimeRange = JSON.stringify({ since: from, until: to });
      const campStatsUri = `/stats?ids=${encodeURIComponent(allCampaignIds.join(","))}&fields=${encodeURIComponent(periodFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
      const campStatsResp = await naverAdGet(campStatsUri, creds);
      if (!campStatsResp.ok) {
        return res.status(campStatsResp.status).json({ error: "campaign stats fetch 실패", raw: campStatsResp.data });
      }
      const activeCampaignIds = (campStatsResp.data?.data || [])
        .filter(c => Number(c.salesAmt || 0) > 0)
        .map(c => c.id);
      if (activeCampaignIds.length === 0) {
        return res.status(200).json({ keywords: [], _debug: { reason: "no_active_campaigns", elapsedMs: Date.now() - t0 } });
      }

      // 3. 활성 캠페인의 광고그룹 fetch (병렬 5)
      const adgroupArrays = await parallelLimit(activeCampaignIds, 5, async (id) => {
        const r = await naverAdGet(`/ncc/adgroups?nccCampaignId=${encodeURIComponent(id)}`, creds);
        return r.ok && Array.isArray(r.data) ? r.data : [];
      });
      const allAdgroups = adgroupArrays.flat();
      const allAdgroupIds = allAdgroups.map(g => g.nccAdgroupId).filter(Boolean);
      const idToAdgroup = {};
      allAdgroups.forEach(g => {
        if (g.nccAdgroupId) idToAdgroup[g.nccAdgroupId] = {
          name: g.name || g.nccAdgroupId,
          campaign_id: g.nccCampaignId,
        };
      });

      // 4. 활성 광고그룹 식별 — 광고그룹 합산 cost
      let activeAdgroupIds = [];
      if (allAdgroupIds.length > 0) {
        const groupStatsUri = `/stats?ids=${encodeURIComponent(allAdgroupIds.join(","))}&fields=${encodeURIComponent(periodFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
        const groupStatsResp = await naverAdGet(groupStatsUri, creds);
        if (groupStatsResp.ok) {
          activeAdgroupIds = (groupStatsResp.data?.data || [])
            .filter(g => Number(g.salesAmt || 0) > 0)
            .map(g => g.id);
        }
      }
      if (activeAdgroupIds.length === 0) {
        return res.status(200).json({ keywords: [], _debug: { reason: "no_active_adgroups", campaignsScanned: activeCampaignIds.length, elapsedMs: Date.now() - t0 } });
      }

      // 5. 활성 광고그룹의 키워드 fetch (병렬 5)
      const keywordArrays = await parallelLimit(activeAdgroupIds, 5, async (id) => {
        const r = await naverAdGet(`/ncc/keywords?nccAdgroupId=${encodeURIComponent(id)}`, creds);
        return r.ok && Array.isArray(r.data) ? r.data : [];
      });
      const allKeywords = keywordArrays.flat();
      const idToKeyword = {};
      allKeywords.forEach(k => {
        if (k.nccKeywordId) idToKeyword[k.nccKeywordId] = {
          name: k.keyword || k.nccKeywordId,
          adgroup_id: k.nccAdgroupId,
        };
      });
      const allKeywordIds = Object.keys(idToKeyword);
      if (allKeywordIds.length === 0) {
        return res.status(200).json({ keywords: [], _debug: { reason: "no_keywords", adgroupsScanned: activeAdgroupIds.length, elapsedMs: Date.now() - t0 } });
      }

      // 6. 키워드 stats bulk (100개씩 chunk, 병렬 5)
      const keywordFields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const chunks = [];
      for (let i = 0; i < allKeywordIds.length; i += 100) {
        chunks.push(allKeywordIds.slice(i, i + 100));
      }
      const statsArrays = await parallelLimit(chunks, 5, async (chunk) => {
        const uri = `/stats?ids=${encodeURIComponent(chunk.join(","))}&fields=${encodeURIComponent(keywordFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
        const r = await naverAdGet(uri, creds);
        return r.ok ? (r.data?.data || []) : [];
      });
      const keywordStats = statsArrays.flat();

      // 7. 응답 가공: cost > 0 키워드만, 메타 조인
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

      return res.status(200).json({
        keywords,
        _debug: {
          campaignsScanned: activeCampaignIds.length,
          adgroupsScanned: activeAdgroupIds.length,
          keywordsFetched: allKeywordIds.length,
          keywordsActive: keywords.length,
          elapsedMs: Date.now() - t0,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message, elapsedMs: Date.now() - t0 });
    }
  }
```

- [ ] **Step 3: 로컬 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대 결과: 빌드 성공 (api/naver-ad.js는 React 빌드에 포함 안 되지만 syntax error 없는지 확인용). Vercel 배포는 git push 후 자동.

- [ ] **Step 4: 커밋**

```bash
git add api/naver-ad.js
git commit -m "feat(naver-ad-api): action=keywords — 활성 캠페인/광고그룹 사전 필터 + bulk /stats"
git push
```

기대 결과: Vercel 자동 배포 시작. (실제 작동은 Task 5 배포 후 검증)

---

### Task 3: Frontend — state + sync 함수 + 모달 체크박스

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: 키워드 관련 state 6개 추가**

`src/App.js` 약 372줄 부근, `naverCampaignSort` 선언 바로 아래에 추가:

```js
  // 네이버 광고 — 키워드 (Phase 1)
  const [naverKeywordStats, setNaverKeywordStats] = useState([]);
  const [naverKeywordSearch, setNaverKeywordSearch] = useState("");
  const [naverKeywordCampaignFilter, setNaverKeywordCampaignFilter] = useState(null);
  const [showKeywordCampaignFilter, setShowKeywordCampaignFilter] = useState(false);
  const [naverKeywordSort, setNaverKeywordSort] = useState({ key: "cost", dir: "desc" });
  const [syncKeywordsToo, setSyncKeywordsToo] = useState(false);
```

- [ ] **Step 2: syncNaverAdKeywords 함수 추가**

`syncNaverAdStats` 함수 바로 아래 (1043줄 함수의 끝 다음 줄)에 추가:

```js
  async function syncNaverAdKeywords(brand, startDate, endDate) {
    try {
      const r = await fetch(`/api/naver-ad?action=keywords&brand=${brand.id}&from=${startDate}&to=${endDate}`);
      const data = await r.json();
      if (!r.ok) {
        setNaverAdSyncResult(prev => `${prev}\n❌ 키워드 동기화 실패: ${data.error || r.status}`);
        return;
      }
      // truncate-and-insert (네이버 검색광고는 항상 자사몰 — 캠페인 sync와 동일 패턴)
      const { error: delErr } = await supabase
        .from("naver_ad_keyword_stats")
        .delete()
        .eq("brand_id", brand.id)
        .eq("mall_type", "자사몰");
      if (delErr) {
        setNaverAdSyncResult(prev => `${prev}\n❌ 기존 키워드 삭제 실패: ${delErr.message}`);
        return;
      }
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
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("naver_ad_keyword_stats").insert(rows);
        if (insErr) {
          setNaverAdSyncResult(prev => `${prev}\n❌ 키워드 저장 실패: ${insErr.message}`);
          return;
        }
      }
      setNaverKeywordStats(rows);
      const sec = Math.round((data._debug?.elapsedMs || 0) / 1000);
      setNaverAdSyncResult(prev => `${prev}\n✅ 키워드 ${rows.length}개 저장 완료 (${sec}초)`);
    } catch (e) {
      setNaverAdSyncResult(prev => `${prev}\n❌ 키워드 동기화 예외: ${e.message}`);
    }
  }
```

- [ ] **Step 3: syncNaverAdStats 함수 끝에서 syncNaverAdKeywords 조건부 호출**

`syncNaverAdStats` 함수 안, 캠페인 동기화 성공 메시지(약 1134줄):
```js
      setNaverAdSyncResult(`✅ 일별 ${stats.length}건 + 캠페인 ${Object.keys(byCampaign).length}개 동기화 완료`);
```
**바로 다음 줄**(같은 try 블록 안, catch 직전)에 추가:

```js
      if (syncKeywordsToo) {
        setNaverAdSyncResult(prev => `${prev}\n⏳ 키워드 동기화 중... (15~60초)`);
        await syncNaverAdKeywords(brand, startDate, endDate);
      }
```

위치 검증:
- `} catch(e) {` 라인 직전에 위치해야 함
- `setNaverAdSyncing(false)` 보다 앞에 있어야 함 (sync 진행 중 표시 유지)

- [ ] **Step 4: 동기화 모달 안에 체크박스 추가**

`{showNaverAdModal && currentBrand && (` 블록 내부, 사용자 정의 기간 입력 영역 아래 / 닫기 버튼 위에 다음 추가:

```jsx
            <label style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", marginTop:10, background:"#F8FAFC", borderRadius:8, cursor:"pointer", fontSize:13, color:"#475569" }}>
              <input
                type="checkbox"
                checked={syncKeywordsToo}
                onChange={e=>setSyncKeywordsToo(e.target.checked)}
              />
              <span>🔑 키워드까지 동기화 (시간 +15~60초)</span>
            </label>
```

정확한 위치: 2522줄 부근 `<button onClick={()=>setShowNaverAdModal(false)} style={{...secondaryBtn,...}}>닫기</button>` **직전**.

- [ ] **Step 5: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대 결과: 빌드 성공, 새로운 ESLint warning 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/App.js
git commit -m "feat(naver-ad): 키워드 동기화 함수 + 모달 체크박스 (Phase 1)"
```

---

### Task 4: Frontend — useEffect 로드 + 키워드 표 카드

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: 키워드 데이터 로드 useEffect 추가**

기존 `naverCampaignStats` 로드 useEffect를 grep으로 찾아 그 직후에 추가:

```js
  useEffect(() => {
    if (!currentBrand?.id) { setNaverKeywordStats([]); return; }
    if (mainTab !== "광고") return;
    let alive = true;
    supabase.from("naver_ad_keyword_stats")
      .select("*")
      .eq("brand_id", currentBrand.id)
      .eq("mall_type", "자사몰")
      .then(({ data }) => { if (alive) setNaverKeywordStats(data || []); });
    return () => { alive = false; };
  }, [currentBrand?.id, currentMallType, mainTab]);
```

위치는 캠페인 로드 useEffect 바로 아래. 의존성 배열은 캠페인 useEffect와 동일 패턴.

- [ ] **Step 2: 키워드 표 카드 컴포넌트 — 캠페인별 표 IIFE 직후에 추가**

`src/App.js`의 캠페인별 표 IIFE (`{naverCampaignStats.length > 0 && (() => {`) 닫는 `})()}` 바로 다음에 키워드 표 IIFE 추가. 캠페인 표와 동일 패턴 — 검색/필터/정렬 모두 포함:

```jsx
                    {naverKeywordStats.length === 0 ? null : (() => {
                      const q = naverKeywordSearch.trim().toLowerCase();
                      const availableCampaigns = Array.from(new Set(naverKeywordStats.map(k => k.campaign_id || ""))).sort();
                      const campaignFilterActive = naverKeywordCampaignFilter !== null && naverKeywordCampaignFilter.size !== availableCampaigns.length;
                      const byCampaign = campaignFilterActive
                        ? naverKeywordStats.filter(k => naverKeywordCampaignFilter.has(k.campaign_id || ""))
                        : naverKeywordStats;
                      const baseKeywords = q ? byCampaign.filter(k => (k.keyword_name||"").toLowerCase().includes(q)) : byCampaign;
                      const KW_SORT_KEYS = { "광고비":"cost", "노출":"impressions", "클릭":"clicks", "CTR":"ctr", "CPC":"cpc", "전환수":"conversions", "전환매출":"conversion_value", "ROAS":"roas" };
                      const getKwSortVal = (k, key) => {
                        if (key === "ctr") return k.impressions>0 ? k.clicks/k.impressions : 0;
                        if (key === "cpc") return k.clicks>0 ? k.cost/k.clicks : 0;
                        if (key === "roas") return k.cost>0 ? k.conversion_value/k.cost : 0;
                        return Number(k[key]) || 0;
                      };
                      const filteredKeywords = [...baseKeywords].sort((a,b) => {
                        const va = getKwSortVal(a, naverKeywordSort.key);
                        const vb = getKwSortVal(b, naverKeywordSort.key);
                        return naverKeywordSort.dir === "desc" ? vb - va : va - vb;
                      });
                      const toggleKwSort = (label) => {
                        const key = KW_SORT_KEYS[label];
                        if (!key) return;
                        setNaverKeywordSort(prev => prev.key === key
                          ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
                          : { key, dir: "desc" });
                      };
                      const periodLabel = naverKeywordStats[0] ? `${naverKeywordStats[0].period_start} ~ ${naverKeywordStats[0].period_end}` : "";
                      return (
                        <div style={{...card, marginTop:14}}>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, gap:10, flexWrap:"wrap" }}>
                            <h2 style={{...cardTitle, marginBottom:0}}>🔑 키워드별 광고 성과 {periodLabel && <span style={{ fontSize:12, fontWeight:500, color:"#94A3B8", marginLeft:8 }}>({periodLabel})</span>}</h2>
                            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                              {campaignFilterActive && (
                                <button
                                  type="button"
                                  onClick={()=>setNaverKeywordCampaignFilter(null)}
                                  style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #BFDBFE", background:"#EFF6FF", color:"#3B82F6", fontSize:12, fontWeight:700, cursor:"pointer" }}
                                >✕ 캠페인 필터 해제</button>
                              )}
                              <input
                                type="text"
                                placeholder="🔍 키워드 검색..."
                                value={naverKeywordSearch}
                                onChange={e=>setNaverKeywordSearch(e.target.value)}
                                style={{ padding:"7px 12px", borderRadius:8, border:"1px solid #E2E8F0", fontSize:13, width:240, maxWidth:"100%" }}
                              />
                            </div>
                          </div>
                          <div style={{ overflowY:"auto", maxHeight:520 }}>
                            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                              <thead>
                                <tr style={{ borderBottom:"2px solid #E2E8F0" }}>
                                  <th style={{ padding:"8px", textAlign:"left", fontWeight:700, color:"#64748B" }}>키워드</th>
                                  <th style={{ padding:"8px", textAlign:"left", fontWeight:700, color:"#64748B", position:"relative" }}>
                                    <span>캠페인</span>
                                    <button
                                      type="button"
                                      onClick={()=>setShowKeywordCampaignFilter(v=>!v)}
                                      title="캠페인 필터"
                                      style={{
                                        marginLeft:6, padding:"1px 6px", border:"none", cursor:"pointer",
                                        background: campaignFilterActive ? "#DBEAFE" : "transparent",
                                        color: campaignFilterActive ? "#3B82F6" : "#94A3B8",
                                        fontSize:11, borderRadius:4, fontWeight:700, lineHeight:1.4
                                      }}
                                    >▼</button>
                                    {showKeywordCampaignFilter && (
                                      <>
                                        <div onClick={()=>setShowKeywordCampaignFilter(false)} style={{ position:"fixed", inset:0, zIndex:50 }} />
                                        <div style={{
                                          position:"absolute", top:"100%", left:0, marginTop:4,
                                          background:"white", borderRadius:8, boxShadow:"0 4px 20px rgba(0,0,0,0.15)",
                                          border:"1px solid #E2E8F0", padding:10, minWidth:240, zIndex:51, fontWeight:400
                                        }}>
                                          <div style={{ display:"flex", gap:6, marginBottom:8, paddingBottom:8, borderBottom:"1px solid #F1F5F9" }}>
                                            <button type="button" onClick={()=>setNaverKeywordCampaignFilter(null)} style={{ flex:1, padding:"5px", fontSize:11, border:"1px solid #E2E8F0", borderRadius:6, background:"white", cursor:"pointer", color:"#475569" }}>전체</button>
                                            <button type="button" onClick={()=>setNaverKeywordCampaignFilter(new Set())} style={{ flex:1, padding:"5px", fontSize:11, border:"1px solid #E2E8F0", borderRadius:6, background:"white", cursor:"pointer", color:"#475569" }}>해제</button>
                                          </div>
                                          <div style={{ maxHeight:240, overflowY:"auto" }}>
                                            {availableCampaigns.map(cid => {
                                              const checked = naverKeywordCampaignFilter === null || naverKeywordCampaignFilter.has(cid);
                                              const sample = naverKeywordStats.find(k => (k.campaign_id || "") === cid);
                                              const label = sample ? (sample.campaign_name || cid || "(미분류)") : (cid || "(미분류)");
                                              return (
                                                <label key={cid || "_none"} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 4px", fontSize:13, color:"#1E293B", cursor:"pointer" }}>
                                                  <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={()=>{
                                                      setNaverKeywordCampaignFilter(prev => {
                                                        const base = prev === null ? new Set(availableCampaigns) : new Set(prev);
                                                        if (base.has(cid)) base.delete(cid); else base.add(cid);
                                                        return base;
                                                      });
                                                    }}
                                                  />
                                                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:200 }} title={label}>{label}</span>
                                                </label>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </th>
                                  <th style={{ padding:"8px", textAlign:"left", fontWeight:700, color:"#64748B" }}>광고영역</th>
                                  {["광고비","노출","클릭","CTR","CPC","전환수","전환매출","ROAS"].map(h=>{
                                    const isActive = naverKeywordSort.key === KW_SORT_KEYS[h];
                                    const arrow = isActive ? (naverKeywordSort.dir === "desc" ? " ▼" : " ▲") : "";
                                    return (
                                      <th
                                        key={h}
                                        onClick={()=>toggleKwSort(h)}
                                        title={`${h} 기준 정렬`}
                                        style={{ padding:"8px", textAlign:"right", fontWeight:700, color: isActive?"#3B82F6":"#64748B", cursor:"pointer", userSelect:"none" }}
                                      >{h}{arrow}</th>
                                    );
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {filteredKeywords.length === 0 ? (
                                  <tr>
                                    <td colSpan={11} style={{ padding:"24px", textAlign:"center", color:"#94A3B8", fontSize:13 }}>🔍 조건에 일치하는 키워드 없음</td>
                                  </tr>
                                ) : filteredKeywords.map(k=>{
                                  const ctr = k.impressions>0 ? (k.clicks/k.impressions*100).toFixed(2) : "0";
                                  const cpc = k.clicks>0 ? Math.round(k.cost/k.clicks) : 0;
                                  const roas = k.cost>0 ? (k.conversion_value/k.cost*100).toFixed(0) : "0";
                                  return (
                                    <tr key={k.keyword_id} style={{ borderBottom:"1px solid #F1F5F9" }}>
                                      <td style={{ padding:"8px", fontWeight:600, color:"#1E293B", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={k.keyword_name}>{k.keyword_name}</td>
                                      <td style={{ padding:"8px", color:"#475569", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={k.campaign_name}>{k.campaign_name || "-"}</td>
                                      <td style={{ padding:"8px", color:"#64748B" }}>{k.campaign_type ? (CAMPAIGN_TYPE_LABEL[k.campaign_type] || k.campaign_type) : "-"}</td>
                                      <td style={{ padding:"8px", textAlign:"right", color:"#EF4444", fontWeight:600 }}>{fmt(k.cost)}</td>
                                      <td style={{ padding:"8px", textAlign:"right", color:"#3B82F6" }}>{(k.impressions||0).toLocaleString()}</td>
                                      <td style={{ padding:"8px", textAlign:"right", color:"#10B981" }}>{(k.clicks||0).toLocaleString()}</td>
                                      <td style={{ padding:"8px", textAlign:"right", color:"#8B5CF6" }}>{ctr}%</td>
                                      <td style={{ padding:"8px", textAlign:"right", color:"#F59E0B" }}>{fmt(cpc)}</td>
                                      <td style={{ padding:"8px", textAlign:"right", color:"#475569" }}>{(k.conversions||0).toLocaleString()}건</td>
                                      <td style={{ padding:"8px", textAlign:"right", color:"#10B981", fontWeight:600 }}>{fmt(k.conversion_value)}</td>
                                      <td style={{ padding:"8px", textAlign:"right", fontWeight:700, color:"#10B981" }}>{roas}%</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
```

- [ ] **Step 3: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대 결과: 빌드 성공, 새 ESLint warning 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/App.js
git commit -m "feat(naver-ad): 키워드별 광고 성과 표 — 검색/캠페인 필터/정렬"
git push
```

---

### Task 5: 배포 후 end-to-end 검증

**Files:** (없음 — 수동 테스트)

- [ ] **Step 1: Vercel 배포 완료 대기**

브라우저에서 Vercel Dashboard 또는 git commit 페이지에서 배포 상태 확인. 보통 1~3분.

- [ ] **Step 2: 광고 탭 진입, 동기화 모달에서 체크박스 확인**

브라우저에서 앱 접속 → 팔레오 → 광고 탭 → 🔍 동기화 → 모달에 "🔑 키워드까지 동기화" 체크박스 노출 확인.

- [ ] **Step 3: 체크 안 한 상태로 동기화 (회귀 테스트)**

체크박스 off로 두고 "이번달" 또는 "당월" 같은 기간으로 동기화 → 캠페인까지만 동기화 메시지 노출 (기존과 동일). 키워드 표는 비어있어야 함.

기대 결과: 캠페인별 표 정상 동작, 키워드 표 미노출.

- [ ] **Step 4: 체크하고 동기화 (정상 케이스)**

체크박스 on → 동기화 → "키워드 동기화 중..." 메시지 → 15~60초 후 "키워드 N개 저장 완료 (M초)" 메시지 → 키워드 표 자동 노출 확인.

기대 결과:
- 메시지에 캠페인 + 키워드 두 줄 표시
- 키워드 표가 캠페인별 표 아래 노출
- 광고비 내림차순 정렬, 11개 컬럼

- [ ] **Step 5: UI 기능 확인**

각각 시도:
- 키워드 검색 input에 키워드명 일부 입력 → 필터됨
- 캠페인 헤더 ▼ 클릭 → 체크박스 팝업 노출 → 일부 해제 → 표 갱신 → "필터 해제" 버튼 노출 확인
- 광고비/노출/클릭/CTR/CPC/전환수/전환매출/ROAS 헤더 클릭 → 정렬 변경 (▼/▲ 표시)
- 모든 캠페인 체크 해제 → 빈 상태 메시지 노출 → "필터 해제" 클릭 → 다시 표시
- 다른 브랜드로 이동 (사이드바) → 키워드 표 비워짐 (또는 다른 데이터)
- 다시 팔레오로 돌아옴 → 동기화한 데이터 다시 표시

- [ ] **Step 6: DB 검증**

Supabase Table Editor → naver_ad_keyword_stats → 데이터 확인. cost > 0 keyword만 있어야 함, 같은 keyword_id 중복 없어야 함.

- [ ] **Step 7: 성능 확인**

응답에서 `_debug.elapsedMs`가 60,000 이하인지 확인. 만약 60초 근접하거나 timeout 발생 시 별도 이슈로 기록.

---

## 완료 시 사용자에게 제안

모든 task 완료 후, 사용자에게:

> Phase 1 완료. 기간 합산 키워드 성과로 낭비/성공 키워드 식별 가능. 다음으로 **Phase 2 (트렌드 추적, C 케이스)** — 일별 키워드 row 저장으로 같은 키워드의 시간 변화 추적 가능. 진행하시겠어요?
