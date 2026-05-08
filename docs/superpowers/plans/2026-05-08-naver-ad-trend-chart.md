# 네이버 광고 트렌드 라인차트 (Phase 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 키워드/캠페인 row 클릭 시 일별 변화 라인차트를 모달로 표시 — 트렌드 추세를 즉시 파악해서 입찰가 조정 / 캠페인 재배분 결정 지원.

**Architecture:** `recharts` 라이브러리 추가 + 신규 컴포넌트 `src/components/TrendChartModal.js`로 분리. `src/App.js`에 lazy import + state + row click 핸들러 + 모달 렌더 추가. 데이터 소스는 기존 `naverKeywordStats` / `naverCampaignRawRows` 클라이언트 사이드 필터.

**Tech Stack:** React 19, recharts, Supabase (변경 없음), Vercel serverless (변경 없음)

**Spec:** `docs/superpowers/specs/2026-05-08-naver-ad-trend-chart-design.md`

---

### Task 1: recharts 의존성 추가

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: recharts 설치**

```bash
npm install recharts
```

기대: `package.json`의 `dependencies`에 `"recharts": "^x.y.z"` 추가, `package-lock.json` 갱신.

- [ ] **Step 2: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대: 빌드 성공. (이 시점엔 recharts 사용 안 했으므로 번들 사이즈 거의 그대로.)

- [ ] **Step 3: 커밋**

```bash
git add package.json package-lock.json
git commit -m "chore: recharts 의존성 추가 (Phase 2b 트렌드 차트용)"
```

---

### Task 2: TrendChartModal 컴포넌트 신규 작성

**Files:**
- Create: `src/components/TrendChartModal.js`

- [ ] **Step 1: 디렉토리 확인**

```powershell
Test-Path src/components
```

없으면 `New-Item -ItemType Directory src/components` 로 생성. 있으면 그대로 사용.

- [ ] **Step 2: TrendChartModal.js 작성**

`src/components/TrendChartModal.js` 신규 파일에 다음 내용:

```jsx
import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const METRICS = [
  { key: "cost", label: "광고비", color: "#EF4444" },
  { key: "clicks", label: "클릭", color: "#10B981" },
  { key: "conversions", label: "전환수", color: "#475569" },
  { key: "roas", label: "ROAS", color: "#3B82F6" },
];

function formatByMetric(value, metric, fmt) {
  if (value == null || isNaN(value)) return "-";
  if (metric === "cost") return fmt(Math.round(value));
  if (metric === "roas") return `${Math.round(value)}%`;
  return Number(value).toLocaleString();
}

export default function TrendChartModal({ open, onClose, title, subtitle, dailyRows, fmt }) {
  const [metric, setMetric] = useState("cost");

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  // 차트 데이터 가공: 일별 row를 날짜순 정렬, ROAS 계산
  const chartData = (dailyRows || [])
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map(r => ({
      date: r.date,
      cost: r.cost || 0,
      clicks: r.clicks || 0,
      conversions: r.conversions || 0,
      roas: r.cost > 0 ? Math.round((r.conversion_value || 0) / r.cost * 100) : 0,
    }));

  const values = chartData.map(d => d[metric]);
  const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const change = values.length >= 2 && values[0] !== 0
    ? ((values[values.length - 1] - values[0]) / values[0] * 100)
    : 0;

  const activeMetric = METRICS.find(m => m.key === metric) || METRICS[0];

  const backdropStyle = { position:"fixed", inset:0, background:"rgba(15,23,42,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:16 };
  const modalStyle = { background:"white", borderRadius:14, maxWidth:760, width:"100%", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.25)", padding:20 };
  const headerStyle = { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12, gap:8 };
  const titleStyle = { fontSize:17, fontWeight:800, color:"#1E293B", marginBottom:3 };
  const subtitleStyle = { fontSize:12, color:"#64748B" };
  const closeBtnStyle = { padding:"4px 10px", border:"none", background:"#F1F5F9", color:"#475569", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:700 };
  const tabsStyle = { display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" };
  const summaryStyle = { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginTop:14 };
  const summaryItemStyle = { background:"#F8FAFC", borderRadius:8, padding:"10px 12px" };
  const summaryLabelStyle = { fontSize:11, color:"#94A3B8", fontWeight:600, marginBottom:3 };
  const summaryValueStyle = { fontSize:14, fontWeight:700, color:"#1E293B" };
  const periodNoteStyle = { fontSize:11, color:"#94A3B8", marginTop:8 };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <header style={headerStyle}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={titleStyle} title={title}>{title}</div>
            {subtitle && <div style={subtitleStyle} title={subtitle}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={closeBtnStyle} title="닫기 (ESC)">✕</button>
        </header>
        <div style={tabsStyle}>
          {METRICS.map(m => {
            const isActive = m.key === metric;
            return (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                style={{
                  padding:"7px 14px", borderRadius:8, border:`1px solid ${isActive ? m.color : "#E2E8F0"}`,
                  background: isActive ? `${m.color}15` : "white",
                  color: isActive ? m.color : "#475569",
                  fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}
              >{m.label}</button>
            );
          })}
        </div>
        {chartData.length === 0 ? (
          <div style={{ padding:"60px 0", textAlign:"center", color:"#94A3B8", fontSize:13 }}>📊 표시할 데이터가 없습니다</div>
        ) : (
          <>
            <div style={{ width:"100%", height:300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top:8, right:16, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748B" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickFormatter={v => formatByMetric(v, metric, fmt)} width={70} />
                  <Tooltip
                    formatter={v => [formatByMetric(v, metric, fmt), activeMetric.label]}
                    labelFormatter={d => d}
                    contentStyle={{ borderRadius:8, border:"1px solid #E2E8F0", fontSize:12 }}
                  />
                  <Line type="monotone" dataKey={metric} stroke={activeMetric.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={summaryStyle}>
              <div style={summaryItemStyle}>
                <div style={summaryLabelStyle}>📊 평균</div>
                <div style={summaryValueStyle}>{formatByMetric(avg, metric, fmt)}</div>
              </div>
              <div style={summaryItemStyle}>
                <div style={summaryLabelStyle}>🔝 최대</div>
                <div style={summaryValueStyle}>{formatByMetric(max, metric, fmt)}</div>
              </div>
              <div style={summaryItemStyle}>
                <div style={summaryLabelStyle}>🔻 최소</div>
                <div style={summaryValueStyle}>{formatByMetric(min, metric, fmt)}</div>
              </div>
              <div style={summaryItemStyle}>
                <div style={summaryLabelStyle}>{change > 0 ? "↑" : change < 0 ? "↓" : "→"} 변화율</div>
                <div style={{...summaryValueStyle, color: change > 0 ? "#10B981" : change < 0 ? "#EF4444" : "#64748B"}}>{change === 0 ? "0%" : `${Math.abs(change).toFixed(0)}%`}</div>
              </div>
            </div>
            <div style={periodNoteStyle}>📅 동기화 기간 전체 ({chartData[0]?.date} ~ {chartData[chartData.length-1]?.date})</div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대: 빌드 성공. 번들 사이즈는 아직 App.js에 import 안 했으므로 거의 동일. (단, recharts가 어딘가에 import되면 +80KB 예상.)

- [ ] **Step 4: 커밋**

```bash
git add src/components/TrendChartModal.js
git commit -m "feat(naver-ad): TrendChartModal 컴포넌트 신규 (Phase 2b)"
```

---

### Task 3: App.js 통합 — state + row click + lazy import

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: lazy import + Suspense 추가**

`src/App.js` 상단의 React import를 확인 (이미 `useState`, `useEffect` 등 import 되어 있을 것). `lazy`, `Suspense` 추가:

```js
import React, { useState, useEffect, useMemo, lazy, Suspense } from "react";
```

(기존 import 형태 그대로 유지하면서 `lazy`, `Suspense`만 추가. 이미 있다면 변경 없음.)

App.js 함수 외부 (다른 const 모음과 함께) 상단에 추가:

```js
const TrendChartModal = lazy(() => import("./components/TrendChartModal"));
```

- [ ] **Step 2: state 추가**

`naverAdDateFilter` 같은 광고 관련 state들과 함께 추가:

```js
  const [trendChartTarget, setTrendChartTarget] = useState(null);
  // null = 닫힘
  // { type: "keyword"|"campaign", id, title, subtitle } = 열림
```

- [ ] **Step 3: 키워드 row에 onClick + hover 추가**

키워드 IIFE 안에서 `<tr key={k.keyword_id}` 하는 부분을 찾기. 기존:

```jsx
                                  <tr key={k.keyword_id} style={{ borderBottom:"1px solid #F1F5F9" }}>
```

다음으로 변경:

```jsx
                                  <tr
                                    key={k.keyword_id}
                                    onClick={() => setTrendChartTarget({
                                      type: "keyword",
                                      id: k.keyword_id,
                                      title: k.keyword_name,
                                      subtitle: `${k.campaign_name || "-"} · ${k.campaign_type ? (CAMPAIGN_TYPE_LABEL[k.campaign_type] || k.campaign_type) : "-"}`,
                                    })}
                                    onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                    style={{ borderBottom:"1px solid #F1F5F9", cursor:"pointer", transition:"background 0.1s" }}
                                  >
```

- [ ] **Step 4: 캠페인 row에 onClick + hover 추가**

캠페인 IIFE 안에서 `<tr key={c.campaign_id}` 부분을 찾기. 기존:

```jsx
                                  <tr key={c.campaign_id} style={{ borderBottom:"1px solid #F1F5F9" }}>
```

다음으로 변경:

```jsx
                                  <tr
                                    key={c.campaign_id}
                                    onClick={() => setTrendChartTarget({
                                      type: "campaign",
                                      id: c.campaign_id,
                                      title: c.campaign_name,
                                      subtitle: c.campaign_type ? (CAMPAIGN_TYPE_LABEL[c.campaign_type] || c.campaign_type) : "-",
                                    })}
                                    onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                    style={{ borderBottom:"1px solid #F1F5F9", cursor:"pointer", transition:"background 0.1s" }}
                                  >
```

- [ ] **Step 5: 모달 렌더링 추가**

`</main>` 닫는 태그 또는 다른 모달들이 렌더링되는 위치에 (예: `{showNaverAdModal && ...}` 근처) 추가:

```jsx
      {trendChartTarget && (
        <Suspense fallback={null}>
          <TrendChartModal
            open
            onClose={() => setTrendChartTarget(null)}
            title={trendChartTarget.title}
            subtitle={trendChartTarget.subtitle}
            dailyRows={
              trendChartTarget.type === "keyword"
                ? naverKeywordStats.filter(k => k.keyword_id === trendChartTarget.id)
                : naverCampaignRawRows.filter(r => r.campaign_id === trendChartTarget.id)
            }
            fmt={fmt}
          />
        </Suspense>
      )}
```

위치는 `showNaverAdModal && currentBrand && (...)` 모달 렌더 직전 또는 직후가 자연스러움.

- [ ] **Step 6: 빌드 확인**

```powershell
$env:CI="false"; & "C:\Program Files\nodejs\node.exe" "node_modules\react-scripts\bin\react-scripts.js" build
```

기대: 빌드 성공. 번들 사이즈는 main bundle에 약간 증가 + recharts는 별도 chunk로 분리 (lazy import 효과). build 출력에 `static/js/<hash>.chunk.js` 같은 추가 chunk 확인.

- [ ] **Step 7: 커밋 + 푸시**

```bash
git add src/App.js
git commit -m "feat(naver-ad): 키워드/캠페인 row 클릭 시 트렌드 차트 모달"
git push
```

---

### Task 4: 배포 후 end-to-end 검증

**Files:** (없음 — 사용자 수동 테스트)

- [ ] **Step 1: Vercel 배포 완료 대기** (1~3분)

- [ ] **Step 2: 광고 탭 진입, 동기화된 상태 확인**

이미 동기화된 데이터가 있어야 함. 없으면 동기화 후 진행.

- [ ] **Step 3: 키워드 row hover → 클릭**

- 키워드별 표 row에 마우스 오버 → 배경 색 변화 + cursor pointer 확인
- 클릭 → 트렌드 차트 모달 오픈
- 모달 헤더에 키워드명 + 캠페인명·광고영역 표시
- 메트릭 탭 4개 (광고비/클릭/전환수/ROAS), default 광고비 활성
- 라인차트가 동기화 기간 전체 표시
- 차트 아래 요약 4개 (평균/최대/최소/변화율)
- 메트릭 탭 클릭하면 차트 + 요약 업데이트
- ROAS 탭의 경우 % 단위 표시

- [ ] **Step 4: 모달 닫기**

- 외부 클릭 → 닫힘
- ✕ 버튼 → 닫힘
- ESC 키 → 닫힘

- [ ] **Step 5: 캠페인 row 클릭**

- 캠페인별 표 row 클릭 → 모달 오픈
- 헤더에 캠페인명 + 광고영역
- 동일 메트릭/요약 동작

- [ ] **Step 6: 단일 날짜 모드와의 인터랙션**

- 셀렉터에서 5/1 같은 단일 날짜 선택
- 키워드 row 클릭 → 모달은 여전히 동기화 기간 전체 트렌드 표시 (현재 dateFilter 무시)
- 모달 하단 안내: "📅 동기화 기간 전체 ..." 텍스트 확인

- [ ] **Step 7: 정렬 헤더 클릭은 row 클릭과 충돌 없는지 확인**

- 키워드별 표의 컬럼 헤더(예: 광고비) 클릭 → 정렬 변경, 모달 안 열림
- 캠페인 ▼ 필터 버튼 클릭 → 팝업 표시, 모달 안 열림

- [ ] **Step 8: 번들 사이즈 확인 (선택)**

build 출력에서 main.js 크기 + 별도 chunk 크기 확인. recharts 번들이 lazy chunk로 분리되었는지.

- [ ] **Step 9: 다른 브랜드/탭 이동 시 정리**

- 다른 브랜드로 이동 → 모달 자동 닫힘 (state는 새 브랜드 진입 시 영향 없음, 컴포넌트 unmount로 정리됨)
- 매출 탭 → 광고 탭 이동도 정상 동작

---

## 완료 시 사용자에게 제안

모든 task 완료 후, 사용자에게:

> Phase 2b 완료. 이제 키워드/캠페인 단위 트렌드 가시화 가능. 다음 후보:
> - 두 키워드/캠페인 비교 (multi-line)
> - 인라인 sparkline (각 row에 작은 차트 미리보기)
> - 다른 광고 채널 통합 (Meta/Google/유튜브 광고비 → 통합 ROAS)
> - 검색어 보고서 (제외 키워드 발굴)
> - cron 자동 동기화
>
> 어디로 가실래요?
