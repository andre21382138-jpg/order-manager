require("dotenv").config();
const https = require("https");
const http = require("http");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PROXY_BASE = process.env.PROXY_BASE || "http://127.0.0.1:3002";
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL, SUPABASE_KEY 환경변수가 필요합니다 (.env 확인)");
  process.exit(1);
}

const CANCEL_STATUSES = ["CANCEL_DONE", "RETURN_DONE", "EXCHANGE_DONE", "CANCEL_NOSHIPPING", "CANCELED_BY_NOPAYMENT", "CANCELED"];
const SMARTSTORE_TARGETS = [
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "브랜드스토어", credAlias: "PALEO" },
  { brandId: "fd66b113-548b-44b0-8510-b7f49e302145", mallType: "도깨비나라",   credAlias: "DOKEBI" },
  // { brandId: "0a37b281-f262-4402-979c-e63a739bee53", mallType: "스마트스토어",  credAlias: "COCOEL" }, // Plan 6b: SaaS sync-worker로 이관 (2026-06-30)
];

function todayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function yesterdayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - 86400000);
  return d.toISOString().slice(0, 10);
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith("https");
    const lib = isHttps ? https : http;
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function supabaseQuery(table, method = "GET", params = "", body = null, upsert = false) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: upsert ? "return=representation,resolution=merge-duplicates" : method === "POST" ? "return=representation" : "",
  };
  if (method === "PATCH" || method === "DELETE") headers["Prefer"] = "return=representation";
  return request(url, { method, headers }, body);
}

async function getBrands() {
  const data = await supabaseQuery("brands", "GET", "?select=*");
  return Array.isArray(data) ? data : [];
}

async function syncTarget(target, brand, startDate, endDate) {
  console.log(`\n📦 [${brand.name} ${target.mallType}] ${startDate} ~ ${endDate} 동기화 시작`);

  const chunks = [];
  let cursor = new Date(startDate);
  const endD = new Date(endDate);
  while (cursor <= endD) {
    chunks.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }

  const allDetails = [];
  const proxyHeaders = PROXY_TOKEN ? { "X-Proxy-Token": PROXY_TOKEN } : {};

  for (const day of chunks) {
    const from = encodeURIComponent(`${day}T00:00:00.000+09:00`);
    const to = encodeURIComponent(`${day}T23:59:59.999+09:00`);
    try {
      const data = await request(`${PROXY_BASE}/orders?brandId=${brand.id}&mallType=${encodeURIComponent(target.mallType)}&from=${from}&to=${to}`, { headers: proxyHeaders });
      if (data.code || data.error) {
        console.warn(`  ⚠️  ${day} 조회 실패:`, data.message || data.error);
        continue;
      }
      const items = Array.isArray(data.data?.contents) ? data.data.contents
                  : Array.isArray(data.data) ? data.data
                  : [];
      console.log(`  📅 ${day}: ${items.length}건`);
      allDetails.push(...items);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.warn(`  ⚠️  ${day} 요청 오류:`, e.message);
    }
  }

  if (allDetails.length === 0) {
    console.log(`  ℹ️  수집된 주문 없음`);
    return;
  }

  const orderMap = new Map();
  for (const item of allDetails) {
    const po = item.content?.productOrder || item.productOrder;
    const order = item.content?.order || item.order;
    if (!po || !order) continue;
    const orderId = order.orderId;
    const isCancelled = CANCEL_STATUSES.includes(po.productOrderStatus);
    const paymentDate = (order.paymentDate || "").slice(0, 10);
    if (!orderMap.has(orderId)) {
      orderMap.set(orderId, {
        order_id: orderId,
        order_date: paymentDate,
        canceled: "F",
        first_order: order.firstOrderYn === "Y" ? "T" : "F",
        actual_amount: 0,
        initial_amount: 0,
        actual_original: 0,
        initial_original: 0,
        items: [],
      });
    }
    const grp = orderMap.get(orderId);
    const qty = Number(po.quantity || 1);
    const unitPrice = Number(po.unitPrice || 0);
    const totalPayAmt = Number(po.totalPaymentAmount || 0);
    const sellerStoreDc = Number(po.sellerBurdenStoreDiscountAmount || 0);
    const naverProdDc = Math.max(0, Number(po.productProductDiscountAmount || 0) - Number(po.sellerBurdenProductDiscountAmount || 0));
    const totalAmt = totalPayAmt + sellerStoreDc + naverProdDc;
    grp.items.push({
      product_no: String(po.productId || ""),
      product_name: po.productName || "상품",
      quantity: qty,
      order_price_amount: unitPrice,
    });
    if (isCancelled) {
      grp.initial_amount += totalAmt;
      grp.initial_original += unitPrice * qty;
      grp.canceled = "T";
    } else {
      grp.actual_amount += totalAmt;
      grp.actual_original += unitPrice * qty;
    }
  }

  const groupedOrders = Array.from(orderMap.values());
  console.log(`  ✅ 주문 그룹핑: ${groupedOrders.length}건`);

  const mapData = await supabaseQuery("product_category_map", "GET", `?brand_id=eq.${brand.id}&select=*`);
  const categoryMap = {};
  (Array.isArray(mapData) ? mapData : []).forEach((m) => {
    categoryMap[m.product_no] = m.category;
  });

  let saved = 0;
  const BATCH = 50;
  for (let i = 0; i < groupedOrders.length; i += BATCH) {
    const batch = groupedOrders.slice(i, i + BATCH);
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

    const savedOrders = await supabaseQuery("orders", "POST", "?on_conflict=order_no%2Cbrand_id", upsertRows, true);
    if (!Array.isArray(savedOrders)) continue;

    for (const savedOrder of savedOrders) {
      const orig = batch.find((o) => String(o.order_id) === savedOrder.order_no);
      if (!orig) continue;
      await supabaseQuery("order_items", "DELETE", `?order_id=eq.${savedOrder.id}`);
      const items = orig.items.length > 0 ? orig.items : [{ product_name: "상품", quantity: 1, order_price_amount: 0 }];
      const itemRows = items.map((it) => ({
        order_id: savedOrder.id,
        product_name: it.product_name,
        category: categoryMap[it.product_no] || "",
        qty: it.quantity,
        amount: it.order_price_amount,
      }));
      await supabaseQuery("order_items", "POST", "", itemRows);
      saved++;
    }
  }

  console.log(`  💾 저장 완료: ${saved}건`);
}

(async () => {
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const mode = process.argv[2] === "yesterday" ? "yesterday" : "today";
  console.log(`\n🚀 스마트스토어 자동 동기화 시작 (${now}) [mode=${mode}]`);
  console.log("=".repeat(50));

  try {
    const health = await request(`${PROXY_BASE}/health`);
    console.log("✅ 프록시 서버 연결 확인:", health);
  } catch (e) {
    console.error("❌ 프록시 서버 연결 실패:", e.message);
    process.exit(1);
  }

  const endDate = mode === "yesterday" ? yesterdayKST() : todayKST();
  const firstDayOfMonth = endDate.slice(0, 8) + "01";
  console.log(`📅 동기화 기간: ${firstDayOfMonth} ~ ${endDate}`);

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

  const endTime = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  console.log("\n" + "=".repeat(50));
  console.log(`✅ 전체 동기화 완료 (${endTime})`);
  process.exit(0);
})();
