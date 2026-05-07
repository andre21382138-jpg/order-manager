# 네이버 검색광고 연동 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팔레오 자사몰의 네이버 검색광고 일별 통계를 Vercel 함수로 fetch + Supabase 저장 + 광고 탭에 ROAS 포함 일별 표 표시.

**Architecture:** Vercel serverless function (`api/naver-ad.js`)이 HMAC-SHA256 시그니처로 Naver Search Ad API 호출 → 일별 합산 → 응답. 프론트엔드는 모달에서 동기화 트리거 + 결과를 `naver_ad_stats` 테이블에 upsert + 광고 탭에서 fetch해 표시. 자격증명은 Vercel 환경변수에 저장.

**Tech Stack:** Node.js (Vercel function), React 19 (CRA), Supabase, Naver Search Ad REST API.

**Spec:** `docs/superpowers/specs/2026-05-07-naver-ad-integration-design.md`

**전제조건 (이미 완료)**:
- Supabase `naver_ad_stats` 테이블 생성됨, `campaign_id` NOT NULL DEFAULT `''`
- Vercel 환경변수 `PALEO_NAVERAD_CUSTOMER_ID` / `PALEO_NAVERAD_ACCESS_LICENSE` / `PALEO_NAVERAD_SECRET_KEY` 등록됨

---

## 변경 대상 파일

- 신규: `api/naver-ad.js`
- 수정: `src/App.js`

## 진행 전 확인

- [ ] **Step 0-1: working tree clean 확인**

```powershell
git status
```

- [ ] **Step 0-2: feature branch 생성**

```powershell
git checkout -b feature/naver-ad-integration
```

---

### Task 1: Vercel 함수 `api/naver-ad.js` 작성

**Files:**
- Create: `api/naver-ad.js`

- [ ] **Step 1: 파일 생성 및 전체 코드 작성**

`api/naver-ad.js` 신규 파일에 다음 전체 코드:

```javascript
const crypto = require("crypto");

// brandUuid → env alias 매핑
const BRAND_ALIAS = {
  "fd66b113-548b-44b0-8510-b7f49e302145": "PALEO",
};

const NAVERAD_BASE = "https://api.searchad.naver.com";

function signHmac(method, uri, timestamp, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac("sha256", secretKey).update(message).digest("base64");
}

function getCreds(brandUuid) {
  const alias = BRAND_ALIAS[brandUuid];
  if (!alias) return { error: { code: 404, message: "브랜드별 자격증명 매핑 없음" } };
  const customerId = process.env[`${alias}_NAVERAD_CUSTOMER_ID`];
  const accessLicense = process.env[`${alias}_NAVERAD_ACCESS_LICENSE`];
  const secretKey = process.env[`${alias}_NAVERAD_SECRET_KEY`];
  if (!customerId || !accessLicense || !secretKey) {
    return { error: { code: 503, message: `${alias}_NAVERAD_* 환경변수 미설정` } };
  }
  return { creds: { customerId, accessLicense, secretKey } };
}

async function naverAdGet(uri, creds) {
  const timestamp = Date.now().toString();
  const signature = signHmac("GET", uri.split("?")[0], timestamp, creds.secretKey);
  const headers = {
    "X-Timestamp": timestamp,
    "X-API-KEY": creds.accessLicense,
    "X-Customer": creds.customerId,
    "X-Signature": signature,
    "Content-Type": "application/json",
  };
  const r = await fetch(`${NAVERAD_BASE}${uri}`, { method: "GET", headers });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { action, brand: brandUuid, from, to } = req.query;
  if (!brandUuid) return res.status(400).json({ error: "brand 파라미터 필요" });

  const credsResult = getCreds(brandUuid);
  if (credsResult.error) {
    return res.status(credsResult.error.code).json({ error: credsResult.error.message });
  }
  const creds = credsResult.creds;

  if (action === "stats") {
    if (!from || !to) return res.status(400).json({ error: "from, to 필요" });
    try {
      // 1. 캠페인 목록 fetch
      const campResp = await naverAdGet("/ncc/campaigns", creds);
      if (!campResp.ok) {
        return res.status(campResp.status).json({ error: "campaigns fetch 실패", raw: campResp.data });
      }
      const campaigns = Array.isArray(campResp.data) ? campResp.data : [];
      const ids = campaigns.map(c => c.nccCampaignId).filter(Boolean);
      if (ids.length === 0) {
        return res.status(200).json({ stats: [], _debug: { reason: "no_campaigns", campaignsRaw: campResp.data } });
      }

      // 2. 일별 stats fetch
      const fields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const timeRange = JSON.stringify({ since: from, until: to });
      const idsParam = JSON.stringify(ids);
      const statsUri = `/stats?ids=${encodeURIComponent(idsParam)}&fields=${encodeURIComponent(fields)}&timeRange=${encodeURIComponent(timeRange)}&datePreset=custom&breakdown=day`;
      const statsResp = await naverAdGet(statsUri, creds);
      if (!statsResp.ok) {
        return res.status(statsResp.status).json({ error: "stats fetch 실패", raw: statsResp.data });
      }

      // 3. 응답 일별 합산 (응답 구조: data[].stats[] 또는 data[]에 직접 일별 row)
      const byDate = {};
      const items = statsResp.data?.data || statsResp.data?.stats || (Array.isArray(statsResp.data) ? statsResp.data : []);
      items.forEach(item => {
        const dailyArr = item.stats || (item.date ? [item] : []);
        dailyArr.forEach(s => {
          const date = s.date || s.statDate;
          if (!date) return;
          const key = String(date).slice(0, 10);
          if (!byDate[key]) byDate[key] = { date: key, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0 };
          byDate[key].impressions += Number(s.impCnt || 0);
          byDate[key].clicks += Number(s.clkCnt || 0);
          byDate[key].cost += Number(s.salesAmt || 0);
          byDate[key].conversions += Number(s.ccnt || 0);
          byDate[key].conversion_value += Number(s.convAmt || 0);
        });
      });
      const result = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

      return res.status(200).json({ stats: result, _debug: { campaignCount: ids.length, statsResponseShape: typeof statsResp.data, statsResponseTopKeys: statsResp.data ? Object.keys(statsResp.data) : null } });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: "action not found" });
};
```

- [ ] **Step 2: Node 구문 점검**

```powershell
node -c api/naver-ad.js
```

Expected: 무에러.

- [ ] **Step 3: 커밋**

```powershell
git add api/naver-ad.js
git commit -m @'
feat(api): 네이버 검색광고 stats Vercel 함수 추가

- HMAC-SHA256 시그니처 인증
- /ncc/campaigns로 캠페인 ID 수집 → /stats?breakdown=day로 일별 통계
- 캠페인 합산 후 일별 row 반환 (impressions/clicks/cost/conversions/conversion_value)
- 에러: 매핑없음 404, env미설정 503, 외부 API 에러 그대로 전달

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

(closing `'@` MUST be at column 0)

---

### Task 2: Frontend state + 광고 탭 분기 (placeholder → 실제 화면 라우팅)

**Files:**
- Modify: `src/App.js:355-356` (smartstoreMallType 부근에 state 추가)
- Modify: `src/App.js:28-30` (NAVERAD_CONFIGURED_BRANDS 상수)
- Modify: `src/App.js:1409-1415` (광고 탭 placeholder 교체)

- [ ] **Step 1: NAVERAD_CONFIGURED_BRANDS 상수 추가**

`src/App.js:28-30` 부근의 다음 줄 아래에 추가:

기존 (L28-30):
```javascript
const MALL_TYPES = ["자사몰","스마트스토어"];
const MALL_TYPE_COLORS = {
  ...
};
```

이 다음에 추가:
```javascript
const NAVERAD_CONFIGURED_BRANDS = ["fd66b113-548b-44b0-8510-b7f49e302145"]; // 팔레오 (자격증명 등록된 브랜드만)
```

(MALL_TYPE_COLORS 객체 닫는 `};` 다음 줄에 추가)

- [ ] **Step 2: state 변수 추가**

`src/App.js:356` 부근의 smartstoreMallType state 다음에 추가:

기존 (L356):
```javascript
  const [smartstoreMallType, setSmartStoreMallType] = useState("");
```

직후에 다음 추가:
```javascript
  // 네이버 검색광고
  const [naverAdStats, setNaverAdStats] = useState([]);
  const [showNaverAdModal, setShowNaverAdModal] = useState(false);
  const [naverAdSyncing, setNaverAdSyncing] = useState(false);
  const [naverAdSyncResult, setNaverAdSyncResult] = useState("");
  const [naverAdCustomStart, setNaverAdCustomStart] = useState("");
  const [naverAdCustomEnd, setNaverAdCustomEnd] = useState("");
```

- [ ] **Step 3: 광고 탭 placeholder를 분기 라우팅으로 교체**

`src/App.js:1409-1415` 부근 다음 블록:

```javascript
          {/* ── 광고 탭 ── */}
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="광고" && (
            <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#1E293B", marginBottom:16 }}>📣 광고</div>
              <div style={{ color:"#94A3B8", fontSize:13 }}>{currentBrand.name} {currentMallType} 광고 기능은 준비 중입니다.</div>
            </div>
          )}
```

다음으로 교체:

```javascript
          {/* ── 광고 탭 ── */}
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="광고" && (() => {
            const isNaverAdBrand = NAVERAD_CONFIGURED_BRANDS.includes(currentBrand.id);
            const isCafe24Mall = currentMallType === "자사몰";
            if (!isCafe24Mall) {
              return (
                <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", textAlign:"center" }}>
                  <div style={{ fontSize:30, marginBottom:10 }}>📣</div>
                  <div style={{ fontSize:14, fontWeight:700, color:"#1E293B", marginBottom:6 }}>네이버 검색광고는 자사몰 유입에만 적용됩니다</div>
                  <div style={{ fontSize:12, color:"#94A3B8" }}>{currentMallType} 내부 광고는 별도 채널이라 미지원입니다.</div>
                </div>
              );
            }
            if (!isNaverAdBrand) {
              return (
                <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", textAlign:"center" }}>
                  <div style={{ fontSize:30, marginBottom:10 }}>📣</div>
                  <div style={{ fontSize:14, fontWeight:700, color:"#1E293B", marginBottom:6 }}>{currentBrand.name} 네이버광고 자격증명 미설정</div>
                  <div style={{ fontSize:12, color:"#94A3B8" }}>Vercel 환경변수에 {`<BRAND>`}_NAVERAD_* 등록 후 이용 가능합니다.</div>
                </div>
              );
            }
            // Task 3에서 실제 본문 렌더링 추가 예정
            return (
              <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize:15, fontWeight:700, color:"#1E293B", marginBottom:16 }}>📣 광고 (Task 3 본문 추가 예정)</div>
              </div>
            );
          })()}
```

- [ ] **Step 4: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('NAVERAD_CONFIGURED_BRANDS:', code.includes('const NAVERAD_CONFIGURED_BRANDS = ['));console.log('naverAdStats state:', code.includes('const [naverAdStats, setNaverAdStats]'));console.log('자격증명 미설정 안내:', code.includes('네이버광고 자격증명 미설정'));console.log('자사몰 외 미지원 안내:', code.includes('자사몰 유입에만 적용'));"
```

Expected: 모두 `true`.

- [ ] **Step 5: 커밋**

```powershell
git add src/App.js
git commit -m @'
feat(app): Task 2 — 광고 탭 라우팅 분기 + naverAd state

- NAVERAD_CONFIGURED_BRANDS 상수 (현재 팔레오만)
- naverAdStats / showNaverAdModal / naverAdSyncing / naverAdSyncResult / naverAdCustomStart/End state
- 광고 탭: 자사몰 외 → "스마트스토어 내부 광고는 별도 채널" 안내
                미등록 brand → "자격증명 미설정" 안내
                자사몰 + 등록 brand → 본문 placeholder (Task 3에서 실제 화면)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 3: 광고 탭 본문 (요약 카드 + ROAS + 일별 표)

**Files:**
- Modify: `src/App.js` Task 2에서 추가한 placeholder return 자리

- [ ] **Step 1: useEffect로 naver_ad_stats fetch**

`src/App.js:402` 부근 (`useEffect(() => { if (!session || userRole !== "admin") return;` 패턴 다음 정도)에 다음 useEffect 추가:

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
      .eq("campaign_id", "")
      .gte("date", filter.from)
      .lte("date", filter.to)
      .order("date")
      .then(({ data }) => setNaverAdStats(data || []));
  }, [currentBrand, currentMallType, mainTab, filter.from, filter.to]);
```

- [ ] **Step 2: 본문 placeholder를 실제 렌더링으로 교체**

`src/App.js`에서 Task 2에서 추가한 다음 블록을:

```javascript
            // Task 3에서 실제 본문 렌더링 추가 예정
            return (
              <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize:15, fontWeight:700, color:"#1E293B", marginBottom:16 }}>📣 광고 (Task 3 본문 추가 예정)</div>
              </div>
            );
```

다음으로 교체:

```javascript
            // 자사몰 매출 매칭 (날짜별)
            const salesByDate = {};
            orders.filter(o => o.brandId === currentBrand.id && o.mallType === "자사몰" && !o.isCancelled)
              .forEach(o => { salesByDate[o.date] = (salesByDate[o.date]||0) + (o.totalAmount||0); });
            const totalCost = naverAdStats.reduce((s,r)=>s+(r.cost||0), 0);
            const totalImpr = naverAdStats.reduce((s,r)=>s+(r.impressions||0), 0);
            const totalClk = naverAdStats.reduce((s,r)=>s+(r.clicks||0), 0);
            const totalConv = naverAdStats.reduce((s,r)=>s+(r.conversions||0), 0);
            const totalConvVal = naverAdStats.reduce((s,r)=>s+(r.conversion_value||0), 0);
            const totalSales = naverAdStats.reduce((s,r)=>s+(salesByDate[r.date]||0), 0);
            const ctr = totalImpr>0 ? (totalClk/totalImpr*100).toFixed(2) : "0";
            const appRoas = totalCost>0 ? (totalSales/totalCost*100).toFixed(0) : "0";
            const naverRoas = totalCost>0 ? (totalConvVal/totalCost*100).toFixed(0) : "0";
            return (
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                  <div style={{ fontSize:18, fontWeight:800, color:"#1E293B" }}>📣 네이버 검색광고 — {currentBrand.name}</div>
                  <button onClick={()=>{ setShowNaverAdModal(true); setNaverAdSyncResult(""); }} style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #BFDBFE", background:"#EFF6FF", color:"#3B82F6", cursor:"pointer", fontSize:13, fontWeight:700 }}>🔍 동기화</button>
                </div>
                {naverAdStats.length === 0 ? (
                  <div style={{ background:"white", borderRadius:14, padding:32, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", textAlign:"center" }}>
                    <div style={{ fontSize:30, marginBottom:10 }}>📊</div>
                    <div style={{ fontSize:14, fontWeight:700, color:"#1E293B", marginBottom:6 }}>아직 동기화된 광고 데이터가 없습니다</div>
                    <div style={{ fontSize:12, color:"#94A3B8" }}>우측 상단 🔍 동기화 버튼으로 받아오세요.</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)", gap:12, marginBottom:14 }}>
                      {[
                        {label:"광고비", val:fmt(totalCost), icon:"💰", color:"#EF4444"},
                        {label:"노출수", val:totalImpr.toLocaleString()+"회", icon:"👁", color:"#3B82F6"},
                        {label:"클릭수", val:totalClk.toLocaleString()+"회", icon:"🖱", color:"#10B981"},
                        {label:"CTR", val:ctr+"%", icon:"📊", color:"#8B5CF6"},
                      ].map(k=>(
                        <div key={k.label} style={{...card, padding:"14px 16px", borderLeft:`4px solid ${k.color}`, margin:0}}>
                          <div style={{ fontSize:12, color:"#94A3B8", fontWeight:600, marginBottom:4 }}>{k.icon} {k.label}</div>
                          <div style={{ fontSize:17, fontWeight:800, color:"#1E293B" }}>{k.val}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{...card, marginBottom:14, padding:"16px 18px"}}>
                      <h2 style={{...cardTitle, marginBottom:10}}>📈 ROAS</h2>
                      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12 }}>
                        <div style={{ padding:"12px 14px", borderRadius:10, background:"#EFF6FF", border:"1px solid #BFDBFE" }}>
                          <div style={{ fontSize:12, color:"#3B82F6", fontWeight:600, marginBottom:4 }}>앱 ROAS (자사몰 매출 ÷ 광고비)</div>
                          <div style={{ fontSize:22, fontWeight:800, color:"#1E40AF" }}>{appRoas}%</div>
                          <div style={{ fontSize:11, color:"#64748B", marginTop:2 }}>매출 {fmt(totalSales)} ÷ 광고비 {fmt(totalCost)} (광고 외 매출 포함, 참고용)</div>
                        </div>
                        <div style={{ padding:"12px 14px", borderRadius:10, background:"#F0FDF4", border:"1px solid #BBF7D0" }}>
                          <div style={{ fontSize:12, color:"#10B981", fontWeight:600, marginBottom:4 }}>Naver attributed ROAS</div>
                          <div style={{ fontSize:22, fontWeight:800, color:"#065F46" }}>{naverRoas}%</div>
                          <div style={{ fontSize:11, color:"#64748B", marginTop:2 }}>전환매출 {fmt(totalConvVal)} ÷ 광고비 {fmt(totalCost)} ({totalConv}건 추적, underreporting 가능)</div>
                        </div>
                      </div>
                    </div>
                    <div style={card}>
                      <h2 style={{...cardTitle, marginBottom:14}}>📅 일별 광고 성과</h2>
                      <div style={{ overflowY:"auto", maxHeight:520 }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                          <thead>
                            <tr style={{ borderBottom:"2px solid #E2E8F0" }}>
                              {["날짜","광고비","노출","클릭","CTR","자사몰매출","앱 ROAS"].map(h=>(
                                <th key={h} style={{ padding:"8px", textAlign:h==="날짜"?"left":"right", fontWeight:700, color:"#64748B" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {naverAdStats.map(r=>{
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
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </>
            );
```

- [ ] **Step 3: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('useEffect naver_ad_stats fetch:', code.includes('.eq(\"campaign_id\", \"\")'));console.log('ROAS card:', code.includes('Naver attributed ROAS'));console.log('일별 표:', code.includes('일별 광고 성과'));console.log('🔍 동기화 버튼:', code.includes('🔍 동기화'));"
```

Expected: 모두 `true`.

- [ ] **Step 4: 커밋**

```powershell
git add src/App.js
git commit -m @'
feat(app): Task 3 — 광고 탭 본문 (요약 + ROAS + 일별 표)

- useEffect로 naver_ad_stats 일별 row fetch
- 자사몰 매출은 orders state에서 매칭 (날짜별 합산)
- 요약 카드 4개: 광고비/노출수/클릭수/CTR
- ROAS 카드 2가지: 앱 ROAS (모든 매출), Naver attributed ROAS (전환매출만)
- 일별 표: 날짜/광고비/노출/클릭/CTR/자사몰매출/앱 ROAS

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 4: 동기화 모달 + sync 함수

**Files:**
- Modify: `src/App.js` 모달 영역에 추가

- [ ] **Step 1: syncNaverAdStats 함수 추가**

`src/App.js:838` 부근 (syncSmartStoreOrders 함수 직후)에 다음 추가:

```javascript
  // 네이버 검색광고 동기화
  async function syncNaverAdStats(brand, startDate, endDate) {
    setNaverAdSyncing(true); setNaverAdSyncResult("");
    try {
      setNaverAdSyncResult(`⏳ 수집 중... (${startDate} ~ ${endDate})`);
      const r = await fetch(`/api/naver-ad?action=stats&brand=${brand.id}&from=${startDate}&to=${endDate}`);
      const data = await r.json();
      if (!r.ok || data.error) {
        setNaverAdSyncResult(`❌ ${data.error||""} ${data.raw?JSON.stringify(data.raw).slice(0,200):""}`);
        setNaverAdSyncing(false);
        return;
      }
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
      if (upErr) {
        setNaverAdSyncResult(`❌ DB 저장 오류: ${upErr.code||""} ${upErr.message||JSON.stringify(upErr)}`);
        setNaverAdSyncing(false);
        return;
      }
      // 동기화 후 화면 데이터 갱신
      const { data: refreshed } = await supabase.from("naver_ad_stats")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("mall_type", "자사몰")
        .eq("campaign_id", "")
        .gte("date", filter.from)
        .lte("date", filter.to)
        .order("date");
      setNaverAdStats(refreshed || []);
      setNaverAdSyncResult(`✅ ${stats.length}일치 동기화 완료`);
    } catch(e) {
      setNaverAdSyncResult("❌ 오류: " + e.message);
    }
    setNaverAdSyncing(false);
  }
```

- [ ] **Step 2: 동기화 모달 JSX 추가**

`src/App.js`의 SmartStore 모달 직후 (대략 `{showSmartstoreModal && smartstoreBrand && (...)}` 닫힘 다음, `{/* 공지사항 모달 */}` 또는 다른 모달 시작 직전)에 추가:

```javascript
      {/* 네이버 검색광고 동기화 모달 */}
      {showNaverAdModal && currentBrand && (
        <div style={modalBg} onClick={()=>setShowNaverAdModal(false)}>
          <div style={{...modalBox,width:420}} onClick={e=>e.stopPropagation()}>
            <h3 style={modalTitle}>🔍 네이버 검색광고 동기화 — {currentBrand.name}</h3>
            <div style={{ marginBottom:14, padding:"10px 14px", background:"#F0FDF4", borderRadius:10, border:"1px solid #BBF7D0", fontSize:13, color:"#065F46" }}>
              ✅ 자격증명 등록됨 (Vercel env)
            </div>
            <div style={{ borderTop:"1px solid #F1F5F9", paddingTop:14 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#1E293B", marginBottom:10 }}>📊 광고 통계 동기화</div>
              {(()=>{
                const now = new Date(Date.now()+9*60*60*1000);
                const yest = yesterday();
                const thisMonthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-01`;
                const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
                const lastMonthStart = `${lm.getUTCFullYear()}-${String(lm.getUTCMonth()+1).padStart(2,'0')}-01`;
                const lastMonthEnd = `${lm.getUTCFullYear()}-${String(lm.getUTCMonth()+1).padStart(2,'0')}-${String(lm.getUTCDate()).padStart(2,'0')}`;
                const weekAgo = new Date(Date.now()+9*60*60*1000-7*86400000).toISOString().slice(0,10);
                return (
                  <div style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                      {[{label:"최근 7일",start:weekAgo,end:yest},{label:"당월",start:thisMonthStart,end:yest},{label:"전월",start:lastMonthStart,end:lastMonthEnd}].map(opt=>(
                        <button key={opt.label} onClick={()=>syncNaverAdStats(currentBrand,opt.start,opt.end)} disabled={naverAdSyncing} style={{ flex:1, padding:"8px", borderRadius:8, border:"1px solid #E2E8F0", background:"white", cursor:naverAdSyncing?"not-allowed":"pointer", fontSize:13, fontWeight:600, color:"#475569" }}>
                          {naverAdSyncing?"⏳":opt.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <input type="date" value={naverAdCustomStart||""} max={yest} onChange={e=>setNaverAdCustomStart(e.target.value)} style={{...inp,flex:1,fontSize:12}} />
                      <span style={{fontSize:12,color:"#94A3B8"}}>~</span>
                      <input type="date" value={naverAdCustomEnd||""} max={yest} onChange={e=>setNaverAdCustomEnd(e.target.value)} style={{...inp,flex:1,fontSize:12}} />
                      <button onClick={()=>naverAdCustomStart&&naverAdCustomEnd&&syncNaverAdStats(currentBrand,naverAdCustomStart,naverAdCustomEnd)} disabled={naverAdSyncing||!naverAdCustomStart||!naverAdCustomEnd} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #BFDBFE", background:"#EFF6FF", color:"#3B82F6", cursor:"pointer", fontSize:13, fontWeight:600, whiteSpace:"nowrap" }}>동기화</button>
                    </div>
                  </div>
                );
              })()}
              {naverAdSyncResult && (
                <div style={{ padding:"10px 14px", borderRadius:10, fontSize:13, background:naverAdSyncResult.startsWith("✅")?"#F0FDF4":"#FEF2F2", border:naverAdSyncResult.startsWith("✅")?"1px solid #BBF7D0":"1px solid #FCA5A5", color:naverAdSyncResult.startsWith("✅")?"#065F46":"#DC2626" }}>
                  {naverAdSyncResult}
                </div>
              )}
            </div>
            <button onClick={()=>setShowNaverAdModal(false)} style={{...secondaryBtn,width:"100%",marginTop:14}}>닫기</button>
          </div>
        </div>
      )}
```

- [ ] **Step 3: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('syncNaverAdStats 함수:', code.includes('async function syncNaverAdStats(brand, startDate, endDate)'));console.log('네이버 검색광고 동기화 모달:', code.includes('네이버 검색광고 동기화 —'));console.log('upsert with conflict:', code.includes('onConflict: \"brand_id,date,campaign_id\"'));console.log('preset 버튼 3개:', code.includes('최근 7일') && code.includes('당월') && code.includes('전월'));"
```

Expected: 모두 `true`.

- [ ] **Step 4: 커밋**

```powershell
git add src/App.js
git commit -m @'
feat(app): Task 4 — 네이버광고 동기화 모달 + sync 함수

- syncNaverAdStats: api/naver-ad.js 호출 → naver_ad_stats upsert → state 갱신
- 모달: 자격증명 안내 + 프리셋(최근7일/당월/전월) + 직접지정 + 결과 메시지
- 광고 탭의 🔍 동기화 버튼이 모달 오픈

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 5: 빌드 검증 + 단일 squash to main

- [ ] **Step 1: 프로덕션 빌드**

```powershell
npm run build
```

Expected: `Compiled successfully.` 또는 `Compiled with warnings.` (warnings only — pre-existing).

- [ ] **Step 2: Node 구문 점검**

```powershell
node -c api/naver-ad.js
```

Expected: 무에러.

- [ ] **Step 3: 데스크탑 시나리오 스모크 테스트 (Vercel 배포 후)**

배포 완료 후 https://order-manager-kappa.vercel.app 에서:

| 시나리오 | 기대 동작 |
|---------|----------|
| 팔레오 → 자사몰 → 광고 | "📣 네이버 검색광고 — 팔레오" 헤더 + 🔍 동기화 버튼 + "아직 동기화된 광고 데이터가 없습니다" 빈 상태 |
| 🔍 동기화 → 모달 → 최근 7일 | 모달에 "⏳ 수집 중... → ⏳ DB 저장 중... → ✅ 7일치 동기화 완료" |
| 모달 닫기 후 광고 탭 | 요약 카드 + ROAS + 일별 표 표시 |
| 팔레오 → 브랜드스토어 → 광고 | "네이버 검색광고는 자사몰 유입에만 적용됩니다" 안내 |
| 코코엘 → 자사몰 → 광고 | "코코엘 네이버광고 자격증명 미설정" 안내 |

- [ ] **Step 4: main에 squash-merge**

```powershell
git checkout main
git merge --squash feature/naver-ad-integration
git commit -m @'
feat: 네이버 검색광고 연동 (1단계 — 일별 광고비 + ROAS)

팔레오 자사몰의 네이버 검색광고 데이터를 가져와 광고 탭에서 일별로 표시.
자사몰 매출과 매칭해 앱 ROAS / Naver attributed ROAS 계산.

- api/naver-ad.js: HMAC-SHA256 시그니처로 Naver Search Ad API 호출
  - /ncc/campaigns 캠페인 목록 + /stats?breakdown=day 일별 통계
  - 캠페인 합산 후 일별 row 반환
- src/App.js: 광고 탭 라우팅 분기 + 본문 렌더링 + 동기화 모달
  - NAVERAD_CONFIGURED_BRANDS 등록 brand만 활성
  - 자사몰 외 mall은 "별도 채널 미지원" 안내
- naver_ad_stats 테이블 (이미 생성, campaign_id NOT NULL DEFAULT '')

전제조건 (이미 완료):
- Vercel env: PALEO_NAVERAD_CUSTOMER_ID/ACCESS_LICENSE/SECRET_KEY
- Supabase naver_ad_stats 테이블

Spec: docs/superpowers/specs/2026-05-07-naver-ad-integration-design.md
Plan: docs/superpowers/plans/2026-05-07-naver-ad-integration.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

- [ ] **Step 5: feature branch 삭제 + push 확인**

```powershell
git branch -D feature/naver-ad-integration
git log --oneline origin/main..HEAD
```

(push는 사용자 승인 후)
