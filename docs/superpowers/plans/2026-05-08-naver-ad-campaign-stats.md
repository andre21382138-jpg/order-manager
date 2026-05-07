# 네이버 광고 캠페인별 성과 (2단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일별 표 아래에 캠페인별 광고 성과 표를 추가하고 일별 표의 부정확한 ROAS 컬럼을 제거.

**Architecture:** `api/naver-ad.js` 응답에 `campaigns[]` 배열 추가 — 일자×캠페인 row, 캠페인 이름 포함. 프론트엔드는 응답의 stats + campaigns 모두 `naver_ad_stats` 테이블에 upsert(스키마 변경 없음, `campaign_id` 컬럼 활용). 캠페인별 표는 별도 useEffect에서 `campaign_id != ''` row만 fetch 후 캠페인 단위 기간 합산.

**Tech Stack:** Node.js (Vercel function), React 19 (CRA), Supabase, Naver Search Ad API.

**Spec:** `docs/superpowers/specs/2026-05-08-naver-ad-campaign-stats-design.md`

**전제조건 (이미 완료)**:
- 1단계 완료 (`api/naver-ad.js` 존재, `naver_ad_stats` 테이블 + RLS 정책 활성)
- `campaign_id` 컬럼이 NOT NULL DEFAULT `''`로 마이그레이션되어 있음

---

## 변경 대상 파일

- `api/naver-ad.js`
- `src/App.js`

## 진행 전 확인

- [ ] **Step 0-1: working tree clean**

```powershell
git status
```

- [ ] **Step 0-2: feature branch 생성**

```powershell
git checkout -b feature/naver-ad-campaign-stats
```

---

### Task 1: `api/naver-ad.js` — campaigns[] 응답 추가

**Files:**
- Modify: `api/naver-ad.js:62-109` (action=stats 처리 영역)

- [ ] **Step 1: 캠페인 ID + 이름 매핑 + campaigns[] 가공 추가**

`api/naver-ad.js`의 action=stats 영역(L59-113)을 통째로 다음으로 교체:

```javascript
  if (action === "stats") {
    if (!from || !to) return res.status(400).json({ error: "from, to 필요" });
    try {
      // 1. 캠페인 목록 fetch (id + name)
      const campResp = await naverAdGet("/ncc/campaigns", creds);
      if (!campResp.ok) {
        return res.status(campResp.status).json({ error: "campaigns fetch 실패", raw: campResp.data });
      }
      const campaignList = Array.isArray(campResp.data) ? campResp.data : [];
      const ids = campaignList.map(c => c.nccCampaignId).filter(Boolean);
      const idToName = {};
      campaignList.forEach(c => { if (c.nccCampaignId) idToName[c.nccCampaignId] = c.name || c.nccCampaignId; });
      if (ids.length === 0) {
        return res.status(200).json({ stats: [], campaigns: [], _debug: { reason: "no_campaigns", campaignsRaw: campResp.data } });
      }

      // 2. 일별 stats fetch — Naver /stats는 캠페인 합산만 반환하므로 날짜별로 한 번씩 호출
      const fields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const idsParam = ids.join(",");

      const dates = [];
      let cursor = new Date(`${from}T00:00:00Z`);
      const endD = new Date(`${to}T00:00:00Z`);
      while (cursor <= endD) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor = new Date(cursor.getTime() + 86400000);
      }

      const byDate = {};
      const campaignRows = [];  // 캠페인별 일자 row (광고비 0 제외)
      for (const day of dates) {
        const timeRange = JSON.stringify({ since: day, until: day });
        const statsUri = `/stats?ids=${encodeURIComponent(idsParam)}&fields=${encodeURIComponent(fields)}&timeRange=${encodeURIComponent(timeRange)}&datePreset=custom`;
        const r = await naverAdGet(statsUri, creds);
        if (!r.ok) {
          return res.status(r.status).json({ error: `stats fetch 실패 (${day})`, raw: r.data });
        }
        const dayItems = r.data?.data || [];
        let imp = 0, clk = 0, cost = 0, conv = 0, cv = 0;
        dayItems.forEach(it => {
          const itImp = Number(it.impCnt || 0);
          const itClk = Number(it.clkCnt || 0);
          const itCost = Number(it.salesAmt || 0);
          const itConv = Number(it.ccnt || 0);
          const itCv = Number(it.convAmt || 0);
          imp += itImp; clk += itClk; cost += itCost; conv += itConv; cv += itCv;
          // 캠페인별 row: 광고비 0 제외 (저장 노이즈 감소)
          if (itCost > 0 && it.id) {
            campaignRows.push({
              date: day,
              campaign_id: it.id,
              campaign_name: idToName[it.id] || it.id,
              impressions: itImp,
              clicks: itClk,
              cost: itCost,
              conversions: itConv,
              conversion_value: itCv,
            });
          }
        });
        byDate[day] = { date: day, impressions: imp, clicks: clk, cost: cost, conversions: conv, conversion_value: cv };
      }
      const result = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

      return res.status(200).json({
        stats: result,
        campaigns: campaignRows,
        _debug: { campaignCount: ids.length, dayCount: dates.length, campaignRowCount: campaignRows.length }
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
```

핵심 변경:
- `idToName` 맵 추가 (campaign id → name)
- 일자별 loop 안에서 `dayItems.forEach`가 합산뿐 아니라 캠페인별 row도 `campaignRows`에 push (광고비 > 0인 것만)
- 응답에 `campaigns[]` 추가

- [ ] **Step 2: Node 구문 점검**

```powershell
node -c api/naver-ad.js
```

Expected: 무에러.

- [ ] **Step 3: 응답 구조 검증**

```powershell
node -e "const code=require('fs').readFileSync('api/naver-ad.js','utf8');console.log('idToName 맵:', code.includes('idToName[c.nccCampaignId]'));console.log('campaignRows 배열:', code.includes('const campaignRows = []'));console.log('응답에 campaigns:', code.includes('campaigns: campaignRows'));console.log('광고비 0 필터:', code.includes('if (itCost > 0 && it.id)'));"
```

Expected: 모두 `true`.

- [ ] **Step 4: 커밋**

```powershell
git add api/naver-ad.js
git commit -m @'
feat(api/naver-ad): campaigns[] 응답 추가 (2단계 캠페인별 성과)

- /ncc/campaigns에서 name 추출 (id→name 맵)
- 일자별 stats 호출 시 캠페인별 row를 campaignRows[]로 수집 (광고비 0 제외)
- 응답: { stats, campaigns, _debug } — 1단계와 호환 유지

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

(closing `'@` MUST be at column 0)

---

### Task 2: Frontend state + 캠페인별 fetch useEffect

**Files:**
- Modify: `src/App.js:359-365` (state 영역)
- Modify: `src/App.js:558-572` (useEffect 영역)

- [ ] **Step 1: state 추가**

`src/App.js:362` 부근의 `naverAdSyncResult` state 다음에 추가:

기존:
```javascript
  const [naverAdSyncResult, setNaverAdSyncResult] = useState("");
```

이 줄 직후에 추가:
```javascript
  const [naverCampaignStats, setNaverCampaignStats] = useState([]);
```

- [ ] **Step 2: 캠페인별 fetch useEffect 추가**

`src/App.js:572` (`}, [currentBrand, currentMallType, mainTab, filter.from, filter.to]);`)의 useEffect 닫힘 직후에 다음 useEffect 추가:

```javascript
  useEffect(() => {
    if (mainTab !== "광고") return;
    if (!currentBrand) return;
    if (currentMallType !== "자사몰") return;
    if (!NAVERAD_CONFIGURED_BRANDS.includes(currentBrand.id)) return;
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
            campaign_id: r.campaign_id,
            campaign_name: r.campaign_name || r.campaign_id,
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
  }, [currentBrand, currentMallType, mainTab, filter.from, filter.to]);
```

- [ ] **Step 3: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('naverCampaignStats state:', code.includes('const [naverCampaignStats, setNaverCampaignStats]'));console.log('campaign fetch useEffect:', code.includes('.neq(\"campaign_id\", \"\")'));console.log('byCampaign 합산:', code.includes('byCampaign[r.campaign_id]'));console.log('cost > 0 필터:', code.includes('.filter(c => c.cost > 0)'));console.log('광고비 desc 정렬:', code.includes('.sort((a, b) => b.cost - a.cost)'));"
```

Expected: 모두 `true`.

- [ ] **Step 4: 커밋**

```powershell
git add src/App.js
git commit -m @'
feat(app): Task 2 — 캠페인별 광고 성과 state + fetch

- naverCampaignStats state 추가
- 광고 탭 진입 시 campaign_id != '' row를 추가 fetch
- 캠페인 단위로 기간 합산, 광고비 0 제외, 광고비 내림차순 정렬

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 3: syncNaverAdStats — campaigns[] 도 upsert

**Files:**
- Modify: `src/App.js:996-1051` (syncNaverAdStats 함수)

- [ ] **Step 1: rows 생성 + upsert + 결과 메시지 갱신**

`src/App.js`의 syncNaverAdStats 본문에서 다음 부분을 찾기:

```javascript
      const stats = data.stats || [];
      if (stats.length === 0) {
        setNaverAdSyncResult(`⚠️ 수집된 광고 데이터 없음 (캠페인 또는 통계 비어있음)`);
        setNaverAdSyncing(false);
        return;
      }
      setNaverAdSyncResult(`⏳ DB 저장 중... (${stats.length}일)`);
      const rows = stats.map(s => ({
        brand_id: brand.id,
        mall_type: "자사몰",
        date: s.date,
        campaign_id: "",
        campaign_name: null,
        impressions: s.impressions || 0,
        clicks: s.clicks || 0,
        cost: s.cost || 0,
        conversions: s.conversions || 0,
        conversion_value: s.conversion_value || 0,
      }));
      const { error: upErr } = await supabase.from("naver_ad_stats").upsert(rows, { onConflict: "brand_id,date,campaign_id" });
```

다음으로 교체:

```javascript
      const stats = data.stats || [];
      const campaigns = data.campaigns || [];
      if (stats.length === 0) {
        setNaverAdSyncResult(`⚠️ 수집된 광고 데이터 없음 (캠페인 또는 통계 비어있음)`);
        setNaverAdSyncing(false);
        return;
      }
      setNaverAdSyncResult(`⏳ DB 저장 중... (일별 ${stats.length}건 + 캠페인별 ${campaigns.length}건)`);
      const dailyRows = stats.map(s => ({
        brand_id: brand.id,
        mall_type: "자사몰",
        date: s.date,
        campaign_id: "",
        campaign_name: null,
        impressions: s.impressions || 0,
        clicks: s.clicks || 0,
        cost: s.cost || 0,
        conversions: s.conversions || 0,
        conversion_value: s.conversion_value || 0,
      }));
      const campaignRowsForDb = campaigns.map(c => ({
        brand_id: brand.id,
        mall_type: "자사몰",
        date: c.date,
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name || null,
        impressions: c.impressions || 0,
        clicks: c.clicks || 0,
        cost: c.cost || 0,
        conversions: c.conversions || 0,
        conversion_value: c.conversion_value || 0,
      }));
      const allRows = [...dailyRows, ...campaignRowsForDb];
      const { error: upErr } = await supabase.from("naver_ad_stats").upsert(allRows, { onConflict: "brand_id,date,campaign_id" });
```

- [ ] **Step 2: refetch + 결과 메시지에 campaign 갱신 추가**

같은 함수에서 다음 부분을 찾기:

```javascript
      const { data: refreshed } = await supabase.from("naver_ad_stats")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("mall_type", "자사몰")
        .eq("campaign_id", "")
        .gte("date", newFrom)
        .lte("date", newTo)
        .order("date");
      setNaverAdStats(refreshed || []);
      setNaverAdSyncResult(`✅ ${stats.length}일치 동기화 완료`);
```

다음으로 교체:

```javascript
      const { data: refreshed } = await supabase.from("naver_ad_stats")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("mall_type", "자사몰")
        .eq("campaign_id", "")
        .gte("date", newFrom)
        .lte("date", newTo)
        .order("date");
      setNaverAdStats(refreshed || []);
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

- [ ] **Step 3: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('campaigns 변수:', code.includes('const campaigns = data.campaigns || []'));console.log('campaignRowsForDb:', code.includes('const campaignRowsForDb'));console.log('allRows upsert:', code.includes('const allRows = [...dailyRows, ...campaignRowsForDb]'));console.log('refreshedCamp fetch:', code.includes('const { data: refreshedCamp }'));console.log('setNaverCampaignStats refresh:', (code.match(/setNaverCampaignStats\(/g)||[]).length >= 2);console.log('새 결과 메시지:', code.includes('일별 ${stats.length}건 + 캠페인'));"
```

Expected: 모두 `true`.

- [ ] **Step 4: 빌드 점검**

```powershell
npm run build
```

Expected: `Compiled with warnings.` 신규 에러 없어야 함.

- [ ] **Step 5: 커밋**

```powershell
git add src/App.js
git commit -m @'
feat(app): Task 3 — syncNaverAdStats가 campaigns[] 함께 upsert

- data.stats + data.campaigns 모두 naver_ad_stats에 upsert
- sync 후 일별 row + 캠페인별 row 모두 refetch + state 갱신
- 결과 메시지 포맷 변경: "일별 N건 + 캠페인 M개 동기화 완료"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 4: UI — 일별 표 ROAS 컬럼 제거 + 캠페인별 표 신규

**Files:**
- Modify: `src/App.js:1576` (일별 표 헤더)
- Modify: `src/App.js:1582-1597` (일별 표 row)
- Modify: `src/App.js:1601` 부근 (일별 표 카드 닫기 직후 — 캠페인별 카드 추가 위치)

- [ ] **Step 1: 일별 표 헤더에서 ROAS 컬럼 제거**

`src/App.js:1576` 부근 다음 줄 찾기:

```javascript
                              {["날짜","광고비","노출","클릭","CTR","자사몰매출","ROAS"].map(h=>(
```

다음으로 교체:

```javascript
                              {["날짜","광고비","노출","클릭","CTR","자사몰매출"].map(h=>(
```

- [ ] **Step 2: 일별 표 row에서 ROAS 셀 제거**

`src/App.js:1584-1595` 부근에서 다음 부분 찾기:

```javascript
                              const sales = salesByDate[r.date] || 0;
                              const dayCtr = r.impressions>0?(r.clicks/r.impressions*100).toFixed(2):"0";
                              const dayRoas = r.cost>0?(sales/r.cost*100).toFixed(0):"0";
                              return (
                                <tr key={r.date} style={{ borderBottom:"1px solid #F1F5F9" }}>
                                  <td style={{ padding:"8px", fontWeight:600, color:"#1E293B" }}>{r.date}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#EF4444", fontWeight:600 }}>{fmt(r.cost)}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#3B82F6" }}>{(r.impressions||0).toLocaleString()}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#10B981" }}>{(r.clicks||0).toLocaleString()}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#8B5CF6" }}>{dayCtr}%</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#1E293B" }}>{fmt(sales)}</td>
                                  <td style={{ padding:"8px", textAlign:"right", fontWeight:700, color:"#3B82F6" }}>{dayRoas}%</td>
                                </tr>
                              );
```

다음으로 교체 (dayRoas 변수 + 마지막 td 제거):

```javascript
                              const sales = salesByDate[r.date] || 0;
                              const dayCtr = r.impressions>0?(r.clicks/r.impressions*100).toFixed(2):"0";
                              return (
                                <tr key={r.date} style={{ borderBottom:"1px solid #F1F5F9" }}>
                                  <td style={{ padding:"8px", fontWeight:600, color:"#1E293B" }}>{r.date}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#EF4444", fontWeight:600 }}>{fmt(r.cost)}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#3B82F6" }}>{(r.impressions||0).toLocaleString()}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#10B981" }}>{(r.clicks||0).toLocaleString()}</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#8B5CF6" }}>{dayCtr}%</td>
                                  <td style={{ padding:"8px", textAlign:"right", color:"#1E293B" }}>{fmt(sales)}</td>
                                </tr>
                              );
```

- [ ] **Step 3: 캠페인별 표 카드 추가**

`src/App.js:1601` 부근에서 일별 표 카드의 닫는 `</div>` 두 개 다음 찾기:

```javascript
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </>
            );
```

`</div>` (table 감싼 scrollable div) → `</div>` (card div) → `</>` 패턴이 보임. card div 닫힘 직후, `</>` 직전에 캠페인별 카드 삽입:

찾기:
```javascript
                        </table>
                      </div>
                    </div>
                  </>
                )}
```

다음으로 교체:

```javascript
                        </table>
                      </div>
                    </div>
                    {naverCampaignStats.length > 0 && (
                      <div style={{...card, marginTop:14}}>
                        <h2 style={{...cardTitle, marginBottom:14}}>📣 캠페인별 광고 성과</h2>
                        <div style={{ overflowY:"auto", maxHeight:520 }}>
                          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                            <thead>
                              <tr style={{ borderBottom:"2px solid #E2E8F0" }}>
                                {["캠페인명","광고비","노출","클릭","CTR","전환수","전환매출","ROAS"].map(h=>(
                                  <th key={h} style={{ padding:"8px", textAlign:h==="캠페인명"?"left":"right", fontWeight:700, color:"#64748B" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {naverCampaignStats.map(c=>{
                                const ctr = c.impressions>0 ? (c.clicks/c.impressions*100).toFixed(2) : "0";
                                const roas = c.cost>0 ? (c.conversion_value/c.cost*100).toFixed(0) : "0";
                                return (
                                  <tr key={c.campaign_id} style={{ borderBottom:"1px solid #F1F5F9" }}>
                                    <td style={{ padding:"8px", fontWeight:600, color:"#1E293B", maxWidth:280, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={c.campaign_name}>{c.campaign_name}</td>
                                    <td style={{ padding:"8px", textAlign:"right", color:"#EF4444", fontWeight:600 }}>{fmt(c.cost)}</td>
                                    <td style={{ padding:"8px", textAlign:"right", color:"#3B82F6" }}>{(c.impressions||0).toLocaleString()}</td>
                                    <td style={{ padding:"8px", textAlign:"right", color:"#10B981" }}>{(c.clicks||0).toLocaleString()}</td>
                                    <td style={{ padding:"8px", textAlign:"right", color:"#8B5CF6" }}>{ctr}%</td>
                                    <td style={{ padding:"8px", textAlign:"right", color:"#475569" }}>{(c.conversions||0).toLocaleString()}건</td>
                                    <td style={{ padding:"8px", textAlign:"right", color:"#10B981", fontWeight:600 }}>{fmt(c.conversion_value)}</td>
                                    <td style={{ padding:"8px", textAlign:"right", fontWeight:700, color:"#10B981" }}>{roas}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
```

핵심:
- `naverCampaignStats.length > 0` 일 때만 카드 노출 (빈 상태 카드 자체 숨김)
- 헤더 8개: 캠페인명, 광고비, 노출, 클릭, CTR, 전환수, 전환매출, ROAS
- ROAS = `conversion_value/cost*100` (광고 직접 ROAS)
- 캠페인명은 길어질 수 있어 `maxWidth + ellipsis + title` 처리

- [ ] **Step 4: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('일별 ROAS 컬럼 제거:', !code.includes('\"날짜\",\"광고비\",\"노출\",\"클릭\",\"CTR\",\"자사몰매출\",\"ROAS\"'));console.log('일별 6개 컬럼:', code.includes('[\"날짜\",\"광고비\",\"노출\",\"클릭\",\"CTR\",\"자사몰매출\"]'));console.log('일별 dayRoas 변수 제거:', !code.includes('const dayRoas'));console.log('캠페인별 카드 헤더:', code.includes('📣 캠페인별 광고 성과'));console.log('캠페인별 8개 컬럼:', code.includes('[\"캠페인명\",\"광고비\",\"노출\",\"클릭\",\"CTR\",\"전환수\",\"전환매출\",\"ROAS\"]'));console.log('빈 상태 카드 숨김:', code.includes('naverCampaignStats.length > 0 && ('));"
```

Expected: 모두 `true`.

- [ ] **Step 5: 빌드 검증**

```powershell
npm run build
```

Expected: `Compiled with warnings.` 새 에러 없어야 함.

- [ ] **Step 6: 커밋**

```powershell
git add src/App.js
git commit -m @'
feat(app): Task 4 — 일별 표 ROAS 컬럼 제거 + 캠페인별 광고 성과 표 신규

- 일별 표: 7컬럼 → 6컬럼 (날짜/광고비/노출/클릭/CTR/자사몰매출). dayRoas 변수 제거.
- 캠페인별 표 (신규): 8컬럼 (캠페인명/광고비/노출/클릭/CTR/전환수/전환매출/ROAS)
  - 광고비 내림차순 정렬, 광고비 0 캠페인 제외
  - ROAS = 광고 전환매출 ÷ 광고비 (광고 직접 ROAS)
  - naverCampaignStats 비어있으면 카드 자체 숨김

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 5: 빌드 검증 + main 단일 squash

- [ ] **Step 1: Frontend 프로덕션 빌드**

```powershell
npm run build
```

Expected: `Compiled successfully.` 또는 `Compiled with warnings.` (warnings only — pre-existing). 새 에러 없음.

- [ ] **Step 2: Backend 구문 점검**

```powershell
node -c api/naver-ad.js
```

Expected: 무에러.

- [ ] **Step 3: 데스크탑 시나리오 스모크 테스트 (Vercel 배포 후)**

| 시나리오 | 기대 동작 |
|---------|----------|
| 팔레오 → 자사몰 → 광고 탭 | 기존 화면 + 일별 표는 ROAS 컬럼 없음 (6개) |
| 🔍 동기화 → "최근 7일" | "✅ 일별 N건 + 캠페인 M개 동기화 완료" 메시지 |
| 모달 닫기 후 광고 탭 | 일별 표 + 캠페인별 표 (광고비 내림차순) |
| 캠페인별 표에서 ROAS 카드 | 광고 직접 ROAS = 전환매출 ÷ 광고비 표시 |
| 다른 브랜드/mall로 전환 | 캠페인별 표도 적절히 갱신/숨김 |
| 코코엘 → 자사몰 → 광고 | "자격증명 미설정" 안내 (캠페인별 표 없음) |
| 팔레오 → 브랜드스토어 → 광고 | "자사몰 유입에만 적용" 안내 (캠페인별 표 없음) |

- [ ] **Step 4: main에 squash-merge**

```powershell
git checkout main
git merge --squash feature/naver-ad-campaign-stats
git commit -m @'
feat: 네이버 광고 캠페인별 성과 (2단계)

일별 표 아래에 캠페인별 광고 성과 표 추가, 일별 표의 부정확한
ROAS 컬럼 제거. 같은 naver_ad_stats 테이블에 캠페인별 row 함께 저장.

- api/naver-ad.js: 응답에 campaigns[] 추가, /ncc/campaigns에서 name 추출
- src/App.js:
  - naverCampaignStats state + 캠페인별 fetch useEffect
  - syncNaverAdStats: data.campaigns도 함께 upsert + state 갱신
  - 일별 표 ROAS 컬럼 제거
  - 캠페인별 광고 성과 표 신규 (8컬럼, 광고비 내림차순, 활성 캠페인만)

Spec: docs/superpowers/specs/2026-05-08-naver-ad-campaign-stats-design.md
Plan: docs/superpowers/plans/2026-05-08-naver-ad-campaign-stats.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

- [ ] **Step 5: feature branch 삭제**

```powershell
git branch -D feature/naver-ad-campaign-stats
git log --oneline origin/main..HEAD
```

(push는 사용자 승인 후)
