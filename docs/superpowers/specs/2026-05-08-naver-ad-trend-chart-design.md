# 네이버 광고 — 트렌드 라인 차트 (Phase 2b)

작성일: 2026-05-08
대상: `src/App.js`, `package.json`
선행 변경: `2026-05-08-naver-ad-keyword-daily-design.md` (Phase 2a — 일별 row 저장)

## 배경

Phase 2a에서 일별 키워드/캠페인 row 저장 완료. 사용자는 이제 단일 날짜 조회를 할 수 있지만, **시간 변화** 자체는 여전히 안 보임. 키워드/캠페인 row 클릭 시 일별 변화 라인차트를 모달로 열어 트렌드 즉시 파악.

목표 사용 케이스:
- "어제 잘 나가던 키워드가 갑자기 떨어졌다" 패턴 감지
- "이 캠페인은 점점 좋아지고 있나, 떨어지고 있나" 추세 판단
- 의사결정 지원: 입찰가 조정 / 캠페인 재배분 / 제외 키워드 등록

## 단계 분리

- **Phase 2a 완료**: 일별 row 저장 + 단일 날짜 셀렉터
- **Phase 2b (이번)**: 키워드/캠페인 row 클릭 → 트렌드 라인차트 모달 (메트릭 토글)
- 향후 후보: 다중 키워드 비교, dual-axis (cost+ROAS), 인라인 sparkline, 검색어 보고서

## 라이브러리 결정

**recharts** 선택. 이유:
- React 친화적 선언적 API (`<LineChart>`, `<XAxis>` 등 컴포넌트 형태)
- 활발한 유지보수
- 약 80KB gzipped 추가 — 현재 번들 260KB 기준 30% 증가지만 광고 탭 진입 시점 lazy load로 회피 가능
- D3 기반이지만 D3 직접 노출 안 함 → API 단순

대안 검토:
- Chart.js + react-chartjs-2: imperative 성격, ref 관리 필요. recharts보다 React-idiomatic하지 않음.
- Inline SVG 직접 작성: 의존성 0이지만 hover/tooltip/축 레이블 등 직접 구현 부담.

추가 고려: dynamic import로 광고 탭 진입 시에만 로드 → 다른 탭 사용자에겐 번들 영향 0.

## 데이터 모델 (변경 없음)

기존 테이블 그대로:
- `naver_ad_stats` — `(brand_id, mall_type, date, campaign_id)` 일별 row
- `naver_ad_keyword_stats` — `(brand_id, mall_type, keyword_id, date)` 일별 row

추가 fetch 없음. 모달 열릴 때 이미 메모리에 있는 raw row를 클라이언트 사이드에서 필터/정렬해서 차트 데이터로 변환.

## 백엔드 (변경 없음)

`api/naver-ad.js` 변경 없음.

## 프론트엔드

### 차트 컴포넌트 (`src/components/TrendChartModal.js` 신규)

새 파일에 차트 모달 분리. `src/App.js`가 너무 커서 인라인 추가 부담. 컴포넌트화로 재사용성 + 테스트 가능성 + 코드 분리.

```jsx
// src/components/TrendChartModal.js
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const METRICS = [
  { key: "cost", label: "광고비", color: "#EF4444", format: "currency" },
  { key: "clicks", label: "클릭", color: "#10B981", format: "number" },
  { key: "conversions", label: "전환수", color: "#475569", format: "number" },
  { key: "roas", label: "ROAS", color: "#3B82F6", format: "percent" },
];

export default function TrendChartModal({ open, onClose, title, subtitle, dailyRows, fmt }) {
  const [metric, setMetric] = useState("cost");
  // dailyRows: [{ date, impressions, clicks, cost, conversions, conversion_value }]

  // 차트 데이터 가공: ROAS는 계산 필요
  const chartData = dailyRows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({
      date: r.date,
      cost: r.cost || 0,
      clicks: r.clicks || 0,
      conversions: r.conversions || 0,
      roas: r.cost > 0 ? Math.round((r.conversion_value || 0) / r.cost * 100) : 0,
    }));

  // 요약 통계
  const values = chartData.map(d => d[metric]);
  const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const change = values.length >= 2
    ? values[0] === 0 ? 0 : ((values[values.length - 1] - values[0]) / values[0] * 100)
    : 0;

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <header>
          <div className="title">{title}</div>
          <div className="subtitle">{subtitle}</div>
          <button onClick={onClose}>✕</button>
        </header>
        <div className="metric-tabs">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={metric === m.key ? "active" : ""}
            >{m.label}</button>
          ))}
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatByMetric(v, metric)} />
              <Tooltip formatter={v => formatByMetric(v, metric)} labelFormatter={d => d} />
              <Line type="monotone" dataKey={metric} stroke={METRICS.find(m => m.key === metric).color} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="summary">
          <div>평균: {format(avg)}</div>
          <div>최대: {format(max)}</div>
          <div>최소: {format(min)}</div>
          <div>변화: {change > 0 ? "↑" : change < 0 ? "↓" : "→"} {Math.abs(change).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}
```

스타일은 인라인 (다른 모달과 일관) — 별도 css 파일 없음. 위 코드는 의사 코드 — 실제는 인라인 style props로 작성.

`formatByMetric(value, metric)` 헬퍼: metric=cost면 `fmt(value)` (천단위 콤마+원), clicks/conversions면 `value.toLocaleString()`, roas면 `${value}%`.

ESC 키로 모달 닫기는 `useEffect`로 keydown 리스너 추가 (필수, 표준 모달 UX).

### App.js 변경

**state 추가**:
```js
const [trendChartTarget, setTrendChartTarget] = useState(null);
// null = 닫힘
// { type: "keyword"|"campaign", id: ..., title: ..., subtitle: ... } = 열림
```

**dailyRows 추출 함수**:
```js
function getKeywordDailyRows(keyword_id) {
  return naverKeywordStats.filter(k => k.keyword_id === keyword_id);
}
function getCampaignDailyRows(campaign_id) {
  return naverCampaignRawRows.filter(r => r.campaign_id === campaign_id);
}
```

**키워드 row click handler**: 키워드 IIFE 안 `<tr>`에 onClick 추가 (정렬·필터 컬럼 클릭과 충돌하지 않도록 `<tr>`만 핸들):

```jsx
<tr key={k.keyword_id}
    onClick={() => setTrendChartTarget({
      type: "keyword",
      id: k.keyword_id,
      title: k.keyword_name,
      subtitle: `${k.campaign_name} · ${CAMPAIGN_TYPE_LABEL[k.campaign_type] || "-"}`,
    })}
    style={{ borderBottom: "1px solid #F1F5F9", cursor: "pointer" }}
    >
```

캠페인 row도 동일 패턴 (`subtitle`은 광고영역만 표시).

**모달 렌더**:
```jsx
{trendChartTarget && (
  <TrendChartModal
    open
    onClose={() => setTrendChartTarget(null)}
    title={trendChartTarget.title}
    subtitle={trendChartTarget.subtitle}
    dailyRows={
      trendChartTarget.type === "keyword"
        ? getKeywordDailyRows(trendChartTarget.id)
        : getCampaignDailyRows(trendChartTarget.id)
    }
    fmt={fmt}
  />
)}
```

### 호버 시각 힌트

테이블 row에 `cursor: pointer` + hover 시 배경색 변화로 클릭 가능함을 시사:

```jsx
<tr
  key={...}
  onClick={...}
  onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"}
  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
  style={{ borderBottom: "1px solid #F1F5F9", cursor: "pointer", transition: "background 0.1s" }}
>
```

### dynamic import (선택적 — 번들 사이즈 최적화)

```js
const TrendChartModal = lazy(() => import("./components/TrendChartModal"));

// 사용 시:
{trendChartTarget && (
  <Suspense fallback={null}>
    <TrendChartModal ... />
  </Suspense>
)}
```

광고 탭 진입 시점에 lazy load → 다른 탭 사용자에겐 추가 번들 영향 없음.

## 영향 범위

| 파일 | 변경 |
|------|------|
| `package.json` | `recharts` 의존성 추가 |
| `src/components/TrendChartModal.js` | 신규 파일 |
| `src/App.js` | trendChartTarget state, 키워드/캠페인 IIFE의 tr에 onClick + hover, 모달 렌더, dailyRows 추출 함수 |

## 비목표 (Phase 2b)

- 두 키워드 비교 (multi-line)
- 인라인 sparkline (테이블 행마다 작은 차트)
- 메트릭 두 개 동시 표시 (dual-axis)
- 캠페인 안의 키워드 drill-down 차트
- 차트 PNG 다운로드
- 일자 범위 슬라이더 (현재는 동기화 기간 전체 표시)

## 검증 기준

- [ ] `recharts` 의존성 설치, 빌드 통과
- [ ] 키워드별 표 row 클릭 → 트렌드 모달 오픈
- [ ] 캠페인별 표 row 클릭 → 트렌드 모달 오픈
- [ ] 모달 헤더에 키워드명/캠페인명 + 메타 정보 표시
- [ ] 메트릭 탭 4개 (광고비/클릭/전환수/ROAS) 토글 정상 동작
- [ ] x축 = 날짜, 동기화한 기간 전체 표시
- [ ] y축 메트릭별 포맷 (광고비/전환수=숫자, ROAS=%)
- [ ] Tooltip hover 시 해당 날짜 + 값 표시
- [ ] 차트 아래 요약 통계 4개 (평균/최대/최소/변화율) 표시
- [ ] 변화율 계산: 첫날 0이면 0%, 그 외 (마지막값 - 첫값) / 첫값 × 100
- [ ] 모달 외부 클릭 → 닫힘
- [ ] ESC 키 → 닫힘
- [ ] row hover 시 cursor pointer + 배경 색 변화로 클릭 가능 시사
- [ ] 단일 날짜 모드(naverAdDateFilter !== "")일 때도 차트는 동기화 기간 전체 표시 (날짜 필터 무시 — 트렌드의 본질)
- [ ] 컬럼 헤더(정렬) 클릭은 row 클릭과 충돌하지 않음 (event.stopPropagation 확인)
- [ ] 광고영역별 표는 클릭 트리거 없음 (Phase 2b 비목표)
- [ ] 빌드 사이즈 증가 확인 (~80KB gzipped 추가 예상)

## 리스크와 대응

**1. 번들 사이즈 증가**
- 현재 ~260KB → ~340KB. 30% 증가.
- 대응: dynamic import로 광고 탭 진입 시점 lazy load. 다른 탭 사용자에겐 영향 0. 광고 탭 사용자는 첫 진입 시 ~0.5초 추가 로드 (3G 기준).

**2. 차트 데이터 없는 경우**
- 동기화한 기간 안에 그 키워드/캠페인이 비활성이라 일별 row가 0~1개일 수 있음
- 대응: `dailyRows.length === 0` → "데이터 없음" 메시지. `length === 1` → 점 하나만 표시 (차트 자체는 그려짐).

**3. ROAS 변동성**
- ROAS는 cost=0인 날 0이고, conversion_value가 큰 날 매우 큰 값. 라인이 spike-y해질 수 있음.
- 대응: 그대로 표시. 의도된 변동 (사용자가 보고 싶은 정보).

**4. 메모리 효율**
- 모달 닫힐 때 차트 unmount → recharts 인스턴스 자동 정리. 누수 위험 낮음.

**5. 단일 날짜 모드와의 인터랙션**
- 사용자가 5/1 선택해서 그 날만 보다가 row 클릭 → 차트는 전체 기간 보여줌 (트렌드의 본질이므로 의도된 동작)
- UX 혼란 가능성: 모달 헤더에 "📅 전체 기간 트렌드" 표기로 명시적 알림.

## 비목표 (다시 강조)

이 phase에서 "이거도 추가하면 좋겠는데" 유혹 회피. 다음 우선순위 후보로 따로:

- 두 키워드 비교
- 인라인 sparkline
- 다른 광고 채널 통합 (Meta/Google)
- 검색어 보고서
