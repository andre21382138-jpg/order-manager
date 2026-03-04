module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { action, mall_id, code, access_token, start_date, end_date } = req.query;

  const CLIENT_ID = process.env.CAFE24_CLIENT_ID;
  const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET;
  const REDIRECT_URI = process.env.CAFE24_REDIRECT_URI;

  // Access Token 발급
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
      try {
        const data = JSON.parse(text);
        res.status(200).json(data);
      } catch(e) {
        res.status(200).json({ error: "parse_error", raw: text });
      }
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }

  // 주문 목록 가져오기
  else if (action === "orders") {
    try {
      const response = await fetch(
        `https://${mall_id}.cafe24api.com/api/v2/admin/orders?start_date=${start_date}&end_date=${end_date}&limit=100`,
        {
          headers: {
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        }
      );
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        res.status(200).json(data);
      } catch(e) {
        res.status(200).json({ error: "parse_error", raw: text });
      }
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }

  else {
    res.status(400).json({ error: "잘못된 action" });
  }
};
