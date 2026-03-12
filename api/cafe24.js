module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  const { action, mall_id, code, access_token, refresh_token, start_date, end_date } = req.query;

  // mall_id에 따라 키 선택
  const CREDENTIALS = {
    afrimo: {
      CLIENT_ID: process.env.CAFE24_CLIENT_ID_AFRIMO,
      CLIENT_SECRET: process.env.CAFE24_CLIENT_SECRET_AFRIMO,
    },
    cocoel: {
      CLIENT_ID: process.env.CAFE24_CLIENT_ID_COCOEL,
      CLIENT_SECRET: process.env.CAFE24_CLIENT_SECRET_COCOEL,
    },
    cocoel021: {
      CLIENT_ID: process.env.CAFE24_CLIENT_ID_COCOEL,
      CLIENT_SECRET: process.env.CAFE24_CLIENT_SECRET_COCOEL,
    },
  };
  const cred = CREDENTIALS[mall_id] || {
    CLIENT_ID: process.env.CAFE24_CLIENT_ID,
    CLIENT_SECRET: process.env.CAFE24_CLIENT_SECRET,
  };
  const CLIENT_ID = cred.CLIENT_ID;
  const CLIENT_SECRET = cred.CLIENT_SECRET;
  const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI;

  if (action === "order_detail") {
    try {
      const order_id = req.query.order_id;
      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2025-12-01"
      };
      const r = await fetch(
        `https://${mall_id}.cafe24api.com/api/v2/admin/orders/${order_id}?shop_no=1&embed=items,naverpay`,
        { headers }
      );
      const d = await r.json();
      res.status(200).json(d);
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  if (action === "debug") {
    res.status(200).json({
      mall_id: mall_id || "없음",
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
  else if (action === "refresh") {
    try {
      const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
      const response = await fetch(`https://${mall_id}.cafe24api.com/api/v2/oauth/token`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `grant_type=refresh_token&refresh_token=${refresh_token}`
      });
      const text = await response.text();
      try { res.status(200).json(JSON.parse(text)); }
      catch(e) { res.status(200).json({ error: "parse_error", raw: text }); }
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
      const allOrders = [];
      const pageSize = 100;
      let offset = 0;
      const canceledParam = req.query.canceled ? `&canceled=${req.query.canceled}` : '';
      while (true) {
        const r = await fetch(
          `https://${mall_id}.cafe24api.com/api/v2/admin/orders?shop_no=1&start_date=${start_date}&end_date=${end_date}${canceledParam}&limit=${pageSize}&offset=${offset}&embed=items`,
          { headers }
        );
        const d = await r.json();
        if (d.error || d.errors) { return res.status(200).json({ error: d.error || d.errors, raw: d }); }
        if (!d.orders || d.orders.length === 0) break;
        allOrders.push(...d.orders);
        if (d.orders.length < pageSize) break;
        offset += pageSize;
      }
      res.status(200).json({ orders: allOrders, total: allOrders.length });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }
  else if (action === "analytics") {
    // Cafe24 Analytics API: ca-api.cafe24data.com
    try {
      const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      };
      const base = `https://ca-api.cafe24data.com`;
      const mallParam = `mall_id=${mall_id}&shop_no=1&start_date=${start_date}&end_date=${end_date}`;

      // 1. 방문자수 (전체/순방문자 포함)
      const visitRes = await fetch(`${base}/visitors/view?${mallParam}`, { headers });
      const visitData = await visitRes.json();

      // 2. 일별 방문자수
      const visitDailyRes = await fetch(`${base}/visitors/view?${mallParam}&date_type=date`, { headers });
      const visitDailyData = await visitDailyRes.json();

      // 3. 유입경로 (도메인별)
      const inflowRes = await fetch(`${base}/visitpaths/domains?${mallParam}`, { headers });
      const inflowData = await inflowRes.json();

      res.status(200).json({
        visits: visitData,
        visits_daily: visitDailyData,
        inflows: inflowData,
        _debug: { visitUrl: `${base}/visitors/view?${mallParam}` }
      });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }
  else {
    res.status(400).json({ error: "잘못된 action" });
  }
};
