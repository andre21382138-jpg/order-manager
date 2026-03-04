module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { action, mall_id, code, access_token, refresh_token, start_date, end_date } = req.query;

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
      let offset = 0;
      const pageSize = 100;

      while (true) {
        const r = await fetch(
          `https://${mall_id}.cafe24api.com/api/v2/admin/orders?start_date=${start_date}&end_date=${end_date}&limit=${pageSize}&offset=${offset}&embed=items`,
          { headers }
        );
        const d = await r.json();
        if (!d.orders || d.orders.length === 0) break;
        allOrders.push(...d.orders);
        const hasNext = d.links?.some(l => l.rel === "next");
        if (!hasNext) break;
        offset += pageSize;
      }

      res.status(200).json({ orders: allOrders, total: allOrders.length });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }

  else {
    res.status(400).json({ error: "잘못된 action" });
  }
};
