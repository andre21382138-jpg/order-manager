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

async function parallelLimit(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkRes = await Promise.all(chunk.map(fn));
    results.push(...chunkRes);
  }
  return results;
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

  if (action === "keywords") {
    if (!from || !to) return res.status(400).json({ error: "from, to 필요" });
    const t0 = Date.now();
    try {
      // 1. 캠페인 목록 + 메타
      const campResp = await naverAdGet("/ncc/campaigns", creds);
      if (!campResp.ok) {
        return res.status(campResp.status).json({ error: "campaigns fetch 실패", raw: campResp.data });
      }
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
        return res.status(200).json({ keywords: [], _debug: { reason: "no_campaigns", elapsedMs: Date.now() - t0 } });
      }

      // 2. 활성 캠페인 식별 — 기간 합산 cost 호출
      const periodFields = JSON.stringify(["salesAmt"]);
      const periodTimeRange = JSON.stringify({ since: from, until: to });
      const campStatsUri = `/stats?ids=${encodeURIComponent(allCampaignIds.join(","))}&fields=${encodeURIComponent(periodFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
      const campStatsResp = await naverAdGet(campStatsUri, creds);
      if (!campStatsResp.ok) {
        return res.status(campStatsResp.status).json({ error: "campaign stats fetch 실패", raw: campStatsResp.data });
      }
      const activeCampaignIds = (campStatsResp.data?.data || [])
        .filter(c => Number(c.salesAmt || 0) > 0)
        .map(c => c.id);
      if (activeCampaignIds.length === 0) {
        return res.status(200).json({ keywords: [], _debug: { reason: "no_active_campaigns", elapsedMs: Date.now() - t0 } });
      }

      // 3. 활성 캠페인의 광고그룹 fetch (병렬 5) — 개별 호출 실패는 _debug.warnings에 기록
      const warnings = [];
      const adgroupArrays = await parallelLimit(activeCampaignIds, 5, async (id) => {
        const r = await naverAdGet(`/ncc/adgroups?nccCampaignId=${encodeURIComponent(id)}`, creds);
        if (!r.ok) { warnings.push({ stage: "adgroups", id, status: r.status }); return []; }
        return Array.isArray(r.data) ? r.data : [];
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

      // 4. 활성 광고그룹 식별 — 광고그룹 합산 cost (실패 시 명시 에러)
      let activeAdgroupIds = [];
      if (allAdgroupIds.length > 0) {
        const groupStatsUri = `/stats?ids=${encodeURIComponent(allAdgroupIds.join(","))}&fields=${encodeURIComponent(periodFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
        const groupStatsResp = await naverAdGet(groupStatsUri, creds);
        if (!groupStatsResp.ok) {
          return res.status(groupStatsResp.status).json({ error: "adgroup stats fetch 실패", raw: groupStatsResp.data });
        }
        activeAdgroupIds = (groupStatsResp.data?.data || [])
          .filter(g => Number(g.salesAmt || 0) > 0)
          .map(g => g.id);
      }
      if (activeAdgroupIds.length === 0) {
        return res.status(200).json({ keywords: [], _debug: { reason: "no_active_adgroups", campaignsScanned: activeCampaignIds.length, warnings, elapsedMs: Date.now() - t0 } });
      }

      // 5. 활성 광고그룹의 키워드 fetch (병렬 5) — 개별 호출 실패는 warnings에 기록
      const keywordArrays = await parallelLimit(activeAdgroupIds, 5, async (id) => {
        const r = await naverAdGet(`/ncc/keywords?nccAdgroupId=${encodeURIComponent(id)}`, creds);
        if (!r.ok) { warnings.push({ stage: "keywords", id, status: r.status }); return []; }
        return Array.isArray(r.data) ? r.data : [];
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
        return res.status(200).json({ keywords: [], _debug: { reason: "no_keywords", adgroupsScanned: activeAdgroupIds.length, warnings, elapsedMs: Date.now() - t0 } });
      }

      // 6. 키워드 stats bulk (100개씩 chunk, 병렬 5)
      const keywordFields = JSON.stringify(["impCnt","clkCnt","salesAmt","ccnt","convAmt"]);
      const chunks = [];
      for (let i = 0; i < allKeywordIds.length; i += 100) {
        chunks.push(allKeywordIds.slice(i, i + 100));
      }
      const statsArrays = await parallelLimit(chunks, 5, async (chunk) => {
        const uri = `/stats?ids=${encodeURIComponent(chunk.join(","))}&fields=${encodeURIComponent(keywordFields)}&timeRange=${encodeURIComponent(periodTimeRange)}&datePreset=custom`;
        const r = await naverAdGet(uri, creds);
        if (!r.ok) { warnings.push({ stage: "keyword_stats", chunkSize: chunk.length, status: r.status }); return []; }
        return r.data?.data || [];
      });
      const keywordStats = statsArrays.flat();

      // 7. 응답 가공: cost > 0 키워드만, 메타 조인
      const keywords = keywordStats
        .filter(s => Number(s.salesAmt || 0) > 0)
        .map(s => {
          const kw = idToKeyword[s.id] || {};
          const ag = idToAdgroup[kw.adgroup_id] || {};
          const camp = idToCampaign[ag.campaign_id] || {};
          return {
            keyword_id: s.id,
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

      return res.status(200).json({
        keywords,
        _debug: {
          campaignsScanned: activeCampaignIds.length,
          adgroupsScanned: activeAdgroupIds.length,
          keywordsFetched: allKeywordIds.length,
          keywordsActive: keywords.length,
          warnings,
          elapsedMs: Date.now() - t0,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message, elapsedMs: Date.now() - t0 });
    }
  }

  return res.status(404).json({ error: "action not found" });
};
