require("dotenv").config();
const http = require("http");
const https = require("https");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.PROXY_PORT || 3002);
const HOST = process.env.PROXY_HOST || "127.0.0.1";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";

const STORE_CRED_ALIAS = {
  "fd66b113-548b-44b0-8510-b7f49e302145|브랜드스토어": { alias: "PALEO", brandName: "팔레오", storeName: "브랜드스토어" },
  "fd66b113-548b-44b0-8510-b7f49e302145|도깨비나라":   { alias: "DOKEBI", brandName: "팔레오", storeName: "도깨비나라" },
  "0a37b281-f262-4402-979c-e63a739bee53|스마트스토어":  { alias: "COCOEL", brandName: "코코엘", storeName: "스마트스토어" },
};

function getCredentials(brandId, mallType) {
  const key = `${brandId}|${mallType}`;
  const map = STORE_CRED_ALIAS[key];
  if (!map) {
    const err = new Error(`매핑 없음: brandId=${brandId}, mallType=${mallType}`);
    err.statusCode = 404;
    throw err;
  }
  const APP_ID = process.env[`${map.alias}_APP_ID`];
  const APP_SECRET = process.env[`${map.alias}_APP_SECRET`];
  if (!APP_ID || !APP_SECRET) {
    const err = new Error(`자격증명 누락: ${map.brandName} ${map.storeName} (${map.alias}_APP_ID/SECRET .env 확인)`);
    err.statusCode = 503;
    throw err;
  }
  return { APP_ID, APP_SECRET, name: `${map.brandName} ${map.storeName}` };
}

function setCors(res, origin) {
  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Proxy-Token");
}

function checkAuth(req, res) {
  if (!PROXY_TOKEN) return true;
  const provided = req.headers["x-proxy-token"];
  if (provided === PROXY_TOKEN) return true;
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unauthorized" }));
  return false;
}

function getNaverToken(brandId, mallType) {
  const { APP_ID, APP_SECRET, name } = getCredentials(brandId, mallType);
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

    const req = https.request(
      {
        hostname: "api.commerce.naver.com",
        path: "/external/v1/oauth2/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) resolve(json.access_token);
            else reject(new Error(`[${name}] 토큰 발급 실패: ${JSON.stringify(json)}`));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function forwardToNaver(targetPath, method, body, token, res) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  const upstream = https.request(
    {
      hostname: "api.commerce.naver.com",
      path: targetPath,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    },
    (naverRes) => {
      let data = "";
      naverRes.on("data", (c) => (data += c));
      naverRes.on("end", () => {
        res.writeHead(naverRes.statusCode || 200, { "Content-Type": "application/json" });
        res.end(data);
      });
    }
  );
  upstream.on("error", (e) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  });
  upstream.write(bodyStr);
  upstream.end();
}

const server = http.createServer((req, res) => {
  setCors(res, req.headers.origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const brandId = url.searchParams.get("brandId");
  const mallType = url.searchParams.get("mallType");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      stores: Object.values(STORE_CRED_ALIAS).map(m => `${m.brandName} ${m.storeName}`),
    }));
    return;
  }

  if (!checkAuth(req, res)) return;

  function handleCredsError(e) {
    const code = e.statusCode || 500;
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }

  if (url.pathname === "/token") {
    if (!brandId || !mallType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "brandId, mallType 파라미터 필요" }));
      return;
    }
    getNaverToken(brandId, mallType)
      .then((token) => {
        const creds = getCredentials(brandId, mallType);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: token, store: creds.name }));
      })
      .catch(handleCredsError);
    return;
  }

  if (url.pathname === "/orders" && req.method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!brandId || !mallType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "brandId, mallType 파라미터 필요" }));
      return;
    }
    if (!from || !to) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "from, to 파라미터 필요" }));
      return;
    }
    getNaverToken(brandId, mallType)
      .then((token) => {
        const path = `/external/v1/pay-order/seller/product-orders?from=${from.replace(/\+/g, "%2B")}&to=${to.replace(/\+/g, "%2B")}&limitCount=300`;
        forwardToNaver(path, "GET", "", token, res);
      })
      .catch(handleCredsError);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`✅ naver-proxy 실행: http://${HOST}:${PORT}`);
  const stores = Object.values(STORE_CRED_ALIAS).map(m => {
    const ok = process.env[`${m.alias}_APP_ID`] && process.env[`${m.alias}_APP_SECRET`];
    return `${m.brandName} ${m.storeName}${ok ? "" : " ⚠️미설정"}`;
  });
  console.log(`   stores: ${stores.join(", ")}`);
  console.log(`   CORS: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   토큰 검증: ${PROXY_TOKEN ? "활성" : "비활성"}`);
});
