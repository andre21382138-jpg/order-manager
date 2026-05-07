# 사이드바 Mall Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이드바 브랜드 클릭 시 옆에 mall 선택 drawer가 뜨고, mall 클릭 후 drawer가 닫히며 본문이 풀 너비로 표시되는 단계적 흐름 구현.

**Architecture:** 새 state `mallDrawerBrandId` 도입으로 drawer 표시 제어. 기존 본문의 Mall 탭 행 제거하고 brand+mall 텍스트로 대체. 데스크탑에선 사이드바와 본문 사이에 패널, 모바일에선 fullscreen modal로 분기.

**Tech Stack:** React 19 (CRA) + 인라인 스타일 + Supabase. UI 변경만, 백엔드/스키마 손대지 않음.

**Spec:** `docs/superpowers/specs/2026-05-07-sidebar-mall-drawer-design.md`

**Vercel 자동배포 고려**: 모든 단계는 main 브랜치 단일 커밋으로 마무리한다. 중간 단계 커밋은 만들지 않고, 작업은 `feature/sidebar-mall-drawer` 브랜치에서 task별 커밋 후 마지막에 squash-merge.

---

## 변경 대상 파일

- `src/App.js` (단일)

## 진행 전 확인

- [ ] **Step 0-1: working tree clean 확인**

```powershell
git status
```
Expected: `nothing to commit, working tree clean`. main이 origin보다 3 commits 앞 (이전 작업 + spec, 이번 신규 spec) — 정상.

- [ ] **Step 0-2: feature branch 생성**

```powershell
git checkout -b feature/sidebar-mall-drawer
```

---

### Task 1: State 도입 + auto-select effect 갱신

**Files:**
- Modify: `src/App.js:244-247` (state declarations)
- Modify: `src/App.js:539-548` (auto-select useEffect)

- [ ] **Step 1: `mallDrawerBrandId` state 추가**

`src/App.js:244-247` 의 4개 state 선언 직후에 한 줄 추가:

기존:
```javascript
  const [currentBrandId, setCurrentBrandId] = useState(null);
  const [currentMallType, setCurrentMallType] = useState("자사몰");
  const [mainTab, setMainTab] = useState("매출");
  const [salesSubTab, setSalesSubTab] = useState("결산조회");
```

변경 후:
```javascript
  const [currentBrandId, setCurrentBrandId] = useState(null);
  const [currentMallType, setCurrentMallType] = useState("자사몰");
  const [mainTab, setMainTab] = useState("매출");
  const [salesSubTab, setSalesSubTab] = useState("결산조회");
  const [mallDrawerBrandId, setMallDrawerBrandId] = useState(null);
```

- [ ] **Step 2: 자동 첫 브랜드 선택 effect — drawer 동시 오픈**

`src/App.js:539-548` 의 useEffect를 다음으로 교체:

기존:
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

변경 후:
```javascript
  useEffect(() => {
    if (visibleBrands.length === 0) {
      if (currentBrandId !== null) setCurrentBrandId(null);
      if (mallDrawerBrandId !== null) setMallDrawerBrandId(null);
      return;
    }
    const inList = visibleBrands.some(b => b.id === currentBrandId);
    if (!currentBrandId || !inList) {
      const firstId = visibleBrands[0].id;
      setCurrentBrandId(firstId);
      setMallDrawerBrandId(firstId);
    }
  }, [currentBrandId, visibleBrands, mallDrawerBrandId]);
```

(차이: 자동 선택 시 drawer도 같은 brand로 오픈; 빈 brand 리스트면 drawer도 닫음. `mallDrawerBrandId` 도 dep 추가.)

- [ ] **Step 3: 컴파일 확인**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('mallDrawerBrandId state:', code.includes('const [mallDrawerBrandId, setMallDrawerBrandId]'));console.log('Auto-select drawer open:', code.includes('setMallDrawerBrandId(firstId)'));"
```

Expected: 둘 다 `true`.

- [ ] **Step 4: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 1 — mallDrawerBrandId state + auto-select drawer open

- Add mallDrawerBrandId state (null = closed, brandId = open for that brand)
- Auto-select effect now opens drawer when first brand is auto-selected
- Empty brands list also resets drawer

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

(closing `'@` MUST be at column 0)

---

### Task 2: 사이드바 brand 클릭 — drawer 토글

**Files:**
- Modify: `src/App.js:1048` (사이드바 brand button onClick)

- [ ] **Step 1: brand button onClick 갱신**

`src/App.js:1048` 의:

```javascript
                onClick={() => sidebarOpen && setCurrentBrandId(b.id)}
```

다음으로 교체:

```javascript
                onClick={() => {
                  if (!sidebarOpen) return;
                  setCurrentBrandId(b.id);
                  setMallDrawerBrandId(prev => prev === b.id ? null : b.id);
                }}
```

(차이: 같은 브랜드 재클릭 시 drawer 토글, 다른 브랜드 클릭 시 그 브랜드의 drawer 오픈)

- [ ] **Step 2: 컴파일 확인**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('Toggle logic:', code.includes('setMallDrawerBrandId(prev => prev === b.id ? null : b.id)'));"
```

Expected: `true`.

- [ ] **Step 3: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 2 — 사이드바 brand 클릭에서 drawer 토글

같은 brand 재클릭 시 drawer 토글, 다른 brand 클릭 시 그 brand의 drawer 오픈.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 3: 본문 헤더 변경 — Mall 탭 제거 + mall 텍스트 + 미선택 placeholder

**Files:**
- Modify: `src/App.js:1167-1273` (본문 헤더 블록 전체 교체)

- [ ] **Step 1: 헤더 블록 교체**

`src/App.js:1167` 의 `{/* 브랜드 헤더 + Mall 탭 + Main 탭 + 매출 서브탭 */}` 주석부터 line 1273 의 `)}` (이 블록의 마지막 닫는 `)}` 까지) 까지를 다음으로 교체.

검색 대상 (현재 형태):
```javascript
          {/* 브랜드 헤더 + Mall 탭 + Main 탭 + 매출 서브탭 */}
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
                  // ... 두 버튼 (mall + 🔗 sync) ...
                })}
              </div>

              {/* Main 탭 */}
              <div style={{ display:"flex", gap:4, marginBottom:14, background:"white", borderRadius:12, padding:"6px", boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                {[["매출","💰"],["광고","📣"],["원가","📊"]].map(([t,icon]) => {
                  // ... main tab buttons ...
                })}
              </div>

              {/* 매출 서브탭 (매출 선택 시만) */}
              {mainTab === "매출" && isCurrentMallSupported && (
                <div style={{ display:"flex", gap:4, marginBottom:14, background:"white", borderRadius:12, padding:"6px", boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                  {["주문입력","주문조회","결산조회"].map(s => {
                    // ... sub tab buttons ...
                  })}
                </div>
              )}
            </>
          )}
```

**교체 결과** (Mall 탭 행 제거 + 헤더에 mall 텍스트 + drawer 열림 시 미선택 안내):

```javascript
          {/* 브랜드 헤더 + Main 탭 + 매출 서브탭 */}
          {!currentBrand ? (
            <div style={{ background:"white", borderRadius:14, padding:24, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", textAlign:"center", color:"#94A3B8", fontSize:13 }}>
              조회 권한이 있는 브랜드가 없습니다.
            </div>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                <div style={{ width:14, height:14, borderRadius:"50%", background:currentBrand.color, flexShrink:0 }} />
                <div style={{ fontSize:18, fontWeight:800, color:"#1E293B" }}>{currentBrand.name}</div>
                <span style={{ fontSize:14, color:"#94A3B8" }}>·</span>
                <div style={{ fontSize:14, fontWeight:700, color:MALL_TYPE_COLORS[currentMallType] }}>
                  {currentMallType==="자사몰"?"🏪":"🛍️"} {currentMallType}
                </div>
                {currentBrand.department && <div style={{ fontSize:12, color:"#94A3B8", marginLeft:"auto" }}>{currentBrand.department}</div>}
              </div>

              {mallDrawerBrandId === currentBrand.id ? (
                <div style={{ background:"white", borderRadius:14, padding:32, boxShadow:"0 1px 4px rgba(0,0,0,0.07)", textAlign:"center" }}>
                  <div style={{ fontSize:30, marginBottom:10 }}>👈</div>
                  <div style={{ fontSize:14, fontWeight:700, color:"#1E293B", marginBottom:4 }}>왼쪽 drawer에서 쇼핑몰을 선택해주세요</div>
                  <div style={{ fontSize:12, color:"#94A3B8" }}>자사몰 또는 스마트스토어를 선택하면 콘텐츠가 표시됩니다.</div>
                </div>
              ) : (
                <>
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

                  {/* 매출 서브탭 (매출 선택 시만) */}
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
            </>
          )}
```

핵심 변경:
- Mall 탭 row (자사몰/스마트스토어 버튼 + 🔗 sync) **삭제**
- 브랜드 헤더에 "· 🏪 자사몰" (또는 🛍️ 스마트스토어) 텍스트 추가
- `mallDrawerBrandId === currentBrand.id` 일 때 본문은 "왼쪽 drawer에서 쇼핑몰을 선택해주세요" 안내. 그 외엔 Main 탭 + Sub 탭 + 본문.

- [ ] **Step 2: 본문 콘텐츠 블록도 drawer 열림 시 숨김**

본문 콘텐츠 블록들(`{currentBrand && !isCurrentMallSupported && (...`, `{currentBrand && isCurrentMallSupported && mainTab==="원가" ...` 등)도 drawer 열림 상태에서는 노출되면 안 된다. 가장 단순한 방법: 모든 본문 블록에 `mallDrawerBrandId !== currentBrand.id` 조건 추가.

`src/App.js:1275` 부근의:
```javascript
          {currentBrand && !isCurrentMallSupported && (
```
다음으로 교체:
```javascript
          {currentBrand && mallDrawerBrandId !== currentBrand.id && !isCurrentMallSupported && (
```

`src/App.js:1284` 부근의:
```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="원가" && (
```
다음으로 교체:
```javascript
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="원가" && (
```

`src/App.js:1292` 부근의:
```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="광고" && (
```
다음으로 교체:
```javascript
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="광고" && (
```

`src/App.js:1300` 부근의:
```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="주문입력" && (
```
다음으로 교체:
```javascript
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="주문입력" && (
```

`src/App.js:1386` 부근의:
```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && (salesSubTab==="주문조회"||salesSubTab==="결산조회") && (
```
다음으로 교체:
```javascript
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="매출" && (salesSubTab==="주문조회"||salesSubTab==="결산조회") && (
```

`src/App.js:1432` 부근의:
```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="주문조회" && (
```
다음으로 교체:
```javascript
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="주문조회" && (
```

`src/App.js:1439` 부근의:
```javascript
          {currentBrand && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="결산조회" && (
```
다음으로 교체:
```javascript
          {currentBrand && mallDrawerBrandId !== currentBrand.id && isCurrentMallSupported && mainTab==="매출" && salesSubTab==="결산조회" && (
```

(라인 번호는 Task 3 Step 1 변경 후 시프트됐을 수 있음 — 검색해서 정확히 매치해서 교체하시오.)

- [ ] **Step 3: 컴파일 확인**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('Mall 탭 행 제거:', !/\{\/\* Mall 탭 \*\/\}/.test(code));console.log('헤더 mall 텍스트:', code.includes('MALL_TYPE_COLORS[currentMallType]'));console.log('drawer placeholder:', code.includes('왼쪽 drawer에서 쇼핑몰을 선택해주세요'));console.log('drawerBrandId guard 갯수:', (code.match(/mallDrawerBrandId !== currentBrand\.id/g)||[]).length);"
```

Expected:
- `Mall 탭 행 제거`: `true`
- `헤더 mall 텍스트`: `true`
- `drawer placeholder`: `true`
- `drawerBrandId guard 갯수`: `7` (미연동 1 + 원가 1 + 광고 1 + 주문입력 1 + 공통필터 1 + 주문조회 1 + 결산조회 1)

- [ ] **Step 4: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 3 — 본문 Mall 탭 제거 + mall 텍스트 + drawer 열림 시 안내

- 본문 헤더에서 [자사몰|스마트스토어] 탭 행 제거
- 헤더에 "· 🏪 자사몰" 텍스트 (현재 mall 표시)
- Drawer 열림 시 본문에 "왼쪽 drawer에서 쇼핑몰을 선택해주세요" 안내
- 모든 콘텐츠 블록에 mallDrawerBrandId !== currentBrand.id guard 추가

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 4: Desktop Drawer (사이드바 옆 패널)

**Files:**
- Modify: `src/App.js:1140-1144` (메인 렌더 root)

- [ ] **Step 1: Drawer JSX를 사이드바와 본문 사이에 추가**

`src/App.js:1142` 의:

```javascript
      {!isMobile && <SidebarContent />}
```

직후, 다음 line `<div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>` 직전에 다음 추가:

```javascript
      {!isMobile && mallDrawerBrandId && (() => {
        const drawerBrand = getBrand(mallDrawerBrandId);
        if (!drawerBrand) return null;
        return (
          <div style={{ width:240, minWidth:240, background:"white", borderRight:"1px solid #E2E8F0", display:"flex", flexDirection:"column", flexShrink:0, height:"100vh", position:"sticky", top:0, boxShadow:"2px 0 6px rgba(0,0,0,0.04)" }}>
            <div style={{ padding:"14px 16px", borderBottom:"1px solid #F1F5F9", display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:drawerBrand.color, flexShrink:0 }} />
              <div style={{ flex:1, fontSize:14, fontWeight:800, color:"#1E293B", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{drawerBrand.name}</div>
              <button onClick={() => setMallDrawerBrandId(null)} style={{ background:"none", border:"none", cursor:"pointer", color:"#94A3B8", fontSize:18, padding:"2px 6px", borderRadius:6 }} title="닫기">✕</button>
            </div>
            <div style={{ flex:1, padding:"16px 12px", display:"flex", flexDirection:"column", gap:8 }}>
              {MALL_TYPES.map(t => {
                const supported = drawerBrand.mallTypes?.includes(t) ?? false;
                return (
                  <div key={t} style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <button
                      onClick={() => {
                        setCurrentMallType(t);
                        setMallDrawerBrandId(null);
                      }}
                      style={{
                        flex:1,
                        padding:"14px 16px",
                        borderRadius:10,
                        border:`2px solid ${MALL_TYPE_COLORS[t]}30`,
                        background:`${MALL_TYPE_COLORS[t]}10`,
                        color:MALL_TYPE_COLORS[t],
                        cursor:"pointer",
                        fontSize:14,
                        fontWeight:700,
                        textAlign:"left",
                        display:"flex",
                        alignItems:"center",
                        gap:8,
                      }}
                    >
                      <span style={{ fontSize:18 }}>{t==="자사몰"?"🏪":"🛍️"}</span>
                      <span style={{ flex:1 }}>{t}</span>
                      {!supported && <span style={{ fontSize:10, padding:"2px 6px", borderRadius:6, background:"#F1F5F9", color:"#94A3B8", fontWeight:600 }}>미연동</span>}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (t === "스마트스토어") {
                          setSmartStoreBrand(drawerBrand); setSmartStoreSyncResult(""); setShowSmartstoreModal(true);
                        } else {
                          setCafe24Brand(drawerBrand); setCafe24MallId(cafe24Tokens[drawerBrand.id]?.mall_id||""); setCafe24SyncResult(""); setShowCafe24Modal(true);
                        }
                      }}
                      title={t==="스마트스토어"?"스마트스토어 동기화":"카페24 연동"}
                      style={{ padding:"10px 12px", borderRadius:8, border:"1px solid #E2E8F0", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:13, fontWeight:600 }}
                    >🔗</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 2: 컴파일 확인**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('Desktop drawer:', code.includes('!isMobile && mallDrawerBrandId && (() =>'));console.log('Drawer ✕ button:', code.includes('setMallDrawerBrandId(null)'));"
```

Expected: 둘 다 `true`.

- [ ] **Step 3: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 4 — Desktop Mall Drawer (사이드바 옆 패널)

브랜드 클릭 시 사이드바 우측에 nm 240px drawer 노출.
- 헤더: 브랜드명 + ✕ 닫기
- 자사몰/스마트스토어 큰 버튼 + 🔗 동기화 (카페24/스마트스토어 모달)
- 미연동 mall은 "미연동" 라벨 표시 (클릭은 됨, 본문에서 준비 중 안내)
- 모바일은 Task 5에서 별도 처리

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 5: Mobile Drawer (fullscreen modal)

**Files:**
- Modify: `src/App.js` 메인 렌더 root (Task 4에서 추가한 데스크탑 drawer 다음)

- [ ] **Step 1: Mobile fullscreen modal 추가**

Task 4 에서 추가한 데스크탑 drawer 블록 직후에 다음 추가 (즉 `<div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>` 직전):

```javascript
      {isMobile && mallDrawerBrandId && (() => {
        const drawerBrand = getBrand(mallDrawerBrandId);
        if (!drawerBrand) return null;
        return (
          <div onClick={() => setMallDrawerBrandId(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:300 }}>
            <div onClick={e => e.stopPropagation()} style={{ background:"white", width:"100%", maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20, padding:"20px 18px 28px", maxHeight:"80vh", overflowY:"auto" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18 }}>
                <div style={{ width:12, height:12, borderRadius:"50%", background:drawerBrand.color, flexShrink:0 }} />
                <div style={{ flex:1, fontSize:16, fontWeight:800, color:"#1E293B" }}>{drawerBrand.name}</div>
                <button onClick={() => setMallDrawerBrandId(null)} style={{ background:"none", border:"none", cursor:"pointer", color:"#94A3B8", fontSize:22, padding:"4px 8px", borderRadius:6 }} title="닫기">✕</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {MALL_TYPES.map(t => {
                  const supported = drawerBrand.mallTypes?.includes(t) ?? false;
                  return (
                    <div key={t} style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <button
                        onClick={() => {
                          setCurrentMallType(t);
                          setMallDrawerBrandId(null);
                        }}
                        style={{
                          flex:1,
                          padding:"16px 16px",
                          borderRadius:12,
                          border:`2px solid ${MALL_TYPE_COLORS[t]}30`,
                          background:`${MALL_TYPE_COLORS[t]}10`,
                          color:MALL_TYPE_COLORS[t],
                          cursor:"pointer",
                          fontSize:15,
                          fontWeight:700,
                          textAlign:"left",
                          display:"flex",
                          alignItems:"center",
                          gap:10,
                        }}
                      >
                        <span style={{ fontSize:22 }}>{t==="자사몰"?"🏪":"🛍️"}</span>
                        <span style={{ flex:1 }}>{t}</span>
                        {!supported && <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, background:"#F1F5F9", color:"#94A3B8", fontWeight:600 }}>미연동</span>}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (t === "스마트스토어") {
                            setSmartStoreBrand(drawerBrand); setSmartStoreSyncResult(""); setShowSmartstoreModal(true);
                          } else {
                            setCafe24Brand(drawerBrand); setCafe24MallId(cafe24Tokens[drawerBrand.id]?.mall_id||""); setCafe24SyncResult(""); setShowCafe24Modal(true);
                          }
                        }}
                        title={t==="스마트스토어"?"스마트스토어 동기화":"카페24 연동"}
                        style={{ padding:"12px 14px", borderRadius:10, border:"1px solid #E2E8F0", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:14, fontWeight:600 }}
                      >🔗</button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
```

핵심 차이 (데스크탑 대비): bottom sheet 형태 (모바일에서 자연스러운 패턴), 외부 어두운 배경 클릭 시 닫힘 (`onClick={() => setMallDrawerBrandId(null)}` 외부, `e.stopPropagation()` 내부).

- [ ] **Step 2: 컴파일 확인**

```powershell
node -e "const fs=require('fs');const code=fs.readFileSync('src/App.js','utf8');console.log('Mobile drawer:', code.includes('isMobile && mallDrawerBrandId && (() =>'));console.log('Bottom sheet:', code.includes('borderTopLeftRadius:20'));"
```

Expected: 둘 다 `true`.

- [ ] **Step 3: 커밋**

```powershell
git add src/App.js
git commit -m @'
refactor(app): Task 5 — Mobile Mall Drawer (fullscreen bottom sheet)

모바일에선 drawer를 bottom sheet 형태로 노출.
- 외부 어두운 배경 클릭 시 닫힘
- 내부 클릭은 stopPropagation으로 닫힘 방지
- 자사몰/스마트스토어 + 🔗 동기화 데스크탑과 동일

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 6: 빌드 검증 + main에 squash-merge

- [ ] **Step 1: 프로덕션 빌드**

```powershell
npm run build
```

Expected: `Compiled successfully.` 또는 `Compiled with warnings.` (warnings only). 에러 발생 시 중단하고 보고.

- [ ] **Step 2: 데스크탑 시나리오 스모크 테스트**

`npm start` 켜고 다음 확인:

| 시나리오 | 기대 동작 |
|---------|----------|
| 첫 로그인 | 첫 brand 자동 선택 + drawer 자동 오픈, 본문 "왼쪽 drawer에서 쇼핑몰을 선택해주세요" |
| Drawer 자사몰 클릭 | drawer 닫힘, 본문 "🟢 팔레오 · 🏪 자사몰" 헤더 + [매출/광고/원가] 탭 + 결산조회 데이터 |
| Drawer 스마트스토어 클릭 | 헤더 "· 🛍️ 스마트스토어"로 바뀜, 데이터 갱신 |
| 다른 brand 클릭 | drawer 재오픈, 본문 다시 안내 placeholder |
| 같은 brand 재클릭 | drawer 토글 (닫혔다 열렸다) |
| Drawer ✕ | drawer 닫힘, 본문은 기존 currentMallType 콘텐츠 (또는 첫 로그인엔 자사몰 default) |
| Drawer 🔗 자사몰 | 카페24 연동 모달 열림, mall 선택 안 됨 |
| Drawer 🔗 스마트스토어 | 스마트스토어 동기화 모달 열림 |
| 아프리모 → 스마트스토어 | drawer에 "미연동" 라벨, 클릭 → 본문에 "준비 중" |
| 사이드바 ✏️/🗑️ | 편집/삭제 모달 정상 (drawer 영향 없음) |
| 사이드바 collapsed (◀ 접기) | brand 클릭 무동작 (current 유지, drawer 영향 없음) |

- [ ] **Step 3: 모바일 시나리오 스모크 테스트**

브라우저 dev tools 모바일 뷰 (≤ 768px):

| 시나리오 | 기대 동작 |
|---------|----------|
| 첫 로그인 | drawer가 bottom sheet로 자동 오픈 |
| Mall 클릭 | bottom sheet 닫힘, 본문 표시 |
| 외부 어두운 영역 클릭 | bottom sheet 닫힘 |
| ✕ 클릭 | bottom sheet 닫힘 |
| 하단 [매출/광고/원가] 네비 | mainTab 갱신 (drawer는 별개 동작) |

- [ ] **Step 4: 콘솔 에러 점검**

브라우저 콘솔에 React warning/error 없는지 확인. 있으면 수정 후 다시 빌드.

- [ ] **Step 5: main에 squash-merge**

```powershell
git checkout main
git merge --squash feature/sidebar-mall-drawer
git commit -m @'
feat: 사이드바 Mall Drawer

브랜드 클릭 시 사이드바 옆에 mall 선택 drawer가 뜨고,
mall 선택 후 drawer가 닫히며 본문이 풀 너비로 표시.

- State: mallDrawerBrandId 추가
- Auto-select effect: 첫 brand 선택 시 drawer 자동 오픈
- 사이드바 brand 클릭: drawer 토글 (같은 brand 재클릭 시 닫힘)
- 본문: Mall 탭 row 제거, 헤더에 "· 🏪 자사몰" 텍스트
- Drawer 열림 시 본문에 "왼쪽 drawer에서 쇼핑몰을 선택해주세요" 안내
- 데스크탑: 사이드바 우측 240px 패널
- 모바일: bottom sheet (외부 클릭 시 닫힘)
- 🔗 동기화 버튼은 drawer 안으로 이동
- 미연동 mall은 "미연동" 라벨 표시, 클릭 시 본문 "준비 중"

Spec: docs/superpowers/specs/2026-05-07-sidebar-mall-drawer-design.md
Plan: docs/superpowers/plans/2026-05-07-sidebar-mall-drawer.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

- [ ] **Step 6: feature branch 삭제**

```powershell
git branch -D feature/sidebar-mall-drawer
```

- [ ] **Step 7: push (사용자 승인 후)**

```powershell
git push
```

(사용자에게 push 여부 명시적으로 확인. Vercel 자동 배포됨.)
