const http = require("http");
const https = require("https");
const bcrypt = require("bcryptjs");

const PORT = 3001;
const APP_ID = "jDjA5AMtIa5qHC4iQZgAH";
const APP_SECRET = "$2a$04$PSf0a9uxwBSOvEWnUDcpPe";

function getNaverToken() {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const password = `${APP_ID}_${timestamp}`;
    const hashed = bcrypt.hashSync(password, APP_SECRET);
    const sign = Buffer.from(hashed).toString("base64");

    const body = new URLSearchParams({
      client_id: APP_ID,
      timestamp: String(timestamp),
      client_secret_sign: sign,
      grant_type: "client_credentials",
      type: "SELF",
    }).toString();

    const options = {
      hostname: "api.commerce.naver.com",
      path: "/external/v1/oauth2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(JSON.stringify(json)));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function proxyRequest(targetPath, method, body, token, res) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  const options = {
    hostname: "api.commerce.naver.com",
    path: targetPath,
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bodyStr),
    },
  };

  const req = https.request(options, (naverRes) => {
    let data = "";
    naverRes.on("data", (chunk) => { data += chunk; });
    naverRes.on("end", () => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    });
  });
  req.on("error", (e) => {
    res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: e.message }));
  });
  req.write(bodyStr);
  req.end();
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 토큰 발급
  if (url.pathname === "/token") {
    getNaverToken()
      .then((token) => {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ access_token: token }));
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: e.message }));
      });
    return;
  }

  // 주문 조회 프록시
  if (url.pathname === "/orders" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const token = await getNaverToken();
        proxyRequest(
          "/external/v1/pay-order/seller/orders/query",
          "POST",
          body,
          token,
          res
        );
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`✅ 네이버 프록시 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   토큰 테스트: http://localhost:${PORT}/token`);
});
