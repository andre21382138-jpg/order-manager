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
      // 1. 캠페인 목록 fetch
      const campResp = await naverAdGet("/ncc/campaigns", creds);
      if (!campResp.ok) {
        return res.status(campResp.status).json({ error: "campaigns fetch 실패", raw: campResp.data });
      }
      const campaigns = Array.isArray(campResp.data) ? campResp.data : [];
      const ids = campaigns.map(c => c.nccCampaignId).filter(Boolean);
      if (ids.length === 0) {
        return res.status(200).json({ stats: [], _debug: { reason: "no_campaigns", campaignsRaw: campResp.data } });
      }

      // 2. 일별 stats fetch
      const fields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const timeRange = JSON.stringify({ since: from, until: to });
      const idsParam = ids.join(",");  // Naver Search Ad는 comma-separated 형식 요구 (JSON array 아님)
      const statsUri = `/stats?ids=${encodeURIComponent(idsParam)}&fields=${encodeURIComponent(fields)}&timeRange=${encodeURIComponent(timeRange)}&datePreset=custom&breakdown=day`;
      const statsResp = await naverAdGet(statsUri, creds);
      if (!statsResp.ok) {
        return res.status(statsResp.status).json({ error: "stats fetch 실패", raw: statsResp.data });
      }

      // 3. 응답 일별 합산 (응답 구조: data[].stats[] 또는 data[]에 직접 일별 row 또는 data[].dailyStats[])
      const byDate = {};
      const items = statsResp.data?.data || statsResp.data?.stats || (Array.isArray(statsResp.data) ? statsResp.data : []);
      items.forEach(item => {
        const dailyArr = item.dailyStats || item.stats || (item.date || item.statDate ? [item] : []);
        dailyArr.forEach(s => {
          const date = s.date || s.statDate;
          if (!date) return;
          const key = String(date).slice(0, 10);
          if (!byDate[key]) byDate[key] = { date: key, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_value: 0 };
          byDate[key].impressions += Number(s.impCnt || 0);
          byDate[key].clicks += Number(s.clkCnt || 0);
          byDate[key].cost += Number(s.salesAmt || 0);
          byDate[key].conversions += Number(s.ccnt || 0);
          byDate[key].conversion_value += Number(s.convAmt || 0);
        });
      });
      const result = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

      // 진단용 — 응답 raw sample 포함 (운영 안정화 후 제거)
      const rawSample = (() => {
        try {
          const s = JSON.stringify(statsResp.data);
          return s.length > 500 ? s.slice(0, 500) + "..." : s;
        } catch { return String(statsResp.data); }
      })();

      return res.status(200).json({
        stats: result,
        _debug: {
          campaignCount: ids.length,
          statsResponseShape: Array.isArray(statsResp.data) ? "array" : typeof statsResp.data,
          statsResponseTopKeys: statsResp.data && !Array.isArray(statsResp.data) ? Object.keys(statsResp.data) : null,
          itemsCount: items.length,
          firstItemKeys: items[0] ? Object.keys(items[0]) : null,
          rawSample
        }
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: "action not found" });
};
