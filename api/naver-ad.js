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
      // 1. 캠페인 목록 fetch (id + name)
      const campResp = await naverAdGet("/ncc/campaigns", creds);
      if (!campResp.ok) {
        return res.status(campResp.status).json({ error: "campaigns fetch 실패", raw: campResp.data });
      }
      const campaignList = Array.isArray(campResp.data) ? campResp.data : [];
      const ids = campaignList.map(c => c.nccCampaignId).filter(Boolean);
      const idToName = {};
      const idToType = {};
      campaignList.forEach(c => {
        if (c.nccCampaignId) {
          idToName[c.nccCampaignId] = c.name || c.nccCampaignId;
          idToType[c.nccCampaignId] = c.campaignTp || null;
        }
      });
      if (ids.length === 0) {
        return res.status(200).json({ stats: [], campaigns: [], _debug: { reason: "no_campaigns", campaignsRaw: campResp.data } });
      }

      // 2. 일별 stats fetch — Naver /stats는 캠페인 합산만 반환하므로 날짜별로 한 번씩 호출
      const fields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const idsParam = ids.join(",");

      const dates = [];
      let cursor = new Date(`${from}T00:00:00Z`);
      const endD = new Date(`${to}T00:00:00Z`);
      while (cursor <= endD) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor = new Date(cursor.getTime() + 86400000);
      }

      const byDate = {};
      const campaignRows = [];  // 캠페인별 일자 row (광고비 0 제외)
      for (const day of dates) {
        const timeRange = JSON.stringify({ since: day, until: day });
        const statsUri = `/stats?ids=${encodeURIComponent(idsParam)}&fields=${encodeURIComponent(fields)}&timeRange=${encodeURIComponent(timeRange)}&datePreset=custom`;
        const r = await naverAdGet(statsUri, creds);
        if (!r.ok) {
          return res.status(r.status).json({ error: `stats fetch 실패 (${day})`, raw: r.data });
        }
        const dayItems = r.data?.data || [];
        let imp = 0, clk = 0, cost = 0, conv = 0, cv = 0;
        dayItems.forEach(it => {
          const itImp = Number(it.impCnt || 0);
          const itClk = Number(it.clkCnt || 0);
          const itCost = Number(it.salesAmt || 0);
          const itConv = Number(it.ccnt || 0);
          const itCv = Number(it.convAmt || 0);
          imp += itImp; clk += itClk; cost += itCost; conv += itConv; cv += itCv;
          // 캠페인별 row: 광고비 0 제외 (저장 노이즈 감소)
          if (itCost > 0 && it.id) {
            campaignRows.push({
              date: day,
              campaign_id: it.id,
              campaign_name: idToName[it.id] || it.id,
              campaign_type: idToType[it.id] || null,
              impressions: itImp,
              clicks: itClk,
              cost: itCost,
              conversions: itConv,
              conversion_value: itCv,
            });
          }
        });
        byDate[day] = { date: day, impressions: imp, clicks: clk, cost: cost, conversions: conv, conversion_value: cv };
      }
      const result = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

      return res.status(200).json({
        stats: result,
        campaigns: campaignRows,
        _debug: { campaignCount: ids.length, dayCount: dates.length, campaignRowCount: campaignRows.length }
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: "action not found" });
};
