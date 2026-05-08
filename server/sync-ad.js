require("dotenv").config();
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const NAVERAD_BASE = "https://api.searchad.naver.com";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL, SUPABASE_KEY 환경변수가 필요합니다 (.env 확인)");
  process.exit(1);
}

const BRAND_ALIAS = {
  "fd66b113-548b-44b0-8510-b7f49e302145": "PALEO",
};

function signHmac(method, uri, timestamp, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac("sha256", secretKey).update(message).digest("base64");
}

function getCreds(brandUuid) {
  const alias = BRAND_ALIAS[brandUuid];
  if (!alias) return null;
  const customerId = process.env[`${alias}_NAVERAD_CUSTOMER_ID`];
  const accessLicense = process.env[`${alias}_NAVERAD_ACCESS_LICENSE`];
  const secretKey = process.env[`${alias}_NAVERAD_SECRET_KEY`];
  if (!customerId || !accessLicense || !secretKey) return null;
  return { alias, customerId, accessLicense, secretKey };
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

async function parallelLimit(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkRes = await Promise.all(chunk.map(fn));
    results.push(...chunkRes);
  }
  return results;
}

const chunkIds = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += 100) out.push(arr.slice(i, i + 100));
  return out;
};

async function supabaseRequest(table, method = "GET", params = "", body = null, upsert = false) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: upsert
      ? "return=representation,resolution=merge-duplicates"
      : method === "POST" ? "return=representation"
      : (method === "PATCH" || method === "DELETE") ? "return=representation"
      : "",
  };
  const r = await fetch(url, {
    method,
    headers,
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  try {
    return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
  } catch {
    return { ok: r.ok, status: r.status, data: text };
  }
}

async function getBrands() {
  const r = await supabaseRequest("brands", "GET", "?select=*");
  return Array.isArray(r.data) ? r.data : [];
}

function thisMonthRange() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const yest = new Date(Date.now() + 9 * 60 * 60 * 1000 - 86400000).toISOString().slice(0, 10);
  const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
  return { start: firstDay, end: yest };
}

async function syncCampaigns(brand, creds, from, to) {
  console.log(`\n  📊 캠페인 동기화 (${from} ~ ${to})`);

  const campResp = await naverAdGet("/ncc/campaigns", creds);
  if (!campResp.ok) throw new Error(`campaigns fetch 실패: ${campResp.status}`);
  const campaigns = Array.isArray(campResp.data) ? campResp.data : [];
  const ids = campaigns.map(c => c.nccCampaignId).filter(Boolean);
  const idToName = {}, idToType = {};
  campaigns.forEach(c => {
    if (c.nccCampaignId) {
      idToName[c.nccCampaignId] = c.name || c.nccCampaignId;
      idToType[c.nccCampaignId] = c.campaignTp || null;
    }
  });
  if (ids.length === 0) {
    console.log("    ℹ️  캠페인 없음");
    return { dailyRows: 0, campaignRows: 0 };
  }

  const fields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
  const idsParam = ids.join(",");

  const dates = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const endD = new Date(`${to}T00:00:00Z`);
  while (cursor <= endD) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }

  const dailyRows = [];
  const campaignRows = [];

  for (const day of dates) {
    const timeRange = JSON.stringify({ since: day, until: day });
    const uri = `/stats?ids=${encodeURIComponent(idsParam)}&fields=${encodeURIComponent(fields)}&timeRange=${encodeURIComponent(timeRange)}&datePreset=custom`;
    const r = await naverAdGet(uri, creds);
    if (!r.ok) throw new Error(`stats fetch 실패 (${day}): ${r.status}`);
    let imp = 0, clk = 0, cost = 0, conv = 0, cv = 0;
    (r.data?.data || []).forEach(it => {
      const itImp = Number(it.impCnt || 0);
      const itClk = Number(it.clkCnt || 0);
      const itCost = Number(it.salesAmt || 0);
      const itConv = Number(it.ccnt || 0);
      const itCv = Number(it.convAmt || 0);
      imp += itImp; clk += itClk; cost += itCost; conv += itConv; cv += itCv;
      if (itCost > 0 && it.id) {
        campaignRows.push({
          brand_id: brand.id,
          mall_type: "자사몰",
          date: day,
          campaign_id: it.id,
          campaign_name: idToName[it.id] || it.id,
          campaign_type: idToType[it.id] || null,
          impressions: itImp, clicks: itClk, cost: itCost,
          conversions: itConv, conversion_value: itCv,
        });
      }
    });
    dailyRows.push({
      brand_id: brand.id,
      mall_type: "자사몰",
      date: day,
      campaign_id: "",
      campaign_name: null,
      campaign_type: null,
      impressions: imp, clicks: clk, cost,
      conversions: conv, conversion_value: cv,
    });
  }

  const allRows = [...dailyRows, ...campaignRows];
  const r = await supabaseRequest("naver_ad_stats", "POST", "?on_conflict=brand_id%2Cdate%2Ccampaign_id", allRows, true);
  if (!r.ok) throw new Error(`naver_ad_stats upsert 실패: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  console.log(`    ✅ 일별 ${dailyRows.length}건 + 캠페인 ${campaignRows.length}건 저장`);
  return { dailyRows: dailyRows.length, campaignRows: campaignRows.length };
}

async function syncKeywords(brand, creds, from, to) {
  console.log(`\n  🔑 키워드 동기화 (${from} ~ ${to})`);

  const campResp = await naverAdGet("/ncc/campaigns", creds);
  if (!campResp.ok) throw new Error(`campaigns fetch 실패: ${campResp.status}`);
  const allCampaigns = Array.isArray(campResp.data) ? campResp.data : [];
  const allCampaignIds = allCampaigns.map(c => c.nccCampaignId).filter(Boolean);
  const idToCampaign = {};
  allCampaigns.forEach(c => {
    if (c.nccCampaignId) idToCampaign[c.nccCampaignId] = {
      name: c.name || c.nccCampaignId,
      type: c.campaignTp || null,
    };
  });
  if (allCampaignIds.length === 0) {
    console.log("    ℹ️  캠페인 없음");
    return { keywordRows: 0 };
  }

  const periodFields = JSON.stringify(["salesAmt"]);
  const periodTimeRange = JSON.stringify({ since: from, until: to });
  const fetchPeriodCost = async (chunk) => {
    const uri = `/stats?ids=${encodeURIComponent(chunk.join(","))}&fields=${encodeURIComponent(periodFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
    return naverAdGet(uri, creds);
  };
  const campChunks = chunkIds(allCampaignIds);
  const campStatsResults = await parallelLimit(campChunks, 5, fetchPeriodCost);
  const failedCamp = campStatsResults.find(r => !r.ok);
  if (failedCamp) throw new Error(`campaign stats 실패: ${failedCamp.status}`);
  const activeCampaignIds = campStatsResults.flatMap(r => r.data?.data || [])
    .filter(c => Number(c.salesAmt || 0) > 0)
    .map(c => c.id);
  if (activeCampaignIds.length === 0) {
    console.log("    ℹ️  활성 캠페인 없음 → 키워드 동기화 스킵");
    return { keywordRows: 0 };
  }

  const adgroupArrays = await parallelLimit(activeCampaignIds, 5, async (id) => {
    const r = await naverAdGet(`/ncc/adgroups?nccCampaignId=${encodeURIComponent(id)}`, creds);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  });
  const allAdgroups = adgroupArrays.flat();
  const allAdgroupIds = allAdgroups.map(g => g.nccAdgroupId).filter(Boolean);
  const idToAdgroup = {};
  allAdgroups.forEach(g => {
    if (g.nccAdgroupId) idToAdgroup[g.nccAdgroupId] = {
      name: g.name || g.nccAdgroupId,
      campaign_id: g.nccCampaignId,
    };
  });

  let activeAdgroupIds = [];
  if (allAdgroupIds.length > 0) {
    const groupChunks = chunkIds(allAdgroupIds);
    const groupResults = await parallelLimit(groupChunks, 5, fetchPeriodCost);
    const failedGroup = groupResults.find(r => !r.ok);
    if (failedGroup) throw new Error(`adgroup stats 실패: ${failedGroup.status}`);
    activeAdgroupIds = groupResults.flatMap(r => r.data?.data || [])
      .filter(g => Number(g.salesAmt || 0) > 0)
      .map(g => g.id);
  }
  if (activeAdgroupIds.length === 0) {
    console.log("    ℹ️  활성 광고그룹 없음 → 키워드 동기화 스킵");
    return { keywordRows: 0 };
  }

  const keywordArrays = await parallelLimit(activeAdgroupIds, 5, async (id) => {
    const r = await naverAdGet(`/ncc/keywords?nccAdgroupId=${encodeURIComponent(id)}`, creds);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  });
  const allKeywords = keywordArrays.flat();
  const idToKeyword = {};
  allKeywords.forEach(k => {
    if (k.nccKeywordId) idToKeyword[k.nccKeywordId] = {
      name: k.keyword || k.nccKeywordId,
      adgroup_id: k.nccAdgroupId,
    };
  });
  const allKeywordIds = Object.keys(idToKeyword);
  if (allKeywordIds.length === 0) {
    console.log("    ℹ️  키워드 없음");
    return { keywordRows: 0 };
  }

  const periodKwResults = await parallelLimit(chunkIds(allKeywordIds), 5, fetchPeriodCost);
  const activeKeywordIds = periodKwResults.flatMap(r => r.data?.data || [])
    .filter(k => Number(k.salesAmt || 0) > 0)
    .map(k => k.id);
  if (activeKeywordIds.length === 0) {
    console.log("    ℹ️  활성 키워드 없음");
    await supabaseRequest("naver_ad_keyword_stats", "DELETE", `?brand_id=eq.${brand.id}&mall_type=eq.${encodeURIComponent("자사몰")}`);
    return { keywordRows: 0 };
  }

  const keywordFields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
  const dates = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const endD = new Date(`${to}T00:00:00Z`);
  while (cursor <= endD) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  const keywordChunksPerDay = chunkIds(activeKeywordIds);
  const tasks = [];
  for (const day of dates) for (const chunk of keywordChunksPerDay) tasks.push({ day, chunk });
  const taskResults = await parallelLimit(tasks, 5, async ({ day, chunk }) => {
    const dayRange = JSON.stringify({ since: day, until: day });
    const uri = `/stats?ids=${encodeURIComponent(chunk.join(","))}&fields=${encodeURIComponent(keywordFields)}&timeRange=${encodeURIComponent(dayRange)}&datePreset=custom`;
    const r = await naverAdGet(uri, creds);
    if (!r.ok) return { failed: true, day, status: r.status };
    return { day, items: r.data?.data || [] };
  });
  const failures = taskResults.filter(r => r.failed);
  if (failures.length / tasks.length > 0.3) {
    throw new Error(`keyword_stats 실패율 과다: ${failures.length}/${tasks.length}`);
  }
  const keywordStats = taskResults.flatMap(r => r.failed ? [] : r.items.map(s => ({ ...s, _date: r.day })));

  const keywords = keywordStats
    .filter(s => Number(s.salesAmt || 0) > 0)
    .map(s => {
      const kw = idToKeyword[s.id] || {};
      const ag = idToAdgroup[kw.adgroup_id] || {};
      const camp = idToCampaign[ag.campaign_id] || {};
      return {
        brand_id: brand.id,
        mall_type: "자사몰",
        keyword_id: s.id,
        date: s._date,
        keyword_name: kw.name || s.id,
        ad_group_id: kw.adgroup_id || null,
        ad_group_name: ag.name || null,
        campaign_id: ag.campaign_id || null,
        campaign_name: camp.name || null,
        campaign_type: camp.type || null,
        impressions: Number(s.impCnt || 0),
        clicks: Number(s.clkCnt || 0),
        cost: Number(s.salesAmt || 0),
        conversions: Number(s.ccnt || 0),
        conversion_value: Number(s.convAmt || 0),
      };
    });

  const delResult = await supabaseRequest("naver_ad_keyword_stats", "DELETE", `?brand_id=eq.${brand.id}&mall_type=eq.${encodeURIComponent("자사몰")}`);
  if (!delResult.ok) throw new Error(`naver_ad_keyword_stats delete 실패: ${delResult.status}`);
  if (keywords.length > 0) {
    for (let i = 0; i < keywords.length; i += 1000) {
      const batch = keywords.slice(i, i + 1000);
      const r = await supabaseRequest("naver_ad_keyword_stats", "POST", "", batch);
      if (!r.ok) throw new Error(`keyword insert 실패: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }
  console.log(`    ✅ 키워드 ${keywords.length}건 저장`);
  return { keywordRows: keywords.length };
}

(async () => {
  const t0 = Date.now();
  const startStr = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  console.log(`\n🚀 네이버 검색광고 자동 동기화 시작 (${startStr})`);
  console.log("=".repeat(60));

  const { start, end } = thisMonthRange();
  console.log(`📅 동기화 기간: ${start} ~ ${end} (당월)`);

  if (start > end) {
    console.log("ℹ️  start > end (월초 케이스) — 종료");
    process.exit(0);
  }

  const brands = await getBrands();
  const targets = brands.filter(b => BRAND_ALIAS[b.id]);
  if (targets.length === 0) {
    console.log("ℹ️  자격증명 매핑된 브랜드 없음 → 종료");
    process.exit(0);
  }

  let totalDaily = 0, totalCampaign = 0, totalKeyword = 0, errors = 0;

  for (const brand of targets) {
    console.log(`\n🏪 [${brand.name}] 시작`);
    const creds = getCreds(brand.id);
    if (!creds) {
      console.warn(`  ⚠️  ${BRAND_ALIAS[brand.id]}_NAVERAD_* 환경변수 미설정 → 스킵`);
      continue;
    }
    try {
      const c = await syncCampaigns(brand, creds, start, end);
      totalDaily += c.dailyRows; totalCampaign += c.campaignRows;
      const k = await syncKeywords(brand, creds, start, end);
      totalKeyword += k.keywordRows;
    } catch (e) {
      console.error(`  ❌ [${brand.name}] 오류:`, e.message);
      errors++;
    }
  }

  const sec = Math.round((Date.now() - t0) / 1000);
  const endStr = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  console.log("\n" + "=".repeat(60));
  console.log(`📊 일별 ${totalDaily}건 / 캠페인 ${totalCampaign}건 / 키워드 ${totalKeyword}건`);
  console.log(`${errors === 0 ? "✅" : "⚠️"} 동기화 ${errors === 0 ? "완료" : "부분 완료"} (${sec}초, 오류 ${errors}건) — ${endStr}`);
  process.exit(errors === 0 ? 0 : 1);
})();
