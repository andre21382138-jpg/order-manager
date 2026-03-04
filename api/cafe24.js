module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { action, mall_id, code, access_token, start_date, end_date } = req.query;

  const CLIENT_ID = process.env.CAFE24_CLIENT_ID;
  const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET;
  const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI;

  if (action === "debug") {
    res.status(200).json({
      CLIENT_ID: CLIENT_ID ? CLIENT_ID.slice(0,4) + "***" : "없음",
      CLIENT_SECRET: CLIENT_SECRET ? "있음" : "없음",
      REDIRECT_URI: REDIRECT_URI || "없음"
    });
    return;
  }

  if (action === "token") {
    try {
      const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
      const response = await fetch(`https://${mall_id}.cafe24api.com/api/v2/oauth/token`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      });
      const text = await response.text();
      try { res.status(200).json(JSON.parse(text)); }
      catch(e) { res.status(200).json({ error: "parse_error", raw: text }); }
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }

  // 디버그: 실제 API 응답 확인
  else if (action === "debug_orders") {
    try {
      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2025-12-01"
      };
      // since_order_date / until_order_date 형식으로도 시도
      const url1 = `https://${mall_id}.cafe24api.com/api/v2/admin/orders?since_order_date=${start_date}T00:00:00+09:00&until_order_date=${end_date}T23:59:59+09:00&limit=5`;
      const r1 = await fetch(url1, { headers });
      const d1 = await r1.json();

      const url2 = `https://${mall_id}.cafe24api.com/api/v2/admin/orders?start_date=${start_date}&end_date=${end_date}&limit=5`;
      const r2 = await fetch(url2, { headers });
      const d2 = await r2.json();

      res.status(200).json({ 
        since_format: { url: url1, result: d1 },
        start_format: { url: url2, result: d2 }
      });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }

  else if (action === "orders") {
    try {
      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2025-12-01"
      };

      const countRes = await fetch(
        `https://${mall_id}.cafe24api.com/api/v2/admin/orders?since_order_date=${start_date}T00:00:00+09:00&until_order_date=${end_date}T23:59:59+09:00&limit=1&embed=items`,
        { headers }
      );
      const countData = await countRes.json();
      const total = countData.pagination?.total_count || 0;

      const allOrders = [];
      const pageSize = 100;
      const totalPages = Math.ceil(total / pageSize);

      for (let page = 1; page <= totalPages; page++) {
        const offset = (page - 1) * pageSize;
        const r = await fetch(
          `https://${mall_id}.cafe24api.com/api/v2/admin/orders?since_order_date=${start_date}T00:00:00+09:00&until_order_date=${end_date}T23:59:59+09:00&limit=${pageSize}&offset=${offset}&embed=items`,
          { headers }
        );
        const d = await r.json();
        if (d.orders) allOrders.push(...d.orders);
      }

      res.status(200).json({ orders: allOrders, total });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }

  else {
    res.status(400).json({ error: "잘못된 action" });
  }
};
