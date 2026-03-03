import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
const DEFAULT_CATEGORIES = ["상의","하의","아우터","신발","가방","액세서리","뷰티","식품","가전","기타"];
const MALL_TYPES = ["자사몰","스마트스토어"];
const MALL_TYPE_COLORS = { "자사몰":"#8B5CF6", "스마트스토어":"#10B981" };

const fmt = (n) => new Intl.NumberFormat("ko-KR").format(n) + "원";
const today = () => new Date().toISOString().slice(0, 10);
const pad = n => String(n).padStart(2,"0");
const emptyItem = () => ({ id: Date.now() + Math.random(), category: "", productName: "", qty: "", amount: "" });

function parseDate(val) {
  if (!val && val !== 0) return today();
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  const s = String(val).trim();
  const m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return today();
}
function num(v) { return Number(String(v ?? "0").replace(/,/g, "")) || 0; }
const norm = s => String(s ?? "").replace(/\s/g, "").toLowerCase();

// ── 엑셀 파서 ──────────────────────────────────────────────
function parseWorkbook(wb, brands) {
  const warnings = [];
  const allOrders = [];
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length < 2) return { orders: [], warnings: ["데이터가 없습니다."] };

  const headers = raw[0].map(h => String(h ?? "").trim());
  warnings.push(`시트 "${sheetName}" 파싱 중 (${raw.length - 1}행)`);

  const colIdx = {};
  const candidates = {
    date:       ["주문일시","날짜","주문날짜","orderdate","date"],
    orderNo:    ["주문번호","주문no","주문id","ordernumber","orderid"],
    product:    ["상품명","상품이름","productname","product","상품"],
    qty:        ["수량","quantity","qty","개수"],
    totalQty:   ["총수량","totalqty","total_qty"],
    payment:    ["결제금액","결제","payment","amount","금액"],
    category:   ["카테고리","category","분류"],
    note:       ["메모","note","비고","memo"],
  };
  for (const [field, cands] of Object.entries(candidates)) {
    const idx = headers.findIndex(h => cands.includes(norm(h)));
    if (idx >= 0) colIdx[field] = idx;
  }

  const get = (row, field) => {
    const i = colIdx[field];
    return i !== undefined ? row[i] ?? "" : "";
  };

  const isFormatA = colIdx.date !== undefined && (() => {
    for (let r = 2; r < Math.min(raw.length, 30); r++) {
      if (!String(raw[r][colIdx.date] ?? "").trim() && String(raw[r][colIdx.product] ?? "").trim()) return true;
    }
    return false;
  })();

  if (isFormatA) {
    let currentOrder = null;
    for (let r = 1; r < raw.length; r++) {
      const row = raw[r];
      const dateVal = get(row, "date");
      const orderNoVal = String(get(row, "orderNo")).trim();
      const productVal = String(get(row, "product")).trim();
      if (!productVal) continue;
      const isNewOrder = !!String(dateVal).trim() || !!orderNoVal;
      if (isNewOrder) {
        if (currentOrder) allOrders.push(currentOrder);
        const paymentAmt = num(get(row, "payment"));
        currentOrder = {
          date: parseDate(dateVal), orderNo: orderNoVal || `R${r+1}`,
          brandId: "", mallType: "",
          note: String(get(row, "note") ?? "").trim(),
          totalAmount: paymentAmt, totalQty: num(get(row, "totalQty")) || num(get(row, "qty")),
          items: [{ id: Date.now()+Math.random(), category: String(get(row,"category")??"").trim(), productName: productVal, qty: num(get(row,"qty"))||1, amount: paymentAmt, _isFirst: true }],
        };
      } else if (currentOrder) {
        if (currentOrder.items.length === 1 && currentOrder.items[0]._isFirst) currentOrder.items[0].amount = 0;
        currentOrder.items.push({ id: Date.now()+Math.random(), category: String(get(row,"category")??"").trim(), productName: productVal, qty: num(get(row,"qty"))||1, amount: 0 });
      }
    }
    if (currentOrder) allOrders.push(currentOrder);
  } else {
    const orderMap = new Map();
    for (let r = 1; r < raw.length; r++) {
      const row = raw[r];
      const productVal = String(get(row, "product")).trim();
      if (!productVal) continue;
      const dateStr = parseDate(get(row, "date"));
      const orderNoVal = String(get(row, "orderNo")).trim() || `R${r+1}`;
      const key = `${dateStr}__${orderNoVal}`;
      if (!orderMap.has(key)) orderMap.set(key, { date: dateStr, orderNo: orderNoVal, brandId: "", mallType: "", note: String(get(row,"note")??"").trim(), totalAmount: num(get(row,"payment")), totalQty: 0, items: [] });
      const order = orderMap.get(key);
      const itemQty = num(get(row,"qty")) || 1;
      order.items.push({ id: Date.now()+Math.random(), category: String(get(row,"category")??"").trim(), productName: productVal, qty: itemQty, amount: num(get(row,"payment")) });
      order.totalQty += itemQty;
    }
    allOrders.push(...orderMap.values());
  }

  allOrders.forEach(o => {
    o.items.forEach(it => { delete it._isFirst; });
    if (!o.totalQty) o.totalQty = o.items.reduce((s,it)=>s+it.qty,0);
    if (!isFormatA) o.totalAmount = o.items.reduce((s,it)=>s+it.amount,0);
  });

  warnings.push(isFormatA ? "✅ 센스바디 형식으로 파싱했습니다." : "✅ 일반 형식으로 파싱했습니다.");
  return { orders: allOrders, warnings };
}

// ── 브랜드 추가 모달 ──────────────────────────────────────
function BrandModal({ onClose, onSave, existingCount }) {
  const [name, setName] = useState("");
  const [mallTypes, setMallTypes] = useState([]);
  const [catInput, setCatInput] = useState("");
  const [cats, setCats] = useState([]);

  function toggleMallType(t) { setMallTypes(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]); }
  function addCat() { const v=catInput.trim(); if(!v||cats.includes(v))return; setCats([...cats,v]); setCatInput(""); }
  function removeCat(c) { setCats(cats.filter(x=>x!==c)); }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={{...modalBox, width:400}} onClick={e=>e.stopPropagation()}>
        <h3 style={modalTitle}>🏷️ 브랜드 추가</h3>

        {/* 브랜드명 */}
        <div style={{marginBottom:18}}>
          <label style={smallLabel}>브랜드명 *</label>
          <input autoFocus value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&name.trim()&&onSave({name:name.trim(),mallTypes,categories:cats})}
            placeholder="예) 센스바디, MYSHOP" style={inp} />
        </div>

        {/* 쇼핑몰 유형 */}
        <div style={{marginBottom:18}}>
          <label style={smallLabel}>쇼핑몰 유형 <span style={{color:"#94A3B8",fontWeight:400}}>(복수 선택 가능)</span></label>
          <div style={{display:"flex",gap:8}}>
            {MALL_TYPES.map(t => {
              const on = mallTypes.includes(t);
              return (
                <button key={t} onClick={()=>toggleMallType(t)} style={{
                  flex:1, padding:"12px 0", borderRadius:12, cursor:"pointer", fontWeight:700, fontSize:14,
                  border: on ? `2px solid ${MALL_TYPE_COLORS[t]}` : "2px solid #E2E8F0",
                  background: on ? MALL_TYPE_COLORS[t]+"15" : "white",
                  color: on ? MALL_TYPE_COLORS[t] : "#94A3B8",
                }}>
                  {t === "자사몰" ? "🏪" : "🛍️"} {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* 카테고리 */}
        <div style={{marginBottom:20}}>
          <label style={smallLabel}>카테고리 <span style={{color:"#94A3B8",fontWeight:400}}>(선택)</span></label>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <input value={catInput} onChange={e=>setCatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),addCat())} placeholder="카테고리 입력 후 Enter" style={{...inp,flex:1}} />
            <button onClick={addCat} style={{padding:"8px 14px",background:"#3B82F6",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13}}>+</button>
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
            {DEFAULT_CATEGORIES.filter(c=>!cats.includes(c)).map(c=>(
              <button key={c} onClick={()=>setCats([...cats,c])} style={{padding:"2px 9px",borderRadius:20,border:"1px dashed #CBD5E1",background:"transparent",cursor:"pointer",fontSize:11,color:"#64748B"}}>+ {c}</button>
            ))}
          </div>
          {cats.length>0&&(
            <div style={{display:"flex",gap:5,flexWrap:"wrap",padding:"9px 11px",background:"#F8FAFC",borderRadius:10,border:"1px solid #E2E8F0"}}>
              {cats.map(c=><span key={c} style={{display:"flex",alignItems:"center",gap:4,background:"#E0F2FE",color:"#0369A1",padding:"3px 9px",borderRadius:20,fontSize:12,fontWeight:600}}>{c}<span onClick={()=>removeCat(c)} style={{cursor:"pointer",fontSize:11,opacity:0.7}}>✕</span></span>)}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>name.trim()&&onSave({name:name.trim(),mallTypes,categories:cats})} style={{...primaryBtn,flex:1,padding:"11px"}}>저장</button>
          <button onClick={onClose} style={{...secondaryBtn,flex:1,padding:"11px"}}>취소</button>
        </div>
      </div>
    </div>
  );
}

// ── 브랜드 편집 모달 ──────────────────────────────────────
function BrandEditModal({ brand, onClose, onSave }) {
  const [mallTypes, setMallTypes] = useState(brand.mallTypes||[]);
  const [catInput, setCatInput] = useState("");
  const [cats, setCats] = useState(brand.categories||[]);

  function toggleMallType(t) { setMallTypes(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev,t]); }
  function addCat() { const v=catInput.trim(); if(!v||cats.includes(v))return; setCats([...cats,v]); setCatInput(""); }
  function removeCat(c) { setCats(cats.filter(x=>x!==c)); }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={{...modalBox, width:400}} onClick={e=>e.stopPropagation()}>
        <h3 style={modalTitle}>✏️ 브랜드 편집</h3>
        <div style={{fontSize:14,color:brand.color,fontWeight:700,marginBottom:18}}>{brand.name}</div>

        <div style={{marginBottom:18}}>
          <label style={smallLabel}>쇼핑몰 유형</label>
          <div style={{display:"flex",gap:8}}>
            {MALL_TYPES.map(t=>{
              const on=mallTypes.includes(t);
              return <button key={t} onClick={()=>toggleMallType(t)} style={{flex:1,padding:"12px 0",borderRadius:12,cursor:"pointer",fontWeight:700,fontSize:14,border:on?`2px solid ${MALL_TYPE_COLORS[t]}`:"2px solid #E2E8F0",background:on?MALL_TYPE_COLORS[t]+"15":"white",color:on?MALL_TYPE_COLORS[t]:"#94A3B8"}}>{t==="자사몰"?"🏪":"🛍️"} {t}</button>;
            })}
          </div>
        </div>

        <div style={{marginBottom:20}}>
          <label style={smallLabel}>카테고리</label>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <input value={catInput} onChange={e=>setCatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),addCat())} placeholder="카테고리 입력" style={{...inp,flex:1}} />
            <button onClick={addCat} style={{padding:"8px 14px",background:"#3B82F6",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontWeight:700,fontSize:13}}>+</button>
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
            {DEFAULT_CATEGORIES.filter(c=>!cats.includes(c)).map(c=>(
              <button key={c} onClick={()=>setCats([...cats,c])} style={{padding:"2px 9px",borderRadius:20,border:"1px dashed #CBD5E1",background:"transparent",cursor:"pointer",fontSize:11,color:"#64748B"}}>+ {c}</button>
            ))}
          </div>
          {cats.length>0&&(
            <div style={{display:"flex",gap:5,flexWrap:"wrap",padding:"9px 11px",background:"#F8FAFC",borderRadius:10,border:"1px solid #E2E8F0"}}>
              {cats.map(c=><span key={c} style={{display:"flex",alignItems:"center",gap:4,background:"#E0F2FE",color:"#0369A1",padding:"3px 9px",borderRadius:20,fontSize:12,fontWeight:600}}>{c}<span onClick={()=>removeCat(c)} style={{cursor:"pointer",fontSize:11,opacity:0.7}}>✕</span></span>)}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>onSave({mallTypes,categories:cats})} style={{...primaryBtn,flex:1,padding:"11px"}}>저장</button>
          <button onClick={onClose} style={{...secondaryBtn,flex:1,padding:"11px"}}>취소</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
export default function App() {
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState("입력");
  const [loaded, setLoaded] = useState(false);

  const [form, setForm] = useState({ date: today(), brandId: "", mallType: "", orderNo: "", note: "" });
  const [items, setItems] = useState([emptyItem()]);

  // 입력 탭 선택 상태
  const [activeBrandId, setActiveBrandId] = useState("");
  const [activeMallType, setActiveMallType] = useState("");

  // 조회/결산 필터
  const [filter, setFilter] = useState({ from: today().slice(0,7)+"-01", to: today(), brandId: "", mallType: "", category: "" });

  const [showBrandModal, setShowBrandModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [expandedOrder, setExpandedOrder] = useState(null);

  const [showXlsxModal, setShowXlsxModal] = useState(false);
  const [xlsxPreview, setXlsxPreview] = useState(null);
  const [xlsxDragOver, setXlsxDragOver] = useState(false);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [sheetNames, setSheetNames] = useState([]);
  const [loadedWb, setLoadedWb] = useState(null);
  // 엑셀 업로드 시 브랜드/몰유형 선택
  const [xlsxBrandId, setXlsxBrandId] = useState("");
  const [xlsxMallType, setXlsxMallType] = useState("");
  const fileInputRef = useRef();

  useEffect(() => {
    try {
      const b = localStorage.getItem("brands");
      const o = localStorage.getItem("orders");
      const c = localStorage.getItem("categories");
      if (b) setBrands(JSON.parse(b));
      if (o) setOrders(JSON.parse(o));
      if (c) setCategories(JSON.parse(c));
    } catch(e) {}
    setLoaded(true);
  }, []);
  useEffect(() => { if(loaded) localStorage.setItem("brands", JSON.stringify(brands)); }, [brands, loaded]);
  useEffect(() => { if(loaded) localStorage.setItem("orders", JSON.stringify(orders)); }, [orders, loaded]);
  useEffect(() => { if(loaded) localStorage.setItem("categories", JSON.stringify(categories)); }, [categories, loaded]);

  // 입력 탭: 브랜드/몰유형 선택 → form 자동 반영
  useEffect(() => {
    setForm(f => ({ ...f, brandId: activeBrandId, mallType: activeMallType }));
    setItems([emptyItem()]);
  }, [activeBrandId, activeMallType]);

  // 브랜드 변경 시 mallType 초기화
  useEffect(() => {
    setActiveMallType("");
  }, [activeBrandId]);

  const getBrand = id => brands.find(b => b.id === id);

  const currentCategories = useMemo(() => {
    const brand = getBrand(form.brandId);
    if (brand?.categories?.length > 0) return brand.categories;
    return categories;
  }, [form.brandId, brands, categories]);

  const filterCategories = useMemo(() => {
    const brand = getBrand(filter.brandId);
    if (brand?.categories?.length > 0) return brand.categories;
    return categories;
  }, [filter.brandId, brands, categories]);

  function addBrand({ name, mallTypes, categories: cats }) {
    setBrands([...brands, { id: Date.now().toString(), name, color: COLORS[brands.length % COLORS.length], mallTypes, categories: cats }]);
    setShowBrandModal(false);
  }
  function deleteBrand(id) {
    if (!window.confirm("브랜드를 삭제하면 해당 주문도 모두 삭제됩니다.")) return;
    setBrands(brands.filter(b => b.id !== id));
    setOrders(orders.filter(o => o.brandId !== id));
  }
  function saveBrandEdit(id, { mallTypes, categories: cats }) {
    setBrands(brands.map(b => b.id === id ? { ...b, mallTypes, categories: cats } : b));
    setEditingBrand(null);
  }
  function addCategory() { if(!newCat.trim()||categories.includes(newCat.trim()))return; setCategories([...categories,newCat.trim()]); setNewCat(""); setShowCatModal(false); }
  function updateItem(idx,field,value) { setItems(items.map((it,i)=>i===idx?{...it,[field]:value}:it)); }
  function addItem() { setItems([...items,emptyItem()]); }
  function removeItem(idx) { if(items.length>1) setItems(items.filter((_,i)=>i!==idx)); }

  function submitOrder(e) {
    e.preventDefault();
    if (!form.brandId) { alert("브랜드를 선택해주세요."); return; }
    if (!form.mallType) { alert("쇼핑몰 유형을 선택해주세요."); return; }
    if (!form.orderNo) { alert("주문번호를 입력해주세요."); return; }
    const validItems = items.filter(it=>it.productName&&it.qty&&it.amount);
    if (validItems.length===0) { alert("상품 정보를 최소 1개 이상 입력해주세요."); return; }
    const parsed = validItems.map(it=>({...it,qty:Number(it.qty),amount:Number(it.amount)}));
    setOrders([...orders, { ...form, id: Date.now().toString(), items: parsed, totalAmount: parsed.reduce((s,it)=>s+it.amount,0), totalQty: parsed.reduce((s,it)=>s+it.qty,0) }]);
    setForm({...form, orderNo:"", note:""});
    setItems([emptyItem()]);
  }
  function deleteOrder(id) { setOrders(orders.filter(o=>o.id!==id)); }

  // 엑셀 업로드
  function loadFile(file) {
    setXlsxLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type:"array", cellDates:false });
        setLoadedWb(wb); setSheetNames(wb.SheetNames);
        if (wb.SheetNames.length===1) { parseSheet(wb, wb.SheetNames[0]); }
        else { setSelectedSheet(wb.SheetNames[0]); setXlsxPreview(null); setXlsxLoading(false); }
      } catch(err) { alert("파일 읽기 오류: "+err.message); setXlsxLoading(false); }
    };
    reader.readAsArrayBuffer(file);
  }
  function parseSheet(wb, sheet) {
    setXlsxLoading(true);
    try {
      const wbCopy = { SheetNames:[sheet], Sheets:{ [sheet]: wb.Sheets[sheet] } };
      const { orders: parsed, warnings } = parseWorkbook(wbCopy, brands);
      setXlsxPreview({ rows: parsed.map(o=>({...o,selected:true})), warnings });
      setSelectedSheet(sheet);
    } catch(err) { alert("파싱 오류: "+err.message); }
    setXlsxLoading(false);
  }
  function handleFileDrop(e) {
    e.preventDefault(); setXlsxDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) { setLoadedWb(null); setSheetNames([]); setXlsxPreview(null); loadFile(file); }
  }
  function toggleSelectRow(idx) { setXlsxPreview(prev=>({...prev,rows:prev.rows.map((r,i)=>i===idx?{...r,selected:!r.selected}:r)})); }
  function toggleSelectAll() {
    const all = xlsxPreview.rows.every(r=>r.selected);
    setXlsxPreview(prev=>({...prev,rows:prev.rows.map(r=>({...r,selected:!all}))}));
  }
  function importXlsx() {
    if (!xlsxBrandId) { alert("가져올 브랜드를 선택해주세요."); return; }
    if (!xlsxMallType) { alert("쇼핑몰 유형을 선택해주세요."); return; }
    const toImport = xlsxPreview.rows.filter(r=>r.selected);
    if (toImport.length===0) { alert("가져올 주문을 선택해주세요."); return; }
    const existingKeys = new Set(orders.map(o=>`${o.date}__${o.orderNo}__${o.brandId}__${o.mallType}`));
    const newOrders = toImport
      .filter(o=>!existingKeys.has(`${o.date}__${o.orderNo}__${xlsxBrandId}__${xlsxMallType}`))
      .map(o=>({...o, id: Date.now().toString()+Math.random(), brandId: xlsxBrandId, mallType: xlsxMallType }));
    const skipped = toImport.length - newOrders.length;
    setOrders(prev=>[...prev,...newOrders]);
    setXlsxPreview(null); setShowXlsxModal(false); setLoadedWb(null); setSheetNames([]);
    alert(`✅ ${newOrders.length}건 가져오기 완료${skipped>0?`\n(중복 ${skipped}건 건너뜀)`:""}`);
  }

  // 필터링
  const filtered = useMemo(() => orders.filter(o =>
    o.date >= filter.from && o.date <= filter.to
    && (!filter.brandId || o.brandId === filter.brandId)
    && (!filter.mallType || o.mallType === filter.mallType)
    && (!filter.category || o.items.some(it=>it.category===filter.category))
  ), [orders, filter]);

  const stats = useMemo(() => {
    let totalAmount=0, totalQty=0;
    const byBrand={}, byMallType={}, byCategory={}, byDate={};
    filtered.forEach(o => {
      totalAmount+=o.totalAmount; totalQty+=o.totalQty;
      if(!byBrand[o.brandId]) byBrand[o.brandId]={count:0,qty:0,amount:0,byMallType:{}};
      byBrand[o.brandId].count++; byBrand[o.brandId].qty+=o.totalQty; byBrand[o.brandId].amount+=o.totalAmount;
      if(!byBrand[o.brandId].byMallType[o.mallType]) byBrand[o.brandId].byMallType[o.mallType]={count:0,amount:0};
      byBrand[o.brandId].byMallType[o.mallType].count++; byBrand[o.brandId].byMallType[o.mallType].amount+=o.totalAmount;
      if(!byMallType[o.mallType]) byMallType[o.mallType]={count:0,qty:0,amount:0};
      byMallType[o.mallType].count++; byMallType[o.mallType].qty+=o.totalQty; byMallType[o.mallType].amount+=o.totalAmount;
      if(!byDate[o.date]) byDate[o.date]={count:0,qty:0,amount:0};
      byDate[o.date].count++; byDate[o.date].qty+=o.totalQty; byDate[o.date].amount+=o.totalAmount;
      o.items.forEach(it => {
        const cat=it.category||"미분류";
        if(!byCategory[cat]) byCategory[cat]={qty:0,amount:0,count:0};
        byCategory[cat].qty+=it.qty; byCategory[cat].amount+=it.amount; byCategory[cat].count++;
      });
    });
    return { totalAmount, totalQty, totalOrders:filtered.length, byBrand, byMallType, byCategory, byDate };
  }, [filtered]);

  const todayOrders = useMemo(() => orders
    .filter(o => o.date===form.date && (!activeBrandId||o.brandId===activeBrandId) && (!activeMallType||o.mallType===activeMallType))
    .sort((a,b)=>b.id.localeCompare(a.id)),
    [orders, form.date, activeBrandId, activeMallType]);

  // 현재 선택된 브랜드의 사용 가능한 몰 유형
  const activeBrand = getBrand(activeBrandId);
  const availableMallTypes = activeBrand?.mallTypes?.length > 0 ? activeBrand.mallTypes : MALL_TYPES;

  if (!loaded) return <div style={centerStyle}>로딩 중...</div>;

  return (
    <div style={{ minHeight:"100vh", background:"#F0F4F8", fontFamily:"'Apple SD Gothic Neo','Pretendard',sans-serif" }}>
      {/* Header */}
      <div style={{ background:"#1E293B", color:"white", padding:"0 24px" }}>
        <div style={{ maxWidth:1200, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:60 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:20, fontWeight:800 }}>🛒 주문관리</span>
            <span style={{ fontSize:12, color:"#94A3B8" }}>멀티브랜드 통합 대시보드</span>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {["입력","조회","결산"].map(t => (
              <button key={t} onClick={()=>setTab(t)} style={{ padding:"7px 20px", borderRadius:8, border:"none", cursor:"pointer", fontSize:14, fontWeight:600, background:tab===t?"#3B82F6":"transparent", color:tab===t?"white":"#94A3B8" }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1200, margin:"0 auto", padding:"20px 16px" }}>

        {/* 브랜드 & 기본 카테고리 관리 바 */}
        <div style={{ background:"white", borderRadius:14, padding:"14px 18px", marginBottom:18, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:10 }}>
            <span style={labelStyle}>브랜드</span>
            {brands.map(b => (
              <div key={b.id} style={{ display:"flex", alignItems:"center" }}>
                <span style={{ display:"flex", alignItems:"center", gap:5, background:b.color+"18", border:`1px solid ${b.color}40`, color:b.color, padding:"3px 8px 3px 10px", borderRadius:"20px 0 0 20px", fontSize:12, fontWeight:700 }}>
                  {b.name}
                  {b.mallTypes?.length>0 && b.mallTypes.map(t=>(
                    <span key={t} style={{ fontSize:10, background:MALL_TYPE_COLORS[t]+"25", color:MALL_TYPE_COLORS[t], padding:"1px 5px", borderRadius:8 }}>{t}</span>
                  ))}
                </span>
                <button onClick={()=>setEditingBrand(b)} style={{ background:b.color+"18", border:`1px solid ${b.color}40`, borderLeft:"none", padding:"3px 5px", cursor:"pointer", fontSize:11 }}>✏️</button>
                <button onClick={()=>deleteBrand(b.id)} style={{ background:b.color+"18", border:`1px solid ${b.color}40`, borderLeft:"none", padding:"3px 6px", borderRadius:"0 20px 20px 0", cursor:"pointer", fontSize:11, color:b.color, opacity:0.7 }}>✕</button>
              </div>
            ))}
            <button onClick={()=>setShowBrandModal(true)} style={addChipBtn}>+ 브랜드 추가</button>
          </div>
          <div style={{ height:1, background:"#F1F5F9", margin:"8px 0" }} />
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{...labelStyle, color:"#94A3B8", fontSize:11}}>기본 카테고리</span>
            {categories.map(c=><Chip key={c} label={c} color="#64748B" onDelete={()=>setCategories(categories.filter(x=>x!==c))} />)}
            <button onClick={()=>setShowCatModal(true)} style={addChipBtn}>+ 추가</button>
          </div>
        </div>

        {/* ── 입력 탭 ── */}
        {tab==="입력" && (
          <div>
            {/* STEP 1: 브랜드 선택 */}
            <div style={{ background:"white", borderRadius:14, padding:"16px 20px", marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#64748B", marginBottom:10 }}>
                STEP 1 · 브랜드 선택
              </div>
              {brands.length===0 ? (
                <div style={{ fontSize:13, color:"#CBD5E1" }}>브랜드를 먼저 추가해주세요.</div>
              ) : (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {brands.map(b => {
                    const isActive = activeBrandId===b.id;
                    const cnt = orders.filter(o=>o.brandId===b.id&&o.date===form.date).length;
                    return (
                      <button key={b.id} onClick={()=>setActiveBrandId(isActive?"":b.id)} style={{
                        display:"flex", flexDirection:"column", alignItems:"flex-start",
                        padding:"10px 16px", borderRadius:12, cursor:"pointer", minWidth:100,
                        border: isActive?`2px solid ${b.color}`:"2px solid #E2E8F0",
                        background: isActive?b.color+"12":"white",
                      }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                          <div style={{ width:8, height:8, borderRadius:"50%", background:b.color }} />
                          <span style={{ fontSize:14, fontWeight:700, color:isActive?b.color:"#1E293B" }}>{b.name}</span>
                        </div>
                        <span style={{ fontSize:11, color:"#94A3B8" }}>오늘 {cnt}건</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* STEP 2: 쇼핑몰 유형 선택 (브랜드 선택 후) */}
            {activeBrandId && (
              <div style={{ background:"white", borderRadius:14, padding:"16px 20px", marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#64748B", marginBottom:10 }}>
                  STEP 2 · 쇼핑몰 유형 선택
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {availableMallTypes.map(t => {
                    const isActive = activeMallType===t;
                    const cnt = orders.filter(o=>o.brandId===activeBrandId&&o.mallType===t&&o.date===form.date).length;
                    return (
                      <button key={t} onClick={()=>setActiveMallType(isActive?"":t)} style={{
                        display:"flex", flexDirection:"column", alignItems:"flex-start",
                        padding:"10px 20px", borderRadius:12, cursor:"pointer", minWidth:120,
                        border: isActive?`2px solid ${MALL_TYPE_COLORS[t]}`:"2px solid #E2E8F0",
                        background: isActive?MALL_TYPE_COLORS[t]+"12":"white",
                      }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                          <span style={{ fontSize:15 }}>{t==="자사몰"?"🏪":"🛍️"}</span>
                          <span style={{ fontSize:14, fontWeight:700, color:isActive?MALL_TYPE_COLORS[t]:"#1E293B" }}>{t}</span>
                        </div>
                        <span style={{ fontSize:11, color:"#94A3B8" }}>오늘 {cnt}건</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* STEP 3: 입력 + 오늘 주문 */}
            <div style={{ display:"grid", gridTemplateColumns:"1.15fr 1fr", gap:18 }}>
              <div style={card}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div>
                    <h2 style={{...cardTitle, marginBottom:2}}>📦 주문 입력</h2>
                    {activeBrandId && activeMallType && (
                      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                        <span style={{ fontSize:11, padding:"2px 8px", borderRadius:10, background:getBrand(activeBrandId)?.color+"20", color:getBrand(activeBrandId)?.color, fontWeight:700 }}>{getBrand(activeBrandId)?.name}</span>
                        <span style={{ fontSize:11, padding:"2px 8px", borderRadius:10, background:MALL_TYPE_COLORS[activeMallType]+"20", color:MALL_TYPE_COLORS[activeMallType], fontWeight:700 }}>{activeMallType}</span>
                      </div>
                    )}
                  </div>
                  <button onClick={()=>{ setXlsxBrandId(activeBrandId); setXlsxMallType(activeMallType); setXlsxPreview(null); setLoadedWb(null); setSheetNames([]); setShowXlsxModal(true); }} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:8, border:"1px solid #BFDBFE", background:"#EFF6FF", color:"#3B82F6", cursor:"pointer", fontSize:13, fontWeight:700 }}>
                    <span>📊</span> 엑셀 업로드
                  </button>
                </div>
                <form onSubmit={submitOrder}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1.3fr", gap:10, marginBottom:14 }}>
                    <Field label="날짜 *"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={inp} /></Field>
                    <Field label="주문번호 *"><input placeholder="예) 776904" value={form.orderNo} onChange={e=>setForm({...form,orderNo:e.target.value})} style={inp} /></Field>
                  </div>
                  {(!activeBrandId||!activeMallType) && (
                    <div style={{ padding:"10px 14px", background:"#FFFBEB", borderRadius:10, border:"1px solid #FCD34D", fontSize:12, color:"#78350F", marginBottom:12 }}>
                      ⚠️ 위에서 브랜드와 쇼핑몰 유형을 먼저 선택해주세요.
                    </div>
                  )}
                  <div style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:"#64748B" }}>상품 목록 *</span>
                      <button type="button" onClick={addItem} style={addItemBtn}>+ 상품 추가</button>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"110px 1fr 68px 105px 26px", gap:6, marginBottom:5 }}>
                      {["카테고리","상품명","수량","결제금액",""].map((h,i)=><span key={i} style={{ fontSize:11, color:"#94A3B8", fontWeight:700 }}>{h}</span>)}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {items.map((it,idx)=>(
                        <div key={it.id} style={{ display:"grid", gridTemplateColumns:"110px 1fr 68px 105px 26px", gap:6, alignItems:"center" }}>
                          <select value={it.category} onChange={e=>updateItem(idx,"category",e.target.value)} style={{...inp,fontSize:12}}>
                            <option value="">카테고리</option>
                            {currentCategories.map(c=><option key={c} value={c}>{c}</option>)}
                          </select>
                          <input placeholder="상품명 *" value={it.productName} onChange={e=>updateItem(idx,"productName",e.target.value)} style={{...inp,fontSize:12}} />
                          <input type="number" min="1" placeholder="수량" value={it.qty} onChange={e=>updateItem(idx,"qty",e.target.value)} style={{...inp,fontSize:12}} />
                          <input type="number" min="0" placeholder="금액" value={it.amount} onChange={e=>updateItem(idx,"amount",e.target.value)} style={{...inp,fontSize:12}} />
                          <button type="button" onClick={()=>removeItem(idx)} style={{ background:"none",border:"none",cursor:items.length===1?"not-allowed":"pointer",color:items.length===1?"#E2E8F0":"#EF4444",fontSize:17,padding:0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                    {items.some(it=>Number(it.amount)>0) && (
                      <div style={{ marginTop:10,padding:"9px 12px",background:"#F1F5F9",borderRadius:8,display:"flex",justifyContent:"space-between",fontSize:13 }}>
                        <span style={{ color:"#64748B" }}>상품 {items.filter(it=>it.productName).length}종 · 수량 {items.reduce((s,it)=>s+(Number(it.qty)||0),0)}개</span>
                        <span style={{ fontWeight:800,color:"#1E293B" }}>합계 {fmt(items.reduce((s,it)=>s+(Number(it.amount)||0),0))}</span>
                      </div>
                    )}
                  </div>
                  <Field label="메모"><input placeholder="배송 메모, 옵션 등" value={form.note} onChange={e=>setForm({...form,note:e.target.value})} style={inp} /></Field>
                  <button type="submit" style={{ marginTop:14,width:"100%",padding:"13px",background:"#3B82F6",color:"white",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:"pointer" }}>+ 주문 저장</button>
                </form>
              </div>

              <div style={card}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <h2 style={{...cardTitle,marginBottom:0}}>📋 오늘 주문 목록</h2>
                  <span style={{ fontSize:12, color:"#94A3B8" }}>{form.date}</span>
                </div>
                {todayOrders.length===0 ? <Empty text="오늘 등록된 주문이 없습니다" /> : <>
                  <div style={{ background:"#F1F5F9",borderRadius:10,padding:"9px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",fontSize:13 }}>
                    <span style={{ color:"#64748B" }}>총 {todayOrders.length}건 · {todayOrders.reduce((s,o)=>s+o.totalQty,0)}개</span>
                    <span style={{ fontWeight:700,color:"#1E293B" }}>{fmt(todayOrders.reduce((s,o)=>s+o.totalAmount,0))}</span>
                  </div>
                  <OrderList orders={todayOrders} expandedOrder={expandedOrder} setExpandedOrder={setExpandedOrder} getBrand={getBrand} deleteOrder={deleteOrder} fmt={fmt} />
                </>}
              </div>
            </div>
          </div>
        )}

        {/* ── 조회/결산 공통 필터 ── */}
        {(tab==="조회"||tab==="결산") && (
          <>
            {/* 브랜드 선택 바 */}
            <div style={{ background:"white", borderRadius:14, padding:"16px 20px", marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#64748B", marginBottom:10 }}>🏷️ 브랜드 선택</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button onClick={()=>setFilter(f=>({...f,brandId:"",mallType:"",category:""}))} style={{
                  display:"flex", flexDirection:"column", alignItems:"flex-start", padding:"10px 16px", borderRadius:12, cursor:"pointer", minWidth:80,
                  border: filter.brandId===""?"2px solid #1E293B":"2px solid #E2E8F0",
                  background: filter.brandId===""?"#1E293B10":"white",
                }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:"#64748B" }} />
                    <span style={{ fontSize:14, fontWeight:700, color: filter.brandId===""?"#1E293B":"#64748B" }}>전체</span>
                  </div>
                  <span style={{ fontSize:11, color:"#94A3B8" }}>{orders.filter(o=>o.date>=filter.from&&o.date<=filter.to).length}건</span>
                </button>
                {brands.map(b => {
                  const isActive = filter.brandId===b.id;
                  const cnt = orders.filter(o=>o.brandId===b.id&&o.date>=filter.from&&o.date<=filter.to).length;
                  return (
                    <button key={b.id} onClick={()=>setFilter(f=>({...f,brandId:isActive?"":b.id,mallType:"",category:""}))} style={{
                      display:"flex", flexDirection:"column", alignItems:"flex-start", padding:"10px 16px", borderRadius:12, cursor:"pointer", minWidth:80,
                      border: isActive?`2px solid ${b.color}`:"2px solid #E2E8F0",
                      background: isActive?b.color+"12":"white",
                    }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:b.color }} />
                        <span style={{ fontSize:14, fontWeight:700, color:isActive?b.color:"#1E293B" }}>{b.name}</span>
                      </div>
                      <span style={{ fontSize:11, color:"#94A3B8" }}>{cnt}건</span>
                    </button>
                  );
                })}
              </div>

              {/* 쇼핑몰 유형 탭 (브랜드 선택 시) */}
              {filter.brandId && (
                <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #F1F5F9" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8", marginBottom:8 }}>쇼핑몰 유형</div>
                  <div style={{ display:"flex", gap:6 }}>
                    {/* 합산 */}
                    <button onClick={()=>setFilter(f=>({...f,mallType:""}))} style={{
                      padding:"6px 16px", borderRadius:20, cursor:"pointer", fontSize:13, fontWeight:700,
                      border: filter.mallType===""?"2px solid #1E293B":"2px solid #E2E8F0",
                      background: filter.mallType===""?"#1E293B":"white",
                      color: filter.mallType===""?"white":"#64748B",
                    }}>전체 합산</button>
                    {MALL_TYPES.map(t => {
                      const isActive = filter.mallType===t;
                      const cnt = orders.filter(o=>o.brandId===filter.brandId&&o.mallType===t&&o.date>=filter.from&&o.date<=filter.to).length;
                      return (
                        <button key={t} onClick={()=>setFilter(f=>({...f,mallType:isActive?"":t}))} style={{
                          padding:"6px 16px", borderRadius:20, cursor:"pointer", fontSize:13, fontWeight:700,
                          border: isActive?`2px solid ${MALL_TYPE_COLORS[t]}`:"2px solid #E2E8F0",
                          background: isActive?MALL_TYPE_COLORS[t]:"white",
                          color: isActive?"white":"#64748B",
                        }}>
                          {t==="자사몰"?"🏪":"🛍️"} {t} ({cnt}건)
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 기간 & 카테고리 필터 */}
            <div style={{...card,padding:"14px 20px",marginBottom:14,display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
              <Field label="시작일"><input type="date" value={filter.from} onChange={e=>setFilter({...filter,from:e.target.value})} style={{...inp,width:130}} /></Field>
              <Field label="종료일"><input type="date" value={filter.to} onChange={e=>setFilter({...filter,to:e.target.value})} style={{...inp,width:130}} /></Field>
              <Field label="카테고리">
                <select value={filter.category} onChange={e=>setFilter({...filter,category:e.target.value})} style={{...inp,width:120}}>
                  <option value="">전체</option>
                  {filterCategories.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <div style={{ display:"flex",gap:6 }}>
                {[
                  ["이번달",()=>{const n=new Date();setFilter(f=>({...f,from:`${n.getFullYear()}-${pad(n.getMonth()+1)}-01`,to:today()}));}],
                  ["저번달",()=>{const n=new Date();n.setMonth(n.getMonth()-1);const y=n.getFullYear(),m=n.getMonth()+1,last=new Date(y,m,0).getDate();setFilter(f=>({...f,from:`${y}-${pad(m)}-01`,to:`${y}-${pad(m)}-${last}`}));}],
                  ["올해",()=>{setFilter(f=>({...f,from:`${new Date().getFullYear()}-01-01`,to:today()}));}],
                ].map(([l,fn])=><button key={l} onClick={fn} style={quickBtn}>{l}</button>)}
              </div>
            </div>

            {/* 요약 통계 카드 */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14 }}>
              {[
                {label:"총 매출",val:fmt(stats.totalAmount),icon:"💰",color:"#3B82F6"},
                {label:"주문 수",val:`${stats.totalOrders}건`,icon:"📦",color:"#10B981"},
                {label:"총 수량",val:`${stats.totalQty}개`,icon:"📊",color:"#F59E0B"},
                {label:"주문당 평균",val:stats.totalOrders>0?fmt(Math.round(stats.totalAmount/stats.totalOrders)):"-",icon:"📈",color:"#8B5CF6"},
              ].map(k=>(
                <div key={k.label} style={{...card,padding:"15px 18px",borderLeft:`4px solid ${k.color}`}}>
                  <div style={{fontSize:12,color:"#94A3B8",fontWeight:600,marginBottom:4}}>{k.icon} {k.label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:"#1E293B"}}>{k.val}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 조회 탭 */}
        {tab==="조회" && (
          <div style={card}>
            <h2 style={{...cardTitle,marginBottom:14}}>주문 목록 ({filtered.length}건)</h2>
            {filtered.length===0 ? <Empty text="해당 기간에 주문이 없습니다" /> :
              <OrderList orders={[...filtered].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id))} expandedOrder={expandedOrder} setExpandedOrder={setExpandedOrder} getBrand={getBrand} deleteOrder={deleteOrder} fmt={fmt} showDate />}
          </div>
        )}

        {/* 결산 탭 */}
        {tab==="결산" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
            {/* 브랜드별 결산 */}
            <div style={card}>
              <h2 style={{...cardTitle,marginBottom:14}}>🏷️ 브랜드별 결산</h2>
              {brands.length===0 ? <Empty text="브랜드가 없습니다" /> :
                brands.map(b => {
                  const s = stats.byBrand[b.id]||{count:0,qty:0,amount:0,byMallType:{}};
                  const pct = stats.totalAmount>0?(s.amount/stats.totalAmount*100).toFixed(1):0;
                  return (
                    <div key={b.id} style={{padding:"12px 14px",borderRadius:12,background:"#F8FAFC",border:"1px solid #F1F5F9",marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <span style={{fontWeight:700,color:b.color,fontSize:14}}>{b.name}</span>
                        <span style={{fontWeight:800,fontSize:15,color:"#1E293B"}}>{fmt(s.amount)}</span>
                      </div>
                      <div style={{height:5,background:"#E2E8F0",borderRadius:3,marginBottom:6}}>
                        <div style={{height:"100%",width:`${pct}%`,background:b.color,borderRadius:3}}/>
                      </div>
                      {/* 몰유형별 소계 */}
                      <div style={{display:"flex",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                        {MALL_TYPES.map(t => {
                          const ms = s.byMallType[t];
                          if (!ms) return null;
                          return <span key={t} style={{fontSize:11,padding:"2px 7px",borderRadius:10,background:MALL_TYPE_COLORS[t]+"15",color:MALL_TYPE_COLORS[t],fontWeight:600}}>{t} {fmt(ms.amount)}</span>;
                        })}
                      </div>
                      <div style={{display:"flex",gap:10,fontSize:12,color:"#64748B"}}>
                        <span>주문 {s.count}건</span><span>수량 {s.qty}개</span>
                        <span style={{color:b.color,fontWeight:700}}>{pct}%</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* 카테고리별 결산 */}
            <div style={card}>
              <h2 style={{...cardTitle,marginBottom:14}}>🏷️ 카테고리별 결산</h2>
              {Object.keys(stats.byCategory).length===0 ? <Empty text="데이터가 없습니다" /> :
                Object.entries(stats.byCategory).sort((a,b)=>b[1].amount-a[1].amount).map(([cat,s])=>{
                  const pct=stats.totalAmount>0?(s.amount/stats.totalAmount*100).toFixed(1):0;
                  return (
                    <div key={cat} style={{padding:"12px 14px",borderRadius:12,background:"#F8FAFC",border:"1px solid #F1F5F9",marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <span style={{fontWeight:700,color:"#475569",fontSize:14}}>{cat}</span>
                        <span style={{fontWeight:800,fontSize:15,color:"#1E293B"}}>{fmt(s.amount)}</span>
                      </div>
                      <div style={{height:5,background:"#E2E8F0",borderRadius:3,marginBottom:6}}>
                        <div style={{height:"100%",width:`${pct}%`,background:"#8B5CF6",borderRadius:3}}/>
                      </div>
                      <div style={{display:"flex",gap:10,fontSize:12,color:"#64748B"}}>
                        <span>상품 {s.count}건</span><span>수량 {s.qty}개</span>
                        <span style={{color:"#8B5CF6",fontWeight:700}}>{pct}%</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* 일별 결산 */}
            <div style={card}>
              <h2 style={{...cardTitle,marginBottom:14}}>📅 일별 결산</h2>
              {Object.keys(stats.byDate).length===0 ? <Empty text="데이터가 없습니다" /> :
                <div style={{overflowY:"auto",maxHeight:520}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead><tr style={{borderBottom:"2px solid #F1F5F9"}}>{["날짜","주문","수량","매출"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:h==="날짜"?"left":"right",color:"#94A3B8",fontWeight:700,fontSize:12}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {Object.entries(stats.byDate).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,s])=>(
                        <tr key={date} style={{borderBottom:"1px solid #F8FAFC"}}>
                          <td style={{padding:"8px",fontWeight:600,color:"#475569"}}>{date}</td>
                          <td style={{padding:"8px",textAlign:"right",color:"#64748B"}}>{s.count}건</td>
                          <td style={{padding:"8px",textAlign:"right",color:"#64748B"}}>{s.qty}개</td>
                          <td style={{padding:"8px",textAlign:"right",fontWeight:700,color:"#1E293B"}}>{fmt(s.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:"2px solid #F1F5F9",background:"#F8FAFC"}}>
                        <td style={{padding:"8px",fontWeight:800}}>합계</td>
                        <td style={{padding:"8px",textAlign:"right",fontWeight:800}}>{stats.totalOrders}건</td>
                        <td style={{padding:"8px",textAlign:"right",fontWeight:800}}>{stats.totalQty}개</td>
                        <td style={{padding:"8px",textAlign:"right",fontWeight:800,color:"#3B82F6"}}>{fmt(stats.totalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>}
            </div>
          </div>
        )}
      </div>

      {/* 엑셀 업로드 모달 */}
      {showXlsxModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:20}} onClick={()=>{if(!xlsxPreview&&!xlsxLoading)setShowXlsxModal(false);}}>
          <div style={{background:"white",borderRadius:20,width:"min(960px,96vw)",maxHeight:"92vh",display:"flex",flexDirection:"column",boxShadow:"0 25px 80px rgba(0,0,0,0.25)"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"20px 24px",borderBottom:"1px solid #F1F5F9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <h2 style={{margin:0,fontSize:18,fontWeight:800,color:"#1E293B"}}>📊 엑셀 파일 업로드</h2>
                <p style={{margin:"3px 0 0",fontSize:13,color:"#94A3B8"}}>{xlsxPreview?`${xlsxPreview.rows.length}건 파싱 완료`:sheetNames.length>1?"시트를 선택하세요":".xlsx, .xls 파일을 업로드하세요"}</p>
              </div>
              <button onClick={()=>setShowXlsxModal(false)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94A3B8"}}>✕</button>
            </div>

            <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
              {/* 브랜드 & 몰유형 선택 */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20,padding:"14px 16px",background:"#F8FAFC",borderRadius:12,border:"1px solid #E2E8F0"}}>
                <div>
                  <label style={{...smallLabel,marginBottom:8}}>브랜드 선택 *</label>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {brands.map(b=>(
                      <button key={b.id} onClick={()=>setXlsxBrandId(b.id)} style={{padding:"6px 14px",borderRadius:20,cursor:"pointer",fontSize:13,fontWeight:700,border:xlsxBrandId===b.id?`2px solid ${b.color}`:"2px solid #E2E8F0",background:xlsxBrandId===b.id?b.color+"15":"white",color:xlsxBrandId===b.id?b.color:"#64748B"}}>{b.name}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{...smallLabel,marginBottom:8}}>쇼핑몰 유형 선택 *</label>
                  <div style={{display:"flex",gap:6}}>
                    {MALL_TYPES.map(t=>(
                      <button key={t} onClick={()=>setXlsxMallType(t)} style={{padding:"6px 14px",borderRadius:20,cursor:"pointer",fontSize:13,fontWeight:700,border:xlsxMallType===t?`2px solid ${MALL_TYPE_COLORS[t]}`:"2px solid #E2E8F0",background:xlsxMallType===t?MALL_TYPE_COLORS[t]+"15":"white",color:xlsxMallType===t?MALL_TYPE_COLORS[t]:"#64748B"}}>{t}</button>
                    ))}
                  </div>
                </div>
              </div>

              {!loadedWb && !xlsxPreview && (
                <>
                  <div onDragOver={e=>{e.preventDefault();setXlsxDragOver(true);}} onDragLeave={()=>setXlsxDragOver(false)} onDrop={handleFileDrop} onClick={()=>fileInputRef.current.click()}
                    style={{border:`2px dashed ${xlsxDragOver?"#3B82F6":"#CBD5E1"}`,borderRadius:16,padding:"40px 24px",textAlign:"center",cursor:"pointer",background:xlsxDragOver?"#EFF6FF":"#F8FAFC",marginBottom:16}}>
                    {xlsxLoading?<div style={{fontSize:14,color:"#64748B"}}>⏳ 파일 읽는 중...</div>:<><div style={{fontSize:36,marginBottom:10}}>📂</div><div style={{fontSize:15,fontWeight:700,color:"#1E293B",marginBottom:4}}>파일을 드래그하거나 클릭해서 선택</div><div style={{fontSize:13,color:"#94A3B8"}}>.xlsx, .xls 파일 지원</div></>}
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){setLoadedWb(null);setSheetNames([]);setXlsxPreview(null);loadFile(e.target.files[0]);}}} />
                  </div>
                  <div style={{background:"#EFF6FF",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#1E40AF",border:"1px solid #BFDBFE"}}>
                    💡 센스바디 형식(다상품 주문 연속행) 자동 지원
                  </div>
                </>
              )}

              {loadedWb&&sheetNames.length>1&&!xlsxPreview&&(
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"#1E293B",marginBottom:14}}>{sheetNames.length}개 시트 발견 · 가져올 시트 선택</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                    {sheetNames.map(name=>(
                      <button key={name} onClick={()=>parseSheet(loadedWb,name)} style={{padding:"14px 16px",borderRadius:12,border:`2px solid ${selectedSheet===name?"#3B82F6":"#E2E8F0"}`,background:selectedSheet===name?"#EFF6FF":"white",cursor:"pointer",textAlign:"left",fontWeight:700,fontSize:14,color:selectedSheet===name?"#1D4ED8":"#1E293B"}}>
                        📋 {name}
                      </button>
                    ))}
                  </div>
                  {xlsxLoading&&<div style={{marginTop:16,textAlign:"center",color:"#64748B"}}>⏳ 파싱 중...</div>}
                </div>
              )}

              {xlsxPreview&&(
                <>
                  {xlsxPreview.warnings.length>0&&(
                    <div style={{marginBottom:14,display:"flex",flexDirection:"column",gap:6}}>
                      {xlsxPreview.warnings.map((w,i)=>(
                        <div key={i} style={{padding:"10px 14px",borderRadius:10,fontSize:12,background:w.startsWith("✅")?"#F0FDF4":"#FFFBEB",border:w.startsWith("✅")?"1px solid #BBF7D0":"1px solid #FCD34D",color:w.startsWith("✅")?"#166534":"#78350F"}}>{w}</div>
                      ))}
                    </div>
                  )}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <input type="checkbox" checked={xlsxPreview.rows.every(r=>r.selected)} onChange={toggleSelectAll} style={{width:15,height:15,cursor:"pointer"}} />
                      <span style={{fontSize:13,fontWeight:600,color:"#475569"}}>전체 선택 ({xlsxPreview.rows.filter(r=>r.selected).length}/{xlsxPreview.rows.length}건)</span>
                    </div>
                    <button onClick={()=>setXlsxPreview(null)} style={{fontSize:12,color:"#64748B",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>다른 파일 선택</button>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:360,overflowY:"auto"}}>
                    {xlsxPreview.rows.map((o,idx)=>(
                      <div key={idx} onClick={()=>toggleSelectRow(idx)} style={{padding:"10px 14px",borderRadius:11,border:`1.5px solid ${o.selected?"#BFDBFE":"#E2E8F0"}`,background:o.selected?"#F0F7FF":"white",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                        <input type="checkbox" checked={o.selected} onChange={()=>toggleSelectRow(idx)} onClick={e=>e.stopPropagation()} style={{width:15,height:15,cursor:"pointer",flexShrink:0}} />
                        <span style={{fontSize:12,color:"#94A3B8",whiteSpace:"nowrap",flexShrink:0}}>{o.date}</span>
                        <span style={{fontSize:11,color:"#94A3B8",fontFamily:"monospace",flexShrink:0}}>{o.orderNo}</span>
                        <span style={{fontSize:13,color:"#475569",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.items.slice(0,2).map(it=>it.productName).join(", ")}{o.items.length>2&&` 외 ${o.items.length-2}종`}</span>
                        <span style={{fontSize:12,color:"#94A3B8",whiteSpace:"nowrap",flexShrink:0}}>{o.items.length}종 {o.totalQty}개</span>
                        <span style={{fontSize:14,fontWeight:800,color:"#1E293B",whiteSpace:"nowrap",flexShrink:0}}>{fmt(o.totalAmount)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div style={{padding:"16px 24px",borderTop:"1px solid #F1F5F9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,color:"#94A3B8"}}>
                {xlsxPreview&&`총 ${fmt(xlsxPreview.rows.filter(r=>r.selected).reduce((s,o)=>s+o.totalAmount,0))} · ${xlsxPreview.rows.filter(r=>r.selected).reduce((s,o)=>s+o.totalQty,0)}개 선택됨`}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setShowXlsxModal(false)} style={secondaryBtn}>닫기</button>
                {xlsxPreview&&<button onClick={importXlsx} style={{...primaryBtn,padding:"10px 28px",fontSize:14}}>✅ {xlsxPreview.rows.filter(r=>r.selected).length}건 가져오기</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 브랜드 추가 모달 */}
      {showBrandModal && <BrandModal onClose={()=>setShowBrandModal(false)} onSave={addBrand} existingCount={brands.length} />}

      {/* 브랜드 편집 모달 */}
      {editingBrand && <BrandEditModal brand={editingBrand} onClose={()=>setEditingBrand(null)} onSave={(data)=>saveBrandEdit(editingBrand.id, data)} />}

      {/* 기본 카테고리 추가 모달 */}
      {showCatModal && (
        <div style={modalBg} onClick={()=>setShowCatModal(false)}>
          <div style={modalBox} onClick={e=>e.stopPropagation()}>
            <h3 style={modalTitle}>기본 카테고리 추가</h3>
            <input autoFocus value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCategory()} placeholder="예) 스포츠, 홈리빙" style={{...inp,marginBottom:14}} />
            <div style={{display:"flex",gap:8}}>
              <button onClick={addCategory} style={{...primaryBtn,flex:1}}>추가</button>
              <button onClick={()=>setShowCatModal(false)} style={{...secondaryBtn,flex:1}}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── OrderList ──────────────────────────────────────────────
function OrderList({ orders, expandedOrder, setExpandedOrder, getBrand, deleteOrder, fmt, showDate }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:7,maxHeight:showDate?undefined:490,overflowY:showDate?undefined:"auto"}}>
      {orders.map(o => {
        const brand = getBrand(o.brandId);
        const isExp = expandedOrder===o.id;
        const hasMulti = o.items.length>1;
        const isOrderLevel = o.items.length>1&&o.items.every(it=>it.amount===0);
        return (
          <div key={o.id} style={{border:"1px solid #F1F5F9",borderRadius:12,overflow:"hidden"}}>
            <div onClick={()=>setExpandedOrder(isExp?null:o.id)} style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",background:isExp?"#F8FAFC":"white"}}>
              {showDate&&<span style={{fontSize:12,color:"#94A3B8",whiteSpace:"nowrap",flexShrink:0}}>{o.date}</span>}
              {brand&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:10,background:brand.color+"20",color:brand.color,fontWeight:700,flexShrink:0}}>{brand.name}</span>}
              {o.mallType&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:10,background:MALL_TYPE_COLORS[o.mallType]+"20",color:MALL_TYPE_COLORS[o.mallType],fontWeight:700,flexShrink:0}}>{o.mallType}</span>}
              <span style={{fontSize:12,color:"#94A3B8",fontFamily:"monospace",flexShrink:0}}>{o.orderNo}</span>
              <span style={{fontSize:13,color:"#475569",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.items.slice(0,2).map(it=>it.productName).join(", ")}{o.items.length>2&&` 외 ${o.items.length-2}종`}</span>
              {hasMulti&&<span style={{fontSize:12,color:"#94A3B8",whiteSpace:"nowrap",flexShrink:0}}>{o.items.length}종</span>}
              <span style={{fontSize:14,fontWeight:800,color:"#1E293B",whiteSpace:"nowrap",flexShrink:0}}>{fmt(o.totalAmount)}</span>
              <div style={{display:"flex",gap:8,flexShrink:0}}>
                <span onClick={ev=>{ev.stopPropagation();deleteOrder(o.id);}} style={{fontSize:11,color:"#EF4444",cursor:"pointer"}}>삭제</span>
                {hasMulti&&<span style={{fontSize:11,color:"#94A3B8"}}>{isExp?"▲":"▼"}</span>}
              </div>
            </div>
            {isExp&&hasMulti&&(
              <div style={{background:"#F8FAFC",borderTop:"1px solid #F1F5F9",padding:"10px 14px"}}>
                {isOrderLevel&&<div style={{fontSize:11,color:"#64748B",marginBottom:8,padding:"5px 10px",background:"#F1F5F9",borderRadius:6}}>ℹ️ 상품별 금액 없음 · 결제금액은 주문 전체 합계</div>}
                {o.items.map((it,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:13,borderBottom:i<o.items.length-1?"1px solid #F1F5F9":"none",alignItems:"center"}}>
                    <span>{it.category&&<span style={{fontSize:11,background:"#E2E8F0",color:"#475569",padding:"1px 6px",borderRadius:5,marginRight:5,fontWeight:600}}>{it.category}</span>}{it.productName}</span>
                    <span style={{color:"#64748B",whiteSpace:"nowrap"}}>×{it.qty}{!isOrderLevel&&<strong style={{color:"#1E293B",marginLeft:6}}>{fmt(it.amount)}</strong>}</span>
                  </div>
                ))}
                {o.note&&<div style={{marginTop:6,fontSize:12,color:"#94A3B8"}}>📝 {o.note}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chip({label,color,onDelete}){return <span style={{display:"flex",alignItems:"center",gap:5,background:color+"20",border:`1px solid ${color}40`,color,padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700}}>{label}<span onClick={onDelete} style={{cursor:"pointer",opacity:0.6,fontSize:11}}>✕</span></span>;}
function Field({label,children}){return <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={{fontSize:11,fontWeight:700,color:"#64748B"}}>{label}</label>{children}</div>;}
function Empty({text}){return <div style={{textAlign:"center",color:"#CBD5E1",padding:"40px 0",fontSize:14}}>{text}</div>;}

const card={background:"white",borderRadius:16,padding:22,boxShadow:"0 1px 4px rgba(0,0,0,0.08)"};
const cardTitle={margin:"0 0 16px",fontSize:15,fontWeight:700,color:"#1E293B"};
const inp={padding:"8px 10px",borderRadius:8,border:"1px solid #E2E8F0",fontSize:13,outline:"none",background:"#F8FAFC",color:"#1E293B",width:"100%",boxSizing:"border-box"};
const smallLabel={fontSize:11,fontWeight:700,color:"#64748B",display:"block",marginBottom:6};
const addChipBtn={padding:"3px 10px",borderRadius:20,border:"1px dashed #CBD5E1",background:"transparent",cursor:"pointer",fontSize:12,color:"#64748B",fontWeight:600};
const addItemBtn={padding:"4px 12px",borderRadius:8,border:"1px solid #BFDBFE",background:"#EFF6FF",color:"#3B82F6",cursor:"pointer",fontSize:12,fontWeight:700};
const quickBtn={padding:"7px 12px",borderRadius:8,border:"1px solid #E2E8F0",background:"white",fontSize:13,cursor:"pointer",fontWeight:600,color:"#475569"};
const primaryBtn={padding:"10px 20px",background:"#3B82F6",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13};
const secondaryBtn={padding:"10px 20px",background:"#F1F5F9",color:"#64748B",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13};
const labelStyle={fontSize:12,color:"#475569",fontWeight:700,whiteSpace:"nowrap"};
const centerStyle={display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"sans-serif",color:"#64748b"};
const modalBg={position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100};
const modalBox={background:"white",borderRadius:18,padding:28,width:340,boxShadow:"0 20px 60px rgba(0,0,0,0.18)"};
const modalTitle={margin:"0 0 18px",fontSize:16,fontWeight:800,color:"#1E293B"};
