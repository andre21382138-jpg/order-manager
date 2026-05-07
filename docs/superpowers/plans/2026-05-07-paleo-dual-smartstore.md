# 팔레오 스마트스토어 2개 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팔레오의 스마트스토어를 "브랜드스토어"와 "도깨비나라"로 분리하고, 백엔드에서 두 스토어의 Naver Commerce 자격증명을 독립적으로 사용해 동기화한다.

**Architecture:** `mall_type`을 "스마트스토어" 같은 플랫폼 라벨이 아니라 실제 스토어 이름으로 사용. 자사몰(`mall_type === "자사몰"`)은 카페24, 그 외(`!== "자사몰"`)는 모두 Naver Commerce 변종. proxy/sync는 (brandId, mallType) 튜플로 자격증명을 분기.

**Tech Stack:** React 19 (CRA) + Node.js (proxy/sync) + Supabase. UI + 백엔드 양쪽 변경.

**Spec:** `docs/superpowers/specs/2026-05-07-paleo-dual-smartstore-design.md`

**Vercel 자동배포 고려**: 모든 단계는 main 브랜치 단일 커밋으로 마무리. 작업은 `feature/paleo-dual-smartstore` 브랜치에서 task별 커밋 후 squash-merge.

**카페24 서버 배포 별도**: `server/` 변경분은 Vercel과 무관. 사용자가 카페24 서버에서 `git pull` + `pm2 restart naver-proxy` 수동 실행 필요.

---

## 변경 대상 파일

- `src/App.js`
- `server/proxy.js`
- `server/sync.js`
- `README.md`
- (Supabase) — SQL 마이그레이션 (사용자 수동 실행)

## 진행 전 확인

- [ ] **Step 0-1: working tree clean 확인**

```powershell
git status
```

main이 origin보다 6+ commits 앞 (이전 작업들 + 이번 spec) — 정상.

- [ ] **Step 0-2: feature branch 생성**

```powershell
git checkout -b feature/paleo-dual-smartstore
```

---

### Task 1: Frontend constants + state 추가

**Files:**
- Modify: `src/App.js:28-29` (MALL_TYPE_COLORS 확장)
- Modify: `src/App.js` 스마트스토어 state 영역 (대략 L348-352)

- [ ] **Step 1: MALL_TYPE_COLORS 확장**

`src/App.js:28-29`:

기존:
```javascript
const MALL_TYPES = ["자사몰","스마트스토어"];
const MALL_TYPE_COLORS = { "자사몰":"#8B5CF6", "스마트스토어":"#10B981" };
```

변경 후:
```javascript
const MALL_TYPES = ["자사몰","스마트스토어"];
const MALL_TYPE_COLORS = {
  "자사몰":"#8B5CF6",
  "스마트스토어":"#10B981",
  "브랜드스토어":"#10B981",
  "도깨비나라":"#F59E0B",
};
```

(MALL_TYPES 상수는 그대로 — 브랜드 추가 모달에서만 사용. 팔레오의 mall_types는 SQL로 직접 설정.)

- [ ] **Step 2: smartStoreMallType state 추가**

`src/App.js:349-352` 부근의 스마트스토어 state 블록 찾기:

```javascript
  // 스마트스토어 연동
  const [showSmartstoreModal, setShowSmartstoreModal] = useState(false);
  const [smartstoreBrand, setSmartStoreBrand] = useState(null);
```

이 줄들 직후에 다음 추가:

```javascript
  const [smartstoreMallType, setSmartStoreMallType] = useState("");
```

(`setSmartStoreSyncResult` 등 다른 state 선언은 그대로 유지)

- [ ] **Step 3: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('브랜드스토어 color:', code.includes('\"브랜드스토어\":\"#10B981\"'));console.log('도깨비나라 color:', code.includes('\"도깨비나라\":\"#F59E0B\"'));console.log('smartstoreMallType state:', code.includes('const [smartstoreMallType, setSmartStoreMallType]'));"
```

Expected: 모두 `true`.

- [ ] **Step 4: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 1 — MALL_TYPE_COLORS 확장 + smartstoreMallType state

브랜드스토어/도깨비나라 색상 추가, sync 모달이 어떤 store인지 추적할 state 추가.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

(closing `'@` MUST be at column 0)

---

### Task 2: Frontend `=== "스마트스토어"` 비교 일반화

**Files:**
- Modify: `src/App.js` 여러 줄 (아래 5개 위치)

- [ ] **Step 1: 신규/재구매 카운트 (자사몰만 해당하는 로직)**

`src/App.js:983` 부근에서 다음 줄 찾기:

```javascript
      if (o.mallType !== "스마트스토어") { if (o.isNew) { newCount++; newAmount+=o.totalAmount; } else { reCount++; reAmount+=o.totalAmount; } }
```

다음으로 교체 (positive form — 자사몰일 때만):

```javascript
      if (o.mallType === "자사몰") { if (o.isNew) { newCount++; newAmount+=o.totalAmount; } else { reCount++; reAmount+=o.totalAmount; } }
```

- [ ] **Step 2: 결산 카드 — 신규/재구매 영역 가시성**

`src/App.js:1546` 부근 다음 줄 찾기:

```javascript
              {filter.mallType !== "스마트스토어" && <div style={{...card, marginBottom:14, padding:"16px 18px"}}>
```

다음으로 교체:

```javascript
              {filter.mallType === "자사몰" && <div style={{...card, marginBottom:14, padding:"16px 18px"}}>
```

(자사몰일 때만 신규/재구매 영역 표시.)

- [ ] **Step 3: 결산 카드 — 미지원 라벨 텍스트**

`src/App.js:1577` 부근 다음 패턴 찾기:

```javascript
                          {filter.mallType==="스마트스토어"?<div style={{fontSize:10,color:"#FCA5A5",marginTop:4}}>스마트스토어 미지원</div>:(!filter.mallType&&<div style={{fontSize:10,color:"#CBD5E1",marginTop:4}}>자사몰만 해당</div>)}
```

다음으로 교체:

```javascript
                          {filter.mallType && filter.mallType!=="자사몰"?<div style={{fontSize:10,color:"#FCA5A5",marginTop:4}}>{filter.mallType} 미지원</div>:(!filter.mallType&&<div style={{fontSize:10,color:"#CBD5E1",marginTop:4}}>자사몰만 해당</div>)}
```

(미지원 라벨에 실제 mall 이름 표시.)

- [ ] **Step 4: Desktop drawer 🔗 onClick 분기**

`src/App.js:1195` 부근 다음 패턴 찾기:

```javascript
                      onClick={(e) => {
                        e.stopPropagation();
                        if (t === "스마트스토어") {
                          setSmartStoreBrand(drawerBrand); setSmartStoreSyncResult(""); setShowSmartstoreModal(true);
                        } else {
                          setCafe24Brand(drawerBrand); setCafe24MallId(cafe24Tokens[drawerBrand.id]?.mall_id||""); setCafe24SyncResult(""); setShowCafe24Modal(true);
                        }
                      }}
                      title={t==="스마트스토어"?"스마트스토어 동기화":"카페24 연동"}
```

다음으로 교체:

```javascript
                      onClick={(e) => {
                        e.stopPropagation();
                        if (t === "자사몰") {
                          setCafe24Brand(drawerBrand); setCafe24MallId(cafe24Tokens[drawerBrand.id]?.mall_id||""); setCafe24SyncResult(""); setShowCafe24Modal(true);
                        } else {
                          setSmartStoreBrand(drawerBrand); setSmartStoreMallType(t); setSmartStoreSyncResult(""); setShowSmartstoreModal(true);
                        }
                      }}
                      title={t==="자사몰"?"카페24 연동":`${t} 동기화`}
```

(자사몰 → 카페24, 그 외 → 스마트스토어 모달. mallType도 setSmartStoreMallType으로 전달.)

- [ ] **Step 5: Mobile drawer 🔗 onClick 분기**

`src/App.js:1256` 부근에서 같은 패턴 (mobile drawer 안). Step 4와 동일한 방식으로 교체:

기존:
```javascript
                        onClick={(e) => {
                          e.stopPropagation();
                          if (t === "스마트스토어") {
                            setSmartStoreBrand(drawerBrand); setSmartStoreSyncResult(""); setShowSmartstoreModal(true);
                          } else {
                            setCafe24Brand(drawerBrand); setCafe24MallId(cafe24Tokens[drawerBrand.id]?.mall_id||""); setCafe24SyncResult(""); setShowCafe24Modal(true);
                          }
                        }}
                        title={t==="스마트스토어"?"스마트스토어 동기화":"카페24 연동"}
```

변경 후:
```javascript
                        onClick={(e) => {
                          e.stopPropagation();
                          if (t === "자사몰") {
                            setCafe24Brand(drawerBrand); setCafe24MallId(cafe24Tokens[drawerBrand.id]?.mall_id||""); setCafe24SyncResult(""); setShowCafe24Modal(true);
                          } else {
                            setSmartStoreBrand(drawerBrand); setSmartStoreMallType(t); setSmartStoreSyncResult(""); setShowSmartstoreModal(true);
                          }
                        }}
                        title={t==="자사몰"?"카페24 연동":`${t} 동기화`}
```

- [ ] **Step 6: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('자사몰 신규/재구매 logic:', code.includes('if (o.mallType === \"자사몰\")'));console.log('결산 카드 가시성:', code.includes('filter.mallType === \"자사몰\" && <div style'));console.log('미지원 라벨 동적:', code.includes('{filter.mallType} 미지원'));console.log('drawer onClick 일반화:', (code.match(/if \(t === \"자사몰\"\) \{/g)||[]).length === 2);console.log('잔존 === 스마트스토어 비교:', (code.match(/=== ?\"스마트스토어\"/g)||[]).length);"
```

Expected:
- 첫 4개 모두 `true`
- 잔존 비교 카운트: 0 또는 매우 낮음 (모달 헤더 텍스트 등 문자열 리터럴은 OK; `===` 비교만 0)

- [ ] **Step 7: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 2 — "=== 스마트스토어" 비교를 "=== 자사몰" 또는 "!== 자사몰"로 일반화

5개 위치 업데이트:
- 신규/재구매 카운트 (자사몰만)
- 결산 카드 신규/재구매 영역 가시성
- 결산 카드 미지원 라벨 텍스트 (실제 mall 이름 표시)
- Desktop drawer 🔗 onClick 분기 + setSmartStoreMallType
- Mobile drawer 🔗 onClick 분기 + setSmartStoreMallType

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 3: Frontend syncSmartStoreOrders 함수 수정

**Files:**
- Modify: `src/App.js:834` 부근 (syncSmartStoreOrders 함수)
- Modify: 모달 내부 sync 호출 위치 (대략 L1962, 1971)

- [ ] **Step 1: 함수 시그니처에 mallType 추가**

`src/App.js:834`:

기존:
```javascript
  async function syncSmartStoreOrders(brand, startDate, endDate) {
```

변경 후:
```javascript
  async function syncSmartStoreOrders(brand, startDate, endDate, mallType) {
```

- [ ] **Step 2: proxy URL에 mallType 파라미터 추가**

`src/App.js:853` 부근:

기존:
```javascript
        const r = await fetch(`${PROXY_URL}/orders?brandId=${brand.id}&from=${from}&to=${to}`, {
```

변경 후:
```javascript
        const r = await fetch(`${PROXY_URL}/orders?brandId=${brand.id}&mallType=${encodeURIComponent(mallType)}&from=${from}&to=${to}`, {
```

- [ ] **Step 3: orders.upsert에서 mallType 사용**

`src/App.js:932` 부근:

기존:
```javascript
          .upsert(batch.map(o => ({ brand_id: brand.id, mall_type: "스마트스토어", order_no: o.orderNo, date: o.orderDate, total_amount: o.totalAmount, original_amount: o.originalAmount, is_cancelled: o.isCancelled, is_new: o.isNew, total_qty: o.totalQty || 1, note: "스마트스토어 자동수집" })), { onConflict: "order_no,brand_id" })
```

변경 후:
```javascript
          .upsert(batch.map(o => ({ brand_id: brand.id, mall_type: mallType, order_no: o.orderNo, date: o.orderDate, total_amount: o.totalAmount, original_amount: o.originalAmount, is_cancelled: o.isCancelled, is_new: o.isNew, total_qty: o.totalQty || 1, note: `${mallType} 자동수집` })), { onConflict: "order_no,brand_id" })
```

- [ ] **Step 4: 모달 sync 호출 위치 수정**

`src/App.js:1962` 부근, 다음 패턴 찾기:

```javascript
                        <button key={opt.label} onClick={()=>syncSmartStoreOrders(smartstoreBrand,opt.start,opt.end)} disabled={smartstoreSyncing}
```

다음으로 교체:

```javascript
                        <button key={opt.label} onClick={()=>syncSmartStoreOrders(smartstoreBrand,opt.start,opt.end,smartstoreMallType)} disabled={smartstoreSyncing}
```

`src/App.js:1971` 부근, 다음 패턴 찾기:

```javascript
                      <button onClick={()=>smartstoreCustomStart&&smartstoreCustomEnd&&syncSmartStoreOrders(smartstoreBrand,smartstoreCustomStart,smartstoreCustomEnd)} disabled={smartstoreSyncing||!smartstoreCustomStart||!smartstoreCustomEnd}
```

다음으로 교체:

```javascript
                      <button onClick={()=>smartstoreCustomStart&&smartstoreCustomEnd&&syncSmartStoreOrders(smartstoreBrand,smartstoreCustomStart,smartstoreCustomEnd,smartstoreMallType)} disabled={smartstoreSyncing||!smartstoreCustomStart||!smartstoreCustomEnd}
```

- [ ] **Step 5: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('signature:', code.includes('async function syncSmartStoreOrders(brand, startDate, endDate, mallType)'));console.log('mallType in proxy URL:', code.includes('mallType=\${encodeURIComponent(mallType)}'));console.log('mall_type dynamic:', code.includes('mall_type: mallType,'));console.log('callers updated:', (code.match(/syncSmartStoreOrders\(smartstoreBrand[^)]+smartstoreMallType\)/g)||[]).length === 2);"
```

Expected: 모두 `true` / 마지막 카운트 `2`.

- [ ] **Step 6: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 3 — syncSmartStoreOrders에 mallType 파라미터 추가

- 함수 시그니처: (brand, startDate, endDate, mallType)
- proxy URL: ?brandId=X&mallType=Y&...
- orders.upsert: mall_type을 mallType 인자값 그대로 저장
- note 텍스트: "${mallType} 자동수집"
- 모달 호출 시 smartstoreMallType state 전달

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 4: Frontend SmartStore 모달 갱신

**Files:**
- Modify: `src/App.js:1928-1947` 부근 (모달 헤더 + 연동 상태 안내)

- [ ] **Step 1: 모달 헤더에 mallType 표시 + 연동 매핑 갱신**

`src/App.js:1928-1947` 부근의 다음 블록 찾기:

```javascript
      {showSmartstoreModal && smartstoreBrand && (
        <div style={modalBg} onClick={()=>setShowSmartstoreModal(false)}>
          <div style={{...modalBox,width:420}} onClick={e=>e.stopPropagation()}>
            <h3 style={modalTitle}>🛍️ 스마트스토어 동기화 — {smartstoreBrand.name}</h3>
            {(() => {
              const SMARTSTORE_CONNECTED_IDS = [
                "fd66b113-548b-44b0-8510-b7f49e302145", // 팔레오
                "0a37b281-f262-4402-979c-e63a739bee53", // 코코엘
              ];
              const isConnected = SMARTSTORE_CONNECTED_IDS.includes(smartstoreBrand?.id);
              return isConnected ? (
                <div style={{ marginBottom:14, padding:"10px 14px", background:"#F0FDF4", borderRadius:10, border:"1px solid #BBF7D0", fontSize:13, color:"#065F46" }}>
                  ✅ API 키 등록됨 · {smartstoreBrand.name} 브랜드스토어
                </div>
              ) : (
                <div style={{ marginBottom:14, padding:"10px 14px", background:"#FEF2F2", borderRadius:10, border:"1px solid #FCA5A5", fontSize:13, color:"#DC2626" }}>
                  ❌ 스마트스토어 API 미연동 — 네이버 커머스 API 센터에서 앱 등록 후 연동해주세요
                </div>
              );
            })()}
```

다음으로 교체:

```javascript
      {showSmartstoreModal && smartstoreBrand && (
        <div style={modalBg} onClick={()=>setShowSmartstoreModal(false)}>
          <div style={{...modalBox,width:420}} onClick={e=>e.stopPropagation()}>
            <h3 style={modalTitle}>🛍️ {smartstoreMallType||"스마트스토어"} 동기화 — {smartstoreBrand.name}</h3>
            {(() => {
              const SMARTSTORE_CONNECTED = [
                { brandId:"fd66b113-548b-44b0-8510-b7f49e302145", mallType:"브랜드스토어" },
                { brandId:"fd66b113-548b-44b0-8510-b7f49e302145", mallType:"도깨비나라" },
                { brandId:"0a37b281-f262-4402-979c-e63a739bee53", mallType:"스마트스토어" },
              ];
              const isConnected = SMARTSTORE_CONNECTED.some(c => c.brandId === smartstoreBrand?.id && c.mallType === smartstoreMallType);
              return isConnected ? (
                <div style={{ marginBottom:14, padding:"10px 14px", background:"#F0FDF4", borderRadius:10, border:"1px solid #BBF7D0", fontSize:13, color:"#065F46" }}>
                  ✅ API 매핑 등록됨 · {smartstoreBrand.name} {smartstoreMallType}
                  <div style={{ fontSize:11, color:"#065F46", opacity:0.7, marginTop:2 }}>
                    (실제 자격증명은 카페24 서버 .env에서 결정)
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom:14, padding:"10px 14px", background:"#FEF2F2", borderRadius:10, border:"1px solid #FCA5A5", fontSize:13, color:"#DC2626" }}>
                  ❌ 매핑 없음 — proxy STORE_CRED_ALIAS에 ({smartstoreBrand.name}, {smartstoreMallType}) 조합이 등록되지 않았습니다
                </div>
              );
            })()}
```

(헤더에 mallType 동적 표시; SMARTSTORE_CONNECTED를 (brandId, mallType) 튜플 배열로; 안내 문구도 매핑 단위 명시.)

- [ ] **Step 2: 검증**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('mallType in modal title:', code.includes('{smartstoreMallType||\"스마트스토어\"} 동기화'));console.log('SMARTSTORE_CONNECTED tuple:', code.includes('SMARTSTORE_CONNECTED.some(c => c.brandId'));console.log('도깨비나라 매핑:', code.includes('mallType:\"도깨비나라\"'));"
```

Expected: 모두 `true`.

- [ ] **Step 3: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 4 — SmartStore 모달이 mallType별 표시

- 모달 헤더: 🛍️ {mallType} 동기화 — {brandName}
- SMARTSTORE_CONNECTED를 (brandId, mallType) 튜플 배열로
- 안내 문구도 매핑 단위로 명확화

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 5: Backend proxy.js — (brandId, mallType) 자격증명 매핑

**Files:**
- Modify: `server/proxy.js` 전체 자격증명 영역

- [ ] **Step 1: BRAND_CREDENTIALS → STORE_CRED_ALIAS 변경**

`server/proxy.js:14-26` 부근의 다음 블록 찾기:

```javascript
const BRAND_CREDENTIALS = {
  "fd66b113-548b-44b0-8510-b7f49e302145": {
    APP_ID: process.env.PALEO_APP_ID,
    APP_SECRET: process.env.PALEO_APP_SECRET,
    name: "팔레오",
  },
  "0a37b281-f262-4402-979c-e63a739bee53": {
    APP_ID: process.env.COCOEL_APP_ID,
    APP_SECRET: process.env.COCOEL_APP_SECRET,
    name: "코코엘",
  },
};
const DEFAULT_BRAND_ID = "fd66b113-548b-44b0-8510-b7f49e302145";
```

다음으로 교체:

```javascript
const STORE_CRED_ALIAS = {
  "fd66b113-548b-44b0-8510-b7f49e302145|브랜드스토어": { alias: "PALEO", brandName: "팔레오", storeName: "브랜드스토어" },
  "fd66b113-548b-44b0-8510-b7f49e302145|도깨비나라":   { alias: "DOKEBI", brandName: "팔레오", storeName: "도깨비나라" },
  "0a37b281-f262-4402-979c-e63a739bee53|스마트스토어":  { alias: "COCOEL", brandName: "코코엘", storeName: "스마트스토어" },
};
```

- [ ] **Step 2: getCredentials 시그니처 변경**

`server/proxy.js:28-34`:

기존:
```javascript
function getCredentials(brandId) {
  const c = BRAND_CREDENTIALS[brandId] || BRAND_CREDENTIALS[DEFAULT_BRAND_ID];
  if (!c.APP_ID || !c.APP_SECRET) {
    throw new Error(`자격증명 누락: ${c.name} (.env 확인)`);
  }
  return c;
}
```

다음으로 교체:

```javascript
function getCredentials(brandId, mallType) {
  const key = `${brandId}|${mallType}`;
  const map = STORE_CRED_ALIAS[key];
  if (!map) {
    const err = new Error(`매핑 없음: brandId=${brandId}, mallType=${mallType}`);
    err.statusCode = 404;
    throw err;
  }
  const APP_ID = process.env[`${map.alias}_APP_ID`];
  const APP_SECRET = process.env[`${map.alias}_APP_SECRET`];
  if (!APP_ID || !APP_SECRET) {
    const err = new Error(`자격증명 누락: ${map.brandName} ${map.storeName} (${map.alias}_APP_ID/SECRET .env 확인)`);
    err.statusCode = 503;
    throw err;
  }
  return { APP_ID, APP_SECRET, name: `${map.brandName} ${map.storeName}` };
}
```

- [ ] **Step 3: getNaverToken 시그니처 변경**

`server/proxy.js:56-100` 부근, `function getNaverToken(brandId)`를:

```javascript
function getNaverToken(brandId, mallType) {
  const { APP_ID, APP_SECRET, name } = getCredentials(brandId, mallType);
```

(나머지 함수 내부 로직은 그대로.)

- [ ] **Step 4: server 핸들러에서 mallType 추출 + getCredentials/getNaverToken 호출 갱신**

`server/proxy.js:132-188` 의 server.createServer 콜백 영역 수정.

찾기:
```javascript
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const brandId = url.searchParams.get("brandId") || DEFAULT_BRAND_ID;

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", brands: Object.values(BRAND_CREDENTIALS).map((c) => c.name) }));
    return;
  }

  if (!checkAuth(req, res)) return;

  if (url.pathname === "/token") {
    getNaverToken(brandId)
      .then((token) => {
        const creds = getCredentials(brandId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: token, brand: creds.name }));
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      });
    return;
  }

  if (url.pathname === "/orders" && req.method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "from, to 파라미터 필요" }));
      return;
    }
    getNaverToken(brandId)
      .then((token) => {
        const path = `/external/v1/pay-order/seller/product-orders?from=${from.replace(/\+/g, "%2B")}&to=${to.replace(/\+/g, "%2B")}&limitCount=300`;
        forwardToNaver(path, "GET", "", token, res);
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      });
    return;
  }
```

다음으로 교체:

```javascript
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const brandId = url.searchParams.get("brandId");
  const mallType = url.searchParams.get("mallType");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      stores: Object.values(STORE_CRED_ALIAS).map(m => `${m.brandName} ${m.storeName}`),
    }));
    return;
  }

  if (!checkAuth(req, res)) return;

  function handleCredsError(e) {
    const code = e.statusCode || 500;
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }

  if (url.pathname === "/token") {
    if (!brandId || !mallType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "brandId, mallType 파라미터 필요" }));
      return;
    }
    getNaverToken(brandId, mallType)
      .then((token) => {
        const creds = getCredentials(brandId, mallType);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: token, store: creds.name }));
      })
      .catch(handleCredsError);
    return;
  }

  if (url.pathname === "/orders" && req.method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!brandId || !mallType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "brandId, mallType 파라미터 필요" }));
      return;
    }
    if (!from || !to) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "from, to 파라미터 필요" }));
      return;
    }
    getNaverToken(brandId, mallType)
      .then((token) => {
        const path = `/external/v1/pay-order/seller/product-orders?from=${from.replace(/\+/g, "%2B")}&to=${to.replace(/\+/g, "%2B")}&limitCount=300`;
        forwardToNaver(path, "GET", "", token, res);
      })
      .catch(handleCredsError);
    return;
  }
```

(주요 차이: brandId+mallType 둘 다 필수, /health에 stores 배열, error code 분리 — 매핑없음 404, 자격증명없음 503.)

- [ ] **Step 5: 시작 로그 갱신**

`server/proxy.js:190-195`:

기존:
```javascript
server.listen(PORT, HOST, () => {
  console.log(`✅ naver-proxy 실행: http://${HOST}:${PORT}`);
  console.log(`   브랜드: ${Object.values(BRAND_CREDENTIALS).map((c) => c.name).join(", ")}`);
  console.log(`   CORS: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   토큰 검증: ${PROXY_TOKEN ? "활성" : "비활성"}`);
});
```

변경 후:
```javascript
server.listen(PORT, HOST, () => {
  console.log(`✅ naver-proxy 실행: http://${HOST}:${PORT}`);
  const stores = Object.values(STORE_CRED_ALIAS).map(m => {
    const ok = process.env[`${m.alias}_APP_ID`] && process.env[`${m.alias}_APP_SECRET`];
    return `${m.brandName} ${m.storeName}${ok ? "" : " ⚠️미설정"}`;
  });
  console.log(`   stores: ${stores.join(", ")}`);
  console.log(`   CORS: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   토큰 검증: ${PROXY_TOKEN ? "활성" : "비활성"}`);
});
```

- [ ] **Step 6: 검증**

```powershell
node -c server/proxy.js && echo OK
```

Expected: `OK` (Node.js syntax check 통과).

추가:
```powershell
node -e "const code=require('fs').readFileSync('server/proxy.js','utf8');console.log('STORE_CRED_ALIAS:', code.includes('STORE_CRED_ALIAS = {'));console.log('Old BRAND_CREDENTIALS gone:', !code.includes('const BRAND_CREDENTIALS'));console.log('getCredentials(brandId, mallType):', code.includes('function getCredentials(brandId, mallType)'));console.log('mallType param:', code.includes('url.searchParams.get(\"mallType\")'));console.log('도깨비나라 entry:', code.includes('도깨비나라'));"
```

Expected: 모두 `true`.

- [ ] **Step 7: 커밋**

```powershell
git add server/proxy.js
git commit -m @'
refactor(proxy): (brandId, mallType) 튜플로 자격증명 매핑

- BRAND_CREDENTIALS → STORE_CRED_ALIAS (3 stores: 팔레오 브랜드스토어/도깨비나라, 코코엘 스마트스토어)
- getCredentials(brandId, mallType): env에서 <ALIAS>_APP_ID/SECRET 조회
- /orders, /token: brandId + mallType 둘 다 필수 (없으면 400)
- 에러 응답: 매핑없음 404, 자격증명누락 503, 기타 500
- /health 응답: stores 배열
- 시작 로그: 자격증명 미설정 store에 ⚠️미설정 표시

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 6: Backend sync.js — multi-store 지원

**Files:**
- Modify: `server/sync.js` 전체

- [ ] **Step 1: SMARTSTORE_BRAND_IDS → SMARTSTORE_TARGETS**

`server/sync.js:16-19`:

기존:
```javascript
const SMARTSTORE_BRAND_IDS = [
  "fd66b113-548b-44b0-8510-b7f49e302145",
  "0a37b281-f262-4402-979c-e63a739bee53",
];
```

다음으로 교체:

```javascript
const SMARTSTORE_TARGETS = [
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "브랜드스토어", credAlias: "PALEO" },
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "도깨비나라",   credAlias: "DOKEBI" },
  { brandId: "0a37b281-f262-4402-979c-e63a739bee53", mallType: "스마트스토어",  credAlias: "COCOEL" },
];
```

- [ ] **Step 2: syncBrand → syncTarget으로 변경**

`server/sync.js:77-211` 부근의 `syncBrand(brand, startDate, endDate)` 함수 시그니처와 본문을 다음과 같이 수정:

함수 선언 변경:
```javascript
async function syncTarget(target, brand, startDate, endDate) {
  console.log(`\n📦 [${brand.name} ${target.mallType}] ${startDate} ~ ${endDate} 동기화 시작`);
```

(기존 `async function syncBrand(brand, startDate, endDate)` 첫 줄 + `console.log` 메시지 교체)

함수 본문에서 proxy 호출 URL 갱신:

기존 (대략 L95):
```javascript
      const data = await request(`${PROXY_BASE}/orders?brandId=${brand.id}&from=${from}&to=${to}`, { headers: proxyHeaders });
```

다음으로 교체:
```javascript
      const data = await request(`${PROXY_BASE}/orders?brandId=${brand.id}&mallType=${encodeURIComponent(target.mallType)}&from=${from}&to=${to}`, { headers: proxyHeaders });
```

orders.upsert 부분 (대략 L173-189):

기존:
```javascript
    const upsertRows = batch.map((o) => {
      const isCancelled = o.canceled === "T";
      const isNew = o.first_order === "T";
      return {
        brand_id: brand.id,
        mall_type: "스마트스토어",
        order_no: String(o.order_id),
        date: o.order_date,
        total_amount: isCancelled ? o.initial_amount : o.actual_amount,
        original_amount: isCancelled ? o.initial_original : o.actual_original,
        is_cancelled: isCancelled,
        is_new: isNew,
        total_qty: o.items.reduce((s, it) => s + it.quantity, 0) || 1,
        note: "스마트스토어 자동수집",
      };
    });
```

다음으로 교체 (mall_type/note에 target.mallType 사용):
```javascript
    const upsertRows = batch.map((o) => {
      const isCancelled = o.canceled === "T";
      const isNew = o.first_order === "T";
      return {
        brand_id: brand.id,
        mall_type: target.mallType,
        order_no: String(o.order_id),
        date: o.order_date,
        total_amount: isCancelled ? o.initial_amount : o.actual_amount,
        original_amount: isCancelled ? o.initial_original : o.actual_original,
        is_cancelled: isCancelled,
        is_new: isNew,
        total_qty: o.items.reduce((s, it) => s + it.quantity, 0) || 1,
        note: `${target.mallType} 자동수집`,
      };
    });
```

- [ ] **Step 3: 메인 IIFE 변경 — targets 순회**

`server/sync.js:213-253` 부근의 메인 `(async () => { ... })();` 블록 찾기. 특히:

```javascript
  const brands = await getBrands();
  const smartStoreBrands = brands.filter((b) => SMARTSTORE_BRAND_IDS.includes(b.id));

  if (smartStoreBrands.length === 0) {
    console.log("ℹ️  등록된 브랜드가 없습니다.");
    process.exit(0);
  }

  console.log(`🏪 대상 브랜드: ${smartStoreBrands.map((b) => b.name).join(", ")}`);

  for (const brand of smartStoreBrands) {
    try {
      await syncBrand(brand, firstDayOfMonth, endDate);
    } catch (e) {
      console.error(`❌ [${brand.name}] 동기화 오류:`, e.message);
    }
  }
```

다음으로 교체:

```javascript
  const brands = await getBrands();
  const brandsById = Object.fromEntries(brands.map(b => [b.id, b]));

  const validTargets = SMARTSTORE_TARGETS.filter(t => brandsById[t.brandId]);
  if (validTargets.length === 0) {
    console.log("ℹ️  대상 브랜드가 DB에 없습니다.");
    process.exit(0);
  }

  console.log(`🏪 대상 stores: ${validTargets.map(t => `${brandsById[t.brandId].name} ${t.mallType}`).join(", ")}`);

  for (const target of validTargets) {
    const brand = brandsById[target.brandId];
    const credId = process.env[`${target.credAlias}_APP_ID`];
    const credSecret = process.env[`${target.credAlias}_APP_SECRET`];
    if (!credId || !credSecret) {
      console.warn(`⚠️  [${brand.name} ${target.mallType}] ${target.credAlias}_APP_ID/${target.credAlias}_APP_SECRET 미설정 → 동기화 스킵`);
      continue;
    }
    try {
      await syncTarget(target, brand, firstDayOfMonth, endDate);
    } catch (e) {
      console.error(`❌ [${brand.name} ${target.mallType}] 동기화 오류:`, e.message);
    }
  }
```

- [ ] **Step 4: 검증**

```powershell
node -c server/sync.js && echo OK
```

Expected: `OK`.

추가:
```powershell
node -e "const code=require('fs').readFileSync('server/sync.js','utf8');console.log('SMARTSTORE_TARGETS:', code.includes('SMARTSTORE_TARGETS = ['));console.log('No old SMARTSTORE_BRAND_IDS:', !code.includes('SMARTSTORE_BRAND_IDS'));console.log('syncTarget function:', code.includes('async function syncTarget(target, brand, startDate, endDate)'));console.log('credAlias check:', code.includes('process.env[\`\${target.credAlias}_APP_ID\`]'));console.log('Skip warning:', code.includes('미설정 → 동기화 스킵'));"
```

Expected: 모두 `true`.

- [ ] **Step 5: 커밋**

```powershell
git add server/sync.js
git commit -m @'
refactor(sync): SMARTSTORE_TARGETS 배열로 multi-store 지원

- SMARTSTORE_BRAND_IDS → SMARTSTORE_TARGETS (3 entries)
- syncBrand → syncTarget(target, brand, ...)
- proxy 호출 URL에 mallType 포함
- orders.upsert에서 target.mallType 사용 (mall_type/note 동적)
- 자격증명 미설정 store는 경고 로그 + 스킵 (cron 안 깨짐)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 7: README 업데이트

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 환경변수 섹션에 DOKEBI_APP_ID 추가**

`README.md` 의 카페24 서버 .env 섹션 찾기:

```
PALEO_APP_ID / PALEO_APP_SECRET
COCOEL_APP_ID / COCOEL_APP_SECRET
```

다음으로 교체:

```
PALEO_APP_ID / PALEO_APP_SECRET                                # 팔레오 브랜드스토어
COCOEL_APP_ID / COCOEL_APP_SECRET                              # 코코엘 스마트스토어
DOKEBI_APP_ID / DOKEBI_APP_SECRET                              # 팔레오 도깨비나라 (자격증명 받은 후 추가)
```

- [ ] **Step 2: 스마트스토어 연동 섹션 갱신**

`README.md` 의 "### 스마트스토어 연동 (팔레오, 코코엘)" 섹션 찾아 첫 줄을 다음으로 교체:

기존: `### 스마트스토어 연동 (팔레오, 코코엘)`

변경 후:
```markdown
### 스마트스토어 연동 (팔레오 2 stores + 코코엘)

- 팔레오: 브랜드스토어(PALEO_*) + 도깨비나라(DOKEBI_*) — 별도 Naver Commerce 앱 자격증명
- 코코엘: 스마트스토어 (COCOEL_*)
```

이어서 기존 본문 항목 그대로 유지.

자동 동기화 섹션의 다음 줄:
```
- **08:00 KST** — `node sync.js yesterday` (이번달 1일 ~ 전날) — 전일 데이터 마감
- **17:00 KST** — `node sync.js today` (이번달 1일 ~ 당일) — 당일 진행 중 반영
```

직후에 다음 추가:
```
- 각 cron은 SMARTSTORE_TARGETS의 모든 store(브랜드스토어/도깨비나라/코코엘)를 순회. 자격증명(.env) 미설정 store는 경고 후 스킵.
```

- [ ] **Step 3: 변경 이력에 항목 추가**

`README.md` 의 "## 변경 이력" 표 첫 데이터 행 위에 다음 추가 (`2026-05-07`):

```markdown
| 2026-05-07 | 팔레오 스마트스토어 분리: 브랜드스토어 + 도깨비나라 (별도 자격증명 + DB mall_type 마이그레이션) |
| 2026-05-07 | 사이드바 Mall Drawer (브랜드 클릭 시 옆에 mall 선택 패널) |
| 2026-05-07 | 브랜드 우선 네비게이션 재구조 (사이드바 BRANDS, 본문 매출/광고/원가 탭) |
```

(이전 두 작업 미반영 시 함께 추가; 이미 있으면 도깨비나라 줄만 추가.)

- [ ] **Step 4: 검증**

```powershell
node -e "const code=require('fs').readFileSync('README.md','utf8');console.log('DOKEBI env line:', code.includes('DOKEBI_APP_ID / DOKEBI_APP_SECRET'));console.log('팔레오 2 stores:', code.includes('팔레오 2 stores'));console.log('도깨비나라 자동스킵 안내:', code.includes('자격증명(.env) 미설정 store'));console.log('변경이력:', code.includes('도깨비나라'));"
```

Expected: 모두 `true`.

- [ ] **Step 5: 커밋**

```powershell
git add README.md
git commit -m @'
docs: README — 도깨비나라 환경변수, 스마트스토어 2 stores 안내

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 8: 빌드 검증 + DB 마이그레이션 안내 + main에 squash-merge

- [ ] **Step 1: Frontend 프로덕션 빌드**

```powershell
npm run build
```

Expected: `Compiled successfully.` 또는 `Compiled with warnings.` (warnings only — pre-existing).

- [ ] **Step 2: Backend Node.js 구문 점검**

```powershell
node -c server/proxy.js
node -c server/sync.js
```

Expected: 둘 다 무에러 (output 없으면 OK).

- [ ] **Step 3: DB 마이그레이션 SQL 출력 (사용자가 Supabase에서 실행)**

다음 SQL을 사용자에게 안내 (코드 변경 후, 배포 전 실행):

```sql
-- 팔레오의 mall_types 갱신
UPDATE brands
SET mall_types = ARRAY['자사몰', '브랜드스토어', '도깨비나라']
WHERE name = '팔레오';

-- 팔레오의 기존 스마트스토어 주문을 브랜드스토어로 마이그레이션
UPDATE orders
SET mall_type = '브랜드스토어'
WHERE brand_id = (SELECT id FROM brands WHERE name = '팔레오')
  AND mall_type = '스마트스토어';

-- 검증 쿼리 (실행 후 결과 확인용)
SELECT mall_types FROM brands WHERE name = '팔레오';
SELECT mall_type, COUNT(*) FROM orders
WHERE brand_id = (SELECT id FROM brands WHERE name = '팔레오')
GROUP BY mall_type;
```

기대 결과:
- 첫 SELECT: `{자사몰,브랜드스토어,도깨비나라}`
- 둘째 SELECT: `자사몰` 행 + `브랜드스토어` 행 (도깨비나라는 아직 0건)

- [ ] **Step 4: 데스크탑 시나리오 스모크 테스트**

`npm start` 후 (DB 마이그레이션 적용된 dev/staging Supabase 또는 production이라면 마이그레이션 후) 다음 확인:

| 시나리오 | 기대 동작 |
|---------|----------|
| 팔레오 클릭 → drawer | [자사몰 / 브랜드스토어 / 도깨비나라] 3개 표시 |
| 브랜드스토어 클릭 | drawer 닫힘, 본문 헤더 "🟢 팔레오 · 🛍️ 브랜드스토어", 결산조회에 기존 마이그레이션된 주문 표시 |
| 도깨비나라 클릭 | 본문 헤더 "🟢 팔레오 · 🛍️ 도깨비나라" (주황색), 결산조회 비어있음 (정상 — 아직 동기화 전) |
| 도깨비나라 → 🔗 클릭 | 모달 헤더 "🛍️ 도깨비나라 동기화 — 팔레오", 매핑 등록됨 표시 |
| 코코엘 → drawer | [자사몰 / 스마트스토어] 2개 (그대로) |
| 결산조회 매출 요약 | 도깨비나라/브랜드스토어/스마트스토어에서 "스토어 결제금액", 자사몰에서 "자사몰 결제금액" |

- [ ] **Step 5: 카페24 서버 배포 안내 작성**

(별도 안내 — main 머지 + 사용자 push 후, 카페24 서버에서 실행할 명령)

```bash
# 카페24 서버에서 실행
ssh root@203.245.41.105
cd /root/naver-proxy
git pull origin main
# .env 편집해서 DOKEBI_APP_ID/SECRET 추가 (자격증명 받았으면)
pm2 restart naver-proxy
pm2 logs naver-proxy --lines 20  # 시작 로그에서 stores 목록 확인
```

이 안내는 사용자에게 보고만 하면 됨 (이번 task에서 실행하지 않음).

- [ ] **Step 6: main에 squash-merge**

```powershell
git checkout main
git merge --squash feature/paleo-dual-smartstore
git commit -m @'
feat: 팔레오 스마트스토어 2개 분리 (브랜드스토어 + 도깨비나라)

mall_type을 실제 스토어 이름으로 사용하는 모델로 전환.
팔레오는 브랜드스토어/도깨비나라 2개 SmartStore를 별도 자격증명으로 동기화.

- Frontend: MALL_TYPE_COLORS 확장, smartStoreMallType state, =="스마트스토어" 비교 일반화
- syncSmartStoreOrders에 mallType 파라미터 추가, proxy URL/upsert에 사용
- SmartStore 모달이 mallType별로 표시
- proxy.js: BRAND_CREDENTIALS → STORE_CRED_ALIAS ((brandId, mallType) 튜플)
  에러 응답 정책: 매핑없음 404, 자격증명누락 503
- sync.js: SMARTSTORE_BRAND_IDS → SMARTSTORE_TARGETS (3 stores)
  자격증명 미설정 store는 경고+스킵 (cron 안전)
- README: DOKEBI_APP_ID/SECRET 안내, 스마트스토어 섹션 갱신, 변경이력 추가

DB 마이그레이션 (Supabase SQL Editor 1회 실행):
- brands.mall_types: 팔레오 → [자사몰, 브랜드스토어, 도깨비나라]
- orders.mall_type: 팔레오 스마트스토어 → 브랜드스토어 일괄 변경

카페24 서버 별도 배포:
- git pull + .env에 DOKEBI_APP_ID/SECRET 추가 + pm2 restart naver-proxy

Spec: docs/superpowers/specs/2026-05-07-paleo-dual-smartstore-design.md
Plan: docs/superpowers/plans/2026-05-07-paleo-dual-smartstore.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

- [ ] **Step 7: feature branch 삭제**

```powershell
git branch -D feature/paleo-dual-smartstore
```

- [ ] **Step 8: 사용자에게 배포 절차 보고**

배포 단계 안내:

1. **Supabase SQL Editor** — Step 3의 SQL 실행 (먼저)
2. **GitHub push** — `git push` (Vercel 자동배포)
3. **카페24 서버** — Step 5의 명령
4. **로컬 확인** — Step 4의 시나리오 점검

(사용자 승인 후 실제 push.)
