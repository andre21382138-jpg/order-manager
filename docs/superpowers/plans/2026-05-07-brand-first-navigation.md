# 브랜드 우선 네비게이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이드바 최상위 메뉴를 `[원가/광고/결산]`에서 브랜드 목록으로 전환하고, 본문에서 `[자사몰 | 스마트스토어]` → `[매출 | 광고 | 원가]` 위계로 재배치한다.

**Architecture:** 모놀리식 `src/App.js` 단일 파일에서 상태 모델(`tab`/`subTab` → `currentBrandId`/`currentMallType`/`mainTab`/`salesSubTab`)과 렌더 로직을 재배치. 백엔드/Supabase 스키마 변경 없음. 기존 `filter`/`pendingFilter`는 새 상태와 자동 동기화하여 결산조회 등 기존 비즈니스 로직 재사용.

**Tech Stack:** React 19 (CRA) + 인라인 스타일 + Supabase. 테스트 인프라가 사실상 부재(default CRA 자리만 있음)하므로 본 계획은 **수동 브라우저 검증** 기반.

**Spec:** `docs/superpowers/specs/2026-05-07-brand-first-navigation-design.md`

**Vercel 자동배포 고려**: 모든 단계는 `main` 브랜치 단일 커밋으로 마무리한다. 중간 단계 커밋은 만들지 않는다 (브로큰 deploy 방지).

---

## 변경 대상 파일

- `src/App.js` (단일)

## 진행 전 확인

- [ ] **Step 0-1: working tree clean 확인**

```powershell
git status
```
Expected: `nothing to commit, working tree clean`

- [ ] **Step 0-2: 개발서버 가능한지 확인 (선택)**

```powershell
npm start
```
브라우저가 자동으로 열리고 기존 UI(`[원가/광고/결산]` 사이드바)가 정상 표시되어야 한다. 확인 후 Ctrl+C로 종료해도 되고 켜둔 채 진행해도 된다 (Hot reload 활용).

---

### Task 1: 상태 모델 마이그레이션 + 자동 동기화 effect

**Files:**
- Modify: `src/App.js:244-245` (state declarations)
- Modify: `src/App.js:309-310` (sidebar state)
- Modify: `src/App.js:983` (toggleBrandExpand 함수)
- Add: useEffect 두 개

- [ ] **Step 1: 기존 `tab`/`subTab` state를 새 state로 교체**

`src/App.js:244-245`를 다음으로 교체:

```javascript
  const [currentBrandId, setCurrentBrandId] = useState(null);
  const [currentMallType, setCurrentMallType] = useState("자사몰");
  const [mainTab, setMainTab] = useState("매출");
  const [salesSubTab, setSalesSubTab] = useState("결산조회");
```

- [ ] **Step 2: `expandedBrandIds` state 제거**

`src/App.js:310` 의 다음 줄 삭제:

```javascript
  const [expandedBrandIds, setExpandedBrandIds] = useState(new Set());
```

- [ ] **Step 3: `toggleBrandExpand` 함수 제거**

`src/App.js:983` 부근에 있는 `function toggleBrandExpand(brandId) { ... }` 전체 삭제. (이후 호출부도 함께 삭제될 예정)

- [ ] **Step 4: `currentBrand` 헬퍼 추가**

`src/App.js:530` 의 `visibleBrands` 선언 바로 아래에 다음 추가:

```javascript
  const currentBrand = getBrand(currentBrandId);
  const isCurrentMallSupported = currentBrand?.mallTypes?.includes(currentMallType) ?? false;
```

- [ ] **Step 5: 자동 첫 브랜드 선택 effect 추가 (stale 검사 포함)**

`src/App.js:530` (visibleBrands 선언) 직후에 다음 추가. stale 검사 포함 (예: admin이 부서 필터를 바꿔서 visibleBrands가 줄어들면 currentBrandId가 더 이상 유효하지 않을 수 있음):

```javascript
  useEffect(() => {
    if (visibleBrands.length === 0) {
      if (currentBrandId !== null) setCurrentBrandId(null);
      return;
    }
    const inList = visibleBrands.some(b => b.id === currentBrandId);
    if (!currentBrandId || !inList) {
      setCurrentBrandId(visibleBrands[0].id);
    }
  }, [currentBrandId, visibleBrands]);
```

- [ ] **Step 6: filter 동기화 effect 추가**

Step 5 effect 바로 아래에 다음 추가:

```javascript
  useEffect(() => {
    if (!currentBrandId) return;
    setFilter(f => ({ ...f, brandId: currentBrandId, mallType: currentMallType, category: "" }));
    setPendingFilter(f => ({ ...f, brandId: currentBrandId, mallType: currentMallType, category: "" }));
  }, [currentBrandId, currentMallType]);
```

- [ ] **Step 7: 컴파일 확인**

```powershell
npm start
```

브라우저에서 콘솔 에러가 없어야 한다. 기존 사이드바의 `[원가/광고/결산]` 버튼은 `setTab is not defined` 에러를 던질 것이지만 (제거 예정), Task 2에서 처리. 이 단계에선 사이드바 상단 탭만 안 눌러보면 됨. 다른 페이지 인터랙션도 일단 정상.

브라우저 콘솔에 React가 에러를 표시하면 Task 1 코드를 다시 확인.

---

### Task 2: 사이드바 상단 탭 제거 + BRANDS 단순화

**Files:**
- Modify: `src/App.js:1002-1010` (상단 탭 블록)
- Modify: `src/App.js:1032-1098` (BRANDS 렌더링)

- [ ] **Step 1: 상단 [원가/광고/결산] 버튼 블록 제거**

`src/App.js:1002-1010` 의 다음 블록 전체 제거:

```javascript
      {/* 탭 */}
      <div style={{ padding:"8px 6px", borderBottom:"1px solid #334155", flexShrink:0 }}>
        {[["원가","💰"],["광고","📣"],["결산","📊"]].map(([t,icon]) => (
          <button key={t} onClick={()=>{setTab(t);setSubTab(t==="원가"?"원가조회":t==="광고"?"광고현황조회":"결산조회");}} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:sidebarOpen?"9px 10px":"9px 0", justifyContent:sidebarOpen?"flex-start":"center", borderRadius:8, border:"none", cursor:"pointer", background:tab===t?"#3B82F6":"transparent", color:tab===t?"white":"#94A3B8", fontSize:13, fontWeight:700, marginBottom:2, whiteSpace:"nowrap" }}>
            <span style={{ fontSize:15, flexShrink:0 }}>{icon}</span>
            {sidebarOpen && t}
          </button>
        ))}
      </div>
```

- [ ] **Step 2: BRANDS 섹션 — 브랜드 행 클릭 동작 변경 + 펼치기 제거**

`src/App.js:1035-1092` 의 `visibleBrands.map(b => { ... })` 전체를 다음으로 교체:

```javascript
        {visibleBrands.map(b => {
          const isActive = currentBrandId === b.id;
          const hasToken = !!cafe24Tokens[b.id];
          return (
            <div key={b.id} style={{ marginBottom:2 }}>
              <button
                onClick={() => sidebarOpen && setCurrentBrandId(b.id)}
                style={{
                  width:"100%",
                  padding:sidebarOpen?"7px 8px":"8px 0",
                  borderRadius:8,
                  border:isActive&&sidebarOpen?`1px solid ${b.color}40`:"1px solid transparent",
                  cursor:"pointer",
                  background:isActive&&sidebarOpen?b.color+"15":"transparent",
                  display:"flex",
                  alignItems:"center",
                  gap:6,
                  justifyContent:sidebarOpen?"flex-start":"center",
                }}
              >
                <div style={{ width:8, height:8, borderRadius:"50%", background:b.color, flexShrink:0 }} />
                {sidebarOpen && (
                  <>
                    <div style={{ flex:1, textAlign:"left", overflow:"hidden" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:isActive?b.color:"#CBD5E1", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        {b.name}
                        {hasToken && <span style={{ marginLeft:4, fontSize:9, background:"#D1FAE5", color:"#065F46", padding:"1px 4px", borderRadius:6 }}>✅</span>}
                      </div>
                      {b.department && <div style={{ fontSize:10, color:"#475569" }}>{b.department}</div>}
                    </div>
                    <div style={{ display:"flex", gap:3, flexShrink:0, alignItems:"center" }}>
                      <button onClick={e=>{e.stopPropagation();setEditingBrand(b);}} style={{ background:"none", border:"none", cursor:"pointer", color:"#475569", fontSize:10, padding:"2px 3px", borderRadius:4 }} title="편집">✏️</button>
                      <button onClick={e=>{e.stopPropagation();deleteBrand(b.id);}} style={{ background:"none", border:"none", cursor:"pointer", color:"#475569", fontSize:10, padding:"2px 3px", borderRadius:4 }} title="삭제">🗑️</button>
                    </div>
                  </>
                )}
              </button>
            </div>
          );
        })}
```

(차이: 클릭 시 `setCurrentBrandId(b.id)` 호출, 펼치기 시 mall 서브 버튼 블록(L1062-1089) 전체 제거, 🔗 동기화 버튼은 본문으로 이전)

- [ ] **Step 3: 컴파일 확인 (사이드바)**

`npm start` 가 켜져 있다면 자동 reload. 사이드바에서:
- `[원가/광고/결산]` 버튼이 사라졌는지
- 브랜드 클릭 시 `currentBrandId` 가 갱신되는지 (브랜드 행이 강조 표시되는지로 확인)

본문은 아직 옛 구조(`tab="결산"`)라 동작 안 하지만, Task 3-4에서 처리.

---

### Task 3: 본문 헤더 (브랜드명 + Mall 탭 + Main 탭 + 매출 SubTab)

**Files:**
- Modify: `src/App.js:1176-1188` (스크롤 영역 시작 + 기존 subtab 바)

- [ ] **Step 1: 새 본문 헤더와 탭 바 작성**

`src/App.js:1178-1188` 의 다음 블록을 찾아:

```javascript
          {/* 서브탭 바 */}
          {(()=>{
            const subTabs = tab==="원가"?["원가입력","원가조회"]:tab==="광고"?["광고입력","광고현황조회"]:["주문입력","주문조회","결산조회"];
            return (
              <div style={{ display:"flex", gap:4, marginBottom:14, background:"white", borderRadius:12, padding:"6px", boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                {subTabs.map(s=>(
                  <button key={s} onClick={()=>setSubTab(s)} style={{ flex:1, padding:"8px 12px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:subTab===s?700:500, background:subTab===s?"#3B82F6":"transparent", color:subTab===s?"white":"#64748B" }}>{s}</button>
                ))}
              </div>
            );
          })()}
```

다음으로 교체:

```javascript
          {/* 브랜드 헤더 + Mall 탭 + Main 탭 */}
          {!currentBrand ? (
            <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", textAlign:"center", color:"#94A3B8", fontSize:13 }}>
              조회 권한이 있는 브랜드가 없습니다.
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <div style={{ width:14, height:14, borderRadius:"50%", background:currentBrand.color, flexShrink:0 }} />
                <div style={{ fontSize:18, fontWeight:800, color:"#1E293B" }}>{currentBrand.name}</div>
                {currentBrand.department && <div style={{ fontSize:12, color:"#94A3B8" }}>{currentBrand.department}</div>}
              </div>

              {/* Mall 탭 */}
              <div style={{ display:"flex", gap:6, marginBottom:8, background:"white", borderRadius:12, padding:"6px", boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                {MALL_TYPES.map(t => {
                  const active = currentMallType === t;
                  return (
                    <div key={t} style={{ flex:1, display:"flex", gap:4, alignItems:"center" }}>
                      <button
                        onClick={() => setCurrentMallType(t)}
                        style={{
                          flex:1,
                          padding:"9px 12px",
                          borderRadius:8,
                          border:"none",
                          cursor:"pointer",
                          fontSize:13,
                          fontWeight:active?700:500,
                          background:active?MALL_TYPE_COLORS[t]:"transparent",
                          color:active?"white":"#64748B",
                          textAlign:"center",
                        }}
                      >
                        {t==="자사몰"?"🏪":"🛍️"} {t}
                      </button>
                      <button
                        onClick={() => {
                          if (t === "스마트스토어") {
                            setSmartStoreBrand(currentBrand); setSmartStoreSyncResult(""); setShowSmartstoreModal(true);
                          } else {
                            setCafe24Brand(currentBrand); setCafe24MallId(cafe24Tokens[currentBrand.id]?.mall_id||""); setCafe24SyncResult(""); setShowCafe24Modal(true);
                          }
                        }}
                        title={t==="스마트스토어"?"스마트스토어 동기화":"카페24 연동"}
                        style={{ padding:"6px 8px", borderRadius:6, border:"1px solid #E2E8F0", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:11, fontWeight:600 }}
                      >🔗</button>
                    </div>
                  );
                })}
              </div>

              {/* Main 탭 */}
              <div style={{ display:"flex", gap:4, marginBottom:14, background:"white", borderRadius:12, padding:"6px", boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                {[["매출","💰"],["광고","📣"],["원가","📊"]].map(([t,icon]) => {
                  const active = mainTab === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setMainTab(t)}
                      style={{
                        flex:1,
                        padding:"8px 12px",
                        borderRadius:8,
                        border:"none",
                        cursor:"pointer",
                        fontSize:13,
                        fontWeight:active?700:500,
                        background:active?"#3B82F6":"transparent",
                        color:active?"white":"#64748B",
                      }}
                    >
                      {icon} {t}
                    </button>
                  );
                })}
              </div>

              {/* 매출 서브탭 (매출 선택시만) */}
              {mainTab === "매출" && isCurrentMallSupported && (
                <div style={{ display:"flex", gap:4, marginBottom:14, background:"white", borderRadius:12, padding:"6px", boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                  {["주문입력","주문조회","결산조회"].map(s => {
                    const active = salesSubTab === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setSalesSubTab(s)}
                        style={{
                          flex:1,
                          padding:"8px 12px",
                          borderRadius:8,
                          border:"none",
                          cursor:"pointer",
                          fontSize:13,
                          fontWeight:active?700:500,
                          background:active?"#3B82F6":"transparent",
                          color:active?"white":"#64748B",
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
```

- [ ] **Step 2: 컴파일 확인**

`npm start` reload 후:
- 본문 상단에 브랜드명, Mall 탭, Main 탭이 표시되는지
- Mall 탭 클릭 시 강조 변경
- Main 탭 클릭 시 강조 변경
- "매출" 메인탭일 때만 서브탭 [주문입력 | 주문조회 | 결산조회] 노출

기존 본문 콘텐츠(주문입력 폼 등)는 아직 `tab==="결산"` 조건에 묶여있어 안 보일 것임 (다음 Task에서 처리).

---

### Task 4: 본문 콘텐츠 라우팅 — 새 state로 매핑 + 미연동 placeholder

**Files:**
- Modify: `src/App.js:1190-1216` (원가/광고 placeholder)
- Modify: `src/App.js:1218-1302` (주문입력)
- Modify: `src/App.js:1304-1374` (조회/결산 공통 필터)
- Modify: `src/App.js:1376-1585` (주문조회 + 결산조회)

- [ ] **Step 1: 미연동 mall placeholder 추가**

새 본문 헤더 블록 끝 (Task 3에서 추가한 `</> )` 직후, 기존 `{/* ── 원가 탭 ── */}` 주석 직전에 다음 추가:

```javascript
          {currentBrand && !isCurrentMallSupported && (
            <div style={{ background:"white", borderRadius:14, padding:32, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:10 }}>{currentMallType==="자사몰"?"🏪":"🛍️"}</div>
              <div style={{ fontSize:15, fontWeight:700, color:"#1E293B", marginBottom:6 }}>{currentBrand.name} {currentMallType}는 아직 연동되지 않았습니다.</div>
              <div style={{ fontSize:13, color:"#94A3B8" }}>(준비 중)</div>
            </div>
          )}
```

- [ ] **Step 2: 원가 탭 조건 변경**

`src/App.js:1191` 의 `{tab==="원가" && subTab==="원가입력" && (` 를 다음으로 교체:

```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="원가" && (
```

이 블록은 원래 두 개(원가입력/원가조회)였는데, 새 구조에서는 원가 = 단일 placeholder. 기존 두 placeholder를 하나로 통합:

`src/App.js:1191-1202` 두 블록 전체를 다음 한 블록으로 교체:

```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="원가" && (
            <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#1E293B", marginBottom:16 }}>📊 원가</div>
              <div style={{ color:"#94A3B8", fontSize:13 }}>{currentBrand.name} {currentMallType} 원가 기능은 준비 중입니다.</div>
            </div>
          )}
```

- [ ] **Step 3: 광고 탭 조건 변경**

마찬가지로 `src/App.js:1205-1216` 두 블록(광고입력/광고현황조회) 을 다음 하나로 교체:

```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="광고" && (
            <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize:15, fontWeight:700, color:"#1E293B", marginBottom:16 }}>📣 광고</div>
              <div style={{ color:"#94A3B8", fontSize:13 }}>{currentBrand.name} {currentMallType} 광고 기능은 준비 중입니다.</div>
            </div>
          )}
```

- [ ] **Step 4: 주문입력 (매출 → 주문입력) 조건 변경**

`src/App.js:1219` 의:

```javascript
          {tab==="결산" && subTab==="주문입력" && (
```

다음으로 교체:

```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="주문입력" && (
```

- [ ] **Step 5: 주문조회/결산조회 공통 필터 조건 변경**

`src/App.js:1305` 의:

```javascript
          {tab==="결산" && (subTab==="주문조회"||subTab==="결산조회") && (
```

다음으로 교체:

```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && (salesSubTab==="주문조회"||salesSubTab==="결산조회") && (
```

- [ ] **Step 6: 주문조회 조건 변경**

`src/App.js:1376` 의:

```javascript
          {tab==="결산" && subTab==="주문조회" && (
```

다음으로 교체:

```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="주문조회" && (
```

- [ ] **Step 7: 결산조회 조건 변경**

`src/App.js:1383` 의 `{tab==="결산" && subTab==="결산조회" && (` 를 다음으로 교체:

```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="결산조회" && (
```

- [ ] **Step 8: 컴파일 확인 + 시나리오 검증**

`npm start` reload 후:
- 팔레오(자사몰) → 매출 → 결산조회: 매출 요약 카드 정상 노출
- 매출 → 주문입력: 폼 정상 (기존 STEP1/STEP2 카드는 그대로)
- 매출 → 주문조회: 주문 리스트 정상
- 광고 / 원가: placeholder 표시
- 팔레오 스마트스토어: 매출/광고/원가 모두 데이터 정상 (스마트스토어 연동되어 있음)
- 아프리모 → 스마트스토어: "준비 중" placeholder 노출
- 코코엘 → 자사몰 → 매출: 정상

---

### Task 5: 결산 필터 UI에서 브랜드/쇼핑몰 셀렉터 제거

**Files:**
- Modify: `src/App.js:1320-1343` (브랜드 선택 + 쇼핑몰 유형 선택 카드)

- [ ] **Step 1: 브랜드 + 쇼핑몰 셀렉터 블록 제거**

`src/App.js:1320-1343` 의 다음 블록 전체 제거 (외부 탭에서 결정되므로 본문 내 중복 UI):

```javascript
              <div style={{ background:"white", borderRadius:14, padding:"14px 18px", marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#64748B", marginBottom:10 }}>🏷️ 브랜드 선택</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button onClick={()=>{setFilter(f=>({...f,brandId:"",mallType:"",category:""}));setPendingFilter(f=>({...f,brandId:"",mallType:"",category:""}));}} style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", padding:"10px 16px", borderRadius:12, cursor:"pointer", minWidth:80, border:filter.brandId===""?"2px solid #1E293B":"2px solid #E2E8F0", background:filter.brandId===""?"#1E293B10":"white" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}><div style={{ width:8, height:8, borderRadius:"50%", background:"#64748B" }} /><span style={{ fontSize:14, fontWeight:700, color:filter.brandId===""?"#1E293B":"#64748B" }}>전체</span></div>
                    <span style={{ fontSize:11, color:"#94A3B8" }}>{orders.filter(o=>o.date>=filter.from&&o.date<=filter.to).length}건</span>
                  </button>
                  {visibleBrands.map(b => { const isActive=pendingFilter.brandId===b.id; const cnt=orders.filter(o=>o.brandId===b.id&&o.date>=filter.from&&o.date<=filter.to).length; return (
                    <button key={b.id} onClick={()=>setPendingFilter(f=>({...f,brandId:isActive?"":b.id,mallType:"",category:""}))} style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", padding:"10px 16px", borderRadius:12, cursor:"pointer", minWidth:80, border:isActive?`2px solid ${b.color}`:"2px solid #E2E8F0", background:isActive?b.color+"12":"white" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}><div style={{ width:8, height:8, borderRadius:"50%", background:b.color }} /><span style={{ fontSize:14, fontWeight:700, color:isActive?b.color:"#1E293B" }}>{b.name}</span></div>
                      <span style={{ fontSize:11, color:"#94A3B8" }}>{cnt}건</span>
                    </button>
                  ); })}
                </div>
                {pendingFilter.brandId && (
                  <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #F1F5F9" }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", marginBottom:8 }}>쇼핑몰 유형</div>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>setPendingFilter(f=>({...f,mallType:""}))} style={{ padding:"6px 16px", borderRadius:20, cursor:"pointer", fontSize:13, fontWeight:700, border:pendingFilter.mallType===""?"2px solid #1E293B":"2px solid #E2E8F0", background:pendingFilter.mallType===""?"#1E293B":"white", color:pendingFilter.mallType===""?"white":"#64748B" }}>전체 합산</button>
                      {MALL_TYPES.map(t => { const isActive=pendingFilter.mallType===t; const cnt=orders.filter(o=>o.brandId===pendingFilter.brandId&&o.mallType===t&&o.date>=filter.from&&o.date<=filter.to).length; return <button key={t} onClick={()=>setPendingFilter(f=>({...f,mallType:isActive?"":t}))} style={{ padding:"6px 16px", borderRadius:20, cursor:"pointer", fontSize:13, fontWeight:700, border:isActive?`2px solid ${MALL_TYPE_COLORS[t]}`:"2px solid #E2E8F0", background:isActive?MALL_TYPE_COLORS[t]:"white", color:isActive?"white":"#64748B" }}>{t==="자사몰"?"🏪":"🛍️"} {t} ({cnt}건)</button>; })}
                    </div>
                  </div>
                )}
              </div>
```

이제 결산조회/주문조회의 본문 필터 영역에는 (1) 부서 선택(canAccessAll만) (2) 날짜+카테고리 필터만 남는다.

- [ ] **Step 2: 부서 선택 클릭 시 currentBrandId 영향 검토**

`src/App.js:1313-1314` 의 부서 버튼 onClick 은 `setFilter(f=>({...f,dept:d,brandId:""}))` 처럼 brandId를 빈 문자열로 리셋한다. 이게 사이드바의 `currentBrandId` 와 충돌할 수 있다.

다음과 같이 수정 (부서 변경 시 currentBrandId도 같이 갱신):

`src/App.js:1313` 부터 14번까지 두 줄을 다음으로 교체:

```javascript
                      <button onClick={()=>{setFilter(f=>({...f,dept:""}));setPendingFilter(f=>({...f,dept:""}));}} style={{ padding:"7px 16px", borderRadius:20, cursor:"pointer", fontWeight:700, fontSize:13, border:filter.dept===""?"2px solid #1E293B":"2px solid #E2E8F0", background:filter.dept===""?"#1E293B10":"white", color:filter.dept===""?"#1E293B":"#64748B" }}>전체</button>
                      {depts.map(d=><button key={d} onClick={()=>{setFilter(f=>({...f,dept:d}));setPendingFilter(f=>({...f,dept:d}));}} style={{ padding:"7px 16px", borderRadius:20, cursor:"pointer", fontWeight:700, fontSize:13, border:filter.dept===d?"2px solid #3B82F6":"2px solid #E2E8F0", background:filter.dept===d?"#EFF6FF":"white", color:filter.dept===d?"#3B82F6":"#64748B" }}>{d}</button>)}
```

(차이: brandId 리셋 코드 제거, pendingFilter.dept 도 동기화. brandId 는 사이드바 currentBrandId 에서 관리.)

- [ ] **Step 3: 컴파일 확인**

`npm start` reload 후 매출 → 주문조회/결산조회 진입:
- 본문 위쪽에 "🏢 부서 선택" 카드 (admin/director만)
- 본문 위쪽에 "🏷️ 브랜드 선택" 카드 → **사라졌어야 함**
- 날짜/카테고리 필터 카드는 그대로
- 결산 결과는 currentBrandId + currentMallType 기준으로 표시

---

### Task 6: 모바일 하단 네비게이션 갱신

**Files:**
- Modify: `src/App.js:1589-1600`

- [ ] **Step 1: 모바일 하단 네비 라벨/동작 변경**

`src/App.js:1589-1600` 의 다음 블록을 찾아:

```javascript
      {/* 모바일 하단 탭바 */}
      {isMobile && (
        <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"white", borderTop:"1px solid #E2E8F0", display:"flex", zIndex:100, boxShadow:"0 -2px 10px rgba(0,0,0,0.08)" }}>
          {[["원가","💰"],["광고","📣"],["결산","📊"]].map(([t,icon])=>(
            <button key={t} onClick={()=>{setTab(t);setSubTab(t==="원가"?"원가조회":t==="광고"?"광고현황조회":"결산조회");}} style={{ flex:1, padding:"10px 0", border:"none", cursor:"pointer", background:"transparent", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
              <span style={{ fontSize:20 }}>{icon}</span>
              <span style={{ fontSize:11, fontWeight:700, color:tab===t?"#3B82F6":"#94A3B8" }}>{t}</span>
              {tab===t && <div style={{ width:20, height:2, background:"#3B82F6", borderRadius:2 }} />}
            </button>
          ))}
        </div>
      )}
```

다음으로 교체:

```javascript
      {/* 모바일 하단 탭바 */}
      {isMobile && (
        <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"white", borderTop:"1px solid #E2E8F0", display:"flex", zIndex:100, boxShadow:"0 -2px 10px rgba(0,0,0,0.08)" }}>
          {[["매출","💰"],["광고","📣"],["원가","📊"]].map(([t,icon])=>(
            <button key={t} onClick={()=>{ setMainTab(t); if(t==="매출") setSalesSubTab("결산조회"); }} style={{ flex:1, padding:"10px 0", border:"none", cursor:"pointer", background:"transparent", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
              <span style={{ fontSize:20 }}>{icon}</span>
              <span style={{ fontSize:11, fontWeight:700, color:mainTab===t?"#3B82F6":"#94A3B8" }}>{t}</span>
              {mainTab===t && <div style={{ width:20, height:2, background:"#3B82F6", borderRadius:2 }} />}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 2: 컴파일 확인**

브라우저 dev tools 에서 모바일 뷰 토글 (또는 창 크기를 768px 이하로). 하단 네비가 [매출/광고/원가] 로 변경. 클릭 시 본문 갱신.

---

### Task 7: 빌드 검증 + 단일 커밋

- [ ] **Step 1: production 빌드**

```powershell
npm run build
```
Expected: `Compiled successfully.` 출력. 경고는 OK, 에러는 안 됨.

- [ ] **Step 2: 데스크탑 시나리오 스모크 테스트**

`npm start` 켜고 다음 시나리오 모두 직접 클릭하며 확인:

| 시나리오 | 기대 동작 |
|---------|----------|
| 로그인 직후 | 첫 허용 브랜드 자동 선택, 매출 → 결산조회 표시 |
| 사이드바 [팔레오] 클릭 | 본문 헤더 "팔레오"로 변경, Mall/Main 탭 컨텍스트 유지 |
| Mall: 자사몰 → 스마트스토어 | 본문 데이터 즉시 갱신 |
| Main: 매출 → 광고 | 광고 placeholder 노출 |
| Main: 매출 → 원가 | 원가 placeholder 노출 |
| Sales 서브: 결산조회 → 주문입력 | 주문 입력 폼 노출 |
| Sales 서브: 주문입력 → 주문조회 | 주문 리스트 노출 |
| [아프리모] → 스마트스토어 | "아프리모 스마트스토어는 아직 연동되지 않았습니다 (준비 중)" |
| [코코엘] → 자사몰 → 매출 → 결산조회 | 결산 카드 정상 |
| 부서 필터 (admin/director) | 부서 선택 동작 정상 |
| 결산조회 본문 내 브랜드 선택 카드 | **존재하지 않아야 함** |
| 사이드바 ✏️/🗑️ | 편집/삭제 모달 정상 |
| Mall 탭 옆 🔗 | 카페24/스마트스토어 동기화 모달 정상 |
| 공지사항/상품소개서/유튜브협찬/팝업관리/보안 | 사이드바 클릭 시 기존 모달/페이지 정상 |

- [ ] **Step 3: 모바일 시나리오 스모크 테스트**

브라우저 dev tools 모바일 뷰 (예: iPhone 14):

| 시나리오 | 기대 동작 |
|---------|----------|
| 햄버거 메뉴 → 사이드바 노출 | 브랜드 목록 표시 |
| 사이드바에서 브랜드 클릭 | currentBrandId 갱신 |
| 본문 상단 Mall 탭 | 자사몰/스마트스토어 토글 |
| 하단 [매출/광고/원가] | mainTab 갱신 |

- [ ] **Step 4: console error 점검**

브라우저 콘솔에 React warning/error 없는지 확인. 있으면 수정 후 다시 빌드.

- [ ] **Step 5: 단일 커밋**

```powershell
git add src/App.js docs/superpowers/plans/2026-05-07-brand-first-navigation.md
git commit -m "feat: 브랜드 우선 네비게이션 재구조

최상위 메뉴를 [원가/광고/결산]에서 브랜드 목록으로 전환하고
본문에서 [자사몰|스마트스토어] -> [매출|광고|원가] 탭 위계로 재배치.

- 사이드바: 최상위 탭 버튼 제거, BRANDS는 단일 클릭 선택
- 본문: 브랜드 헤더 + Mall 탭 + Main 탭 + 매출 서브탭 추가
- 결산조회 본문 내 브랜드/쇼핑몰 셀렉터 제거 (외부 탭이 단일 source)
- 미연동 쇼핑몰: '준비 중' placeholder
- 모바일 하단 네비: [매출/광고/원가]
- state: tab/subTab/expandedBrandIds 제거, currentBrandId/currentMallType/mainTab/salesSubTab 추가

Spec: docs/superpowers/specs/2026-05-07-brand-first-navigation-design.md"
```

- [ ] **Step 6: push (사용자 승인 후)**

```powershell
git push
```

(Vercel이 자동 배포한다. 사용자에게 push 여부 명시적으로 확인.)
