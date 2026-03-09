const crypto = require("crypto");

// 네이버 커머스 API 토큰 발급
async function getNaverToken(appId, appSecret) {
  const timestamp = Date.now();
  const message = `${appId}_${timestamp}`;
  const sign = crypto.createHmac("sha256", appSecret).update(message).digest("base64");

  const res = await fetch("https://api.commerce.naver.com/external/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      timestamp: String(timestamp),
      client_secret_sign: sign,
      grant_type: "client_credentials",
      type: "SELF",
    }),
  });
  const data = await res.json();
  return { token: data.access_token, raw: data };
}

// 주문 상태가 취소/반품/교환인지 확인
function isCancelledStatus(status) {
  return ["CANCEL_DONE", "RETURN_DONE", "EXCHANGE_DONE", "CANCEL_NOSHIPPING"].includes(status);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { action, start_date, end_date } = req.query;
  const APP_ID = process.env.SMARTSTORE_APP_ID;
  const APP_SECRET = process.env.SMARTSTORE_APP_SECRET;

  if (!APP_ID || !APP_SECRET) {
    return res.status(500).json({ error: "환경변수 누락: SMARTSTORE_APP_ID, SMARTSTORE_APP_SECRET" });
  }

  try {
    // 토큰 발급
    if (action === "token") {
      const { token, raw } = await getNaverToken(APP_ID, APP_SECRET);
      if (!token) return res.status(400).json({ 
        error: "토큰 발급 실패", 
        detail: raw,
        debug: {
          app_id: APP_ID,
          secret_length: APP_SECRET?.length,
          secret_first5: APP_SECRET?.slice(0,5),
          secret_last5: APP_SECRET?.slice(-5),
        }
      });
      return res.json({ access_token: token });
    }

    // 주문 조회
    if (action === "orders") {
      const { token, raw } = await getNaverToken(APP_ID, APP_SECRET);
      if (!token) return res.status(400).json({ 
        error: "토큰 발급 실패", 
        detail: raw,
        debug: {
          app_id: APP_ID,
          secret_length: APP_SECRET?.length,
          secret_first5: APP_SECRET?.slice(0,5),
          secret_last5: APP_SECRET?.slice(-5),
        }
      });

      // 날짜 범위 ISO 변환
      const startISO = `${start_date}T00:00:00.000Z`;
      const endISO = `${end_date}T23:59:59.999Z`;

      // 페이지네이션으로 전체 주문 수집
      const allProductOrders = [];
      let pageNum = 1;
      const pageSize = 300;

      while (true) {
        const r = await fetch("https://api.commerce.naver.com/external/v1/pay-order/seller/orders/query", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            searchDateType: "PAYMENT_DATE",
            startDate: startISO,
            endDate: endISO,
            pageNum,
            pageSize,
          }),
        });
        const data = await r.json();

        if (!data.data || !Array.isArray(data.data)) {
          // 에러 응답
          return res.json({ orders: [], error: JSON.stringify(data) });
        }

        allProductOrders.push(...data.data);
        if (data.data.length < pageSize) break;
        pageNum++;
      }

      // productOrder 단위 → orderId 기준으로 그룹핑
      const orderMap = new Map();

      for (const po of allProductOrders) {
        const orderId = po.order?.orderId || po.orderId;
        const paymentDate = (po.order?.paymentDate || po.paymentDate || "").slice(0, 10);
        const status = po.productOrderStatus;
        const isCancelled = isCancelledStatus(status);

        if (!orderMap.has(orderId)) {
          orderMap.set(orderId, {
            order_id: orderId,
            order_date: paymentDate,
            canceled: isCancelled ? "T" : "F",
            first_order: po.order?.firstOrderYn === "Y" ? "T" : "F",
            member_id: po.order?.ordererId || null,
            actual_order_amount: { payment_amount: 0, order_price_amount: 0 },
            initial_order_amount: { payment_amount: 0, order_price_amount: 0 },
            items: [],
          });
        }

        const grp = orderMap.get(orderId);

        // 아이템 추가
        grp.items.push({
          product_no: String(po.productOrder?.productId || po.productId || ""),
          product_name: po.productOrder?.productName || po.productName || "상품",
          quantity: po.productOrder?.quantity || po.quantity || 1,
          order_price_amount: po.productOrder?.unitPrice || po.unitPrice || 0,
        });

        // 금액 누적 (취소 여부에 따라 분리)
        const itemAmt = po.productOrder?.totalPaymentAmount || po.totalPaymentAmount || 0;
        const itemOriginal = (po.productOrder?.unitPrice || po.unitPrice || 0) * (po.productOrder?.quantity || po.quantity || 1);

        if (isCancelled) {
          grp.initial_order_amount.payment_amount += itemAmt;
          grp.initial_order_amount.order_price_amount += itemOriginal;
          grp.canceled = "T";
        } else {
          grp.actual_order_amount.payment_amount += itemAmt;
          grp.actual_order_amount.order_price_amount += itemOriginal;
        }
      }

      return res.json({ orders: Array.from(orderMap.values()), total: orderMap.size });
    }

    return res.status(400).json({ error: "unknown action" });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
