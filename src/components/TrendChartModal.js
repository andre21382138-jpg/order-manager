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
