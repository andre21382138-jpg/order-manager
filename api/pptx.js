const PptxGenJS = require("pptxgenjs");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    const { products, brandName } = req.body;
    const pres = new PptxGenJS();
    pres.layout = "LAYOUT_WIDE"; // 33.87 x 19.05 cm = 13.33" x 7.5"

    for (const p of products) {
      const slide = pres.addSlide();
      slide.background = { color: "FAFAF8" };

      // ── 왼쪽 이미지 패널 (40%) ──────────────────────────
      const imgW = 5.3;
      slide.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: imgW, h: 7.5,
        fill: { color: "F0ECE4" }, line: { color: "F0ECE4" }
      });

      if (p.small_image) {
        try {
          slide.addImage({
            path: p.small_image,
            x: 0.3, y: 0.5, w: imgW - 0.6, h: 6.5,
            sizing: { type: "contain", w: imgW - 0.6, h: 6.5 }
          });
        } catch(e) {}
      }

      // 브랜드 배지 (이미지 하단)
      const brand = p.brand_name || brandName || "";
      if (brand) {
        slide.addShape(pres.ShapeType.rect, {
          x: 0.3, y: 6.8, w: 1.4, h: 0.38,
          fill: { color: "2C2C2C" }, line: { color: "2C2C2C" }
        });
        slide.addText(brand.toUpperCase(), {
          x: 0.3, y: 6.8, w: 1.4, h: 0.38,
          fontSize: 8, color: "FFFFFF", bold: true,
          align: "center", valign: "middle", charSpacing: 2
        });
      }

      // ── 오른쪽 콘텐츠 패널 ──────────────────────────────
      const cx = imgW + 0.5;
      const cw = 13.33 - cx - 0.4;

      // 상단 작은 카테고리 레이블
      slide.addText("PRODUCT", {
        x: cx, y: 0.55, w: cw, h: 0.25,
        fontSize: 9, color: "B0A090", bold: true, charSpacing: 3
      });

      // 상품명 (크게)
      slide.addText(p.product_name || "", {
        x: cx, y: 0.9, w: cw, h: 1.6,
        fontSize: 24, color: "1A1A1A", bold: true,
        fontFace: "Malgun Gothic", wrap: true, valign: "top"
      });

      // 골드 구분선
      slide.addShape(pres.ShapeType.rect, {
        x: cx, y: 2.65, w: 0.5, h: 0.05,
        fill: { color: "C9A96E" }, line: { color: "C9A96E" }
      });
      slide.addShape(pres.ShapeType.rect, {
        x: cx + 0.6, y: 2.67, w: cw - 0.6, h: 0.02,
        fill: { color: "E8E0D5" }, line: { color: "E8E0D5" }
      });

      // 요약설명
      if (p.summary_description) {
        slide.addText(p.summary_description, {
          x: cx, y: 2.85, w: cw, h: 1.0,
          fontSize: 11, color: "5C5C5C",
          fontFace: "Malgun Gothic", wrap: true, valign: "top"
        });
      }

      // ── 가격 섹션 ────────────────────────────────────────
      const priceY = 4.15;

      // 판매가
      slide.addShape(pres.ShapeType.rect, {
        x: cx, y: priceY, w: (cw / 2) - 0.15, h: 1.35,
        fill: { color: "2C2C2C" }, line: { color: "2C2C2C" }
      });
      slide.addText("판매가", {
        x: cx + 0.15, y: priceY + 0.18, w: (cw / 2) - 0.45, h: 0.3,
        fontSize: 9, color: "C9A96E", bold: true, charSpacing: 1
      });
      const priceStr = p.price ? Number(String(p.price).replace(/[^0-9]/g,"")).toLocaleString() + "원" : "-";
      slide.addText(priceStr, {
        x: cx + 0.15, y: priceY + 0.52, w: (cw / 2) - 0.45, h: 0.6,
        fontSize: 22, color: "FFFFFF", bold: true, fontFace: "Malgun Gothic"
      });

      // 공급가
      const spx = cx + (cw / 2) + 0.15;
      const spw = (cw / 2) - 0.15;
      slide.addShape(pres.ShapeType.rect, {
        x: spx, y: priceY, w: spw, h: 1.35,
        fill: { color: "F5F0E8" }, line: { color: "E8DFD0" }
      });
      slide.addText("공급가", {
        x: spx + 0.15, y: priceY + 0.18, w: spw - 0.3, h: 0.3,
        fontSize: 9, color: "B0A090", bold: true, charSpacing: 1
      });
      const supplyStr = p.supply_price ? Number(String(p.supply_price).replace(/[^0-9]/g,"")).toLocaleString() + "원" : "-";
      slide.addText(supplyStr, {
        x: spx + 0.15, y: priceY + 0.52, w: spw - 0.3, h: 0.6,
        fontSize: 22, color: "2C2C2C", bold: true, fontFace: "Malgun Gothic"
      });

      // ── 하단 스펙 ─────────────────────────────────────────
      const specY = 5.75;
      slide.addShape(pres.ShapeType.rect, {
        x: cx, y: specY, w: cw, h: 0.02,
        fill: { color: "E8E0D5" }, line: { color: "E8E0D5" }
      });

      slide.addText("제조사", {
        x: cx, y: specY + 0.15, w: 0.8, h: 0.25,
        fontSize: 8, color: "B0A090", bold: true, charSpacing: 0.5
      });
      slide.addText(p.manufacturer || "-", {
        x: cx + 0.85, y: specY + 0.15, w: (cw/2) - 0.9, h: 0.25,
        fontSize: 11, color: "2C2C2C", fontFace: "Malgun Gothic"
      });

      slide.addText("규격", {
        x: cx + (cw/2) + 0.1, y: specY + 0.15, w: 0.6, h: 0.25,
        fontSize: 8, color: "B0A090", bold: true, charSpacing: 0.5
      });
      slide.addText(p.weight || "-", {
        x: cx + (cw/2) + 0.75, y: specY + 0.15, w: (cw/2) - 0.8, h: 0.25,
        fontSize: 11, color: "2C2C2C", fontFace: "Malgun Gothic"
      });
    }

    const buffer = await pres.write({ outputType: "nodebuffer" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent((brandName||"상품")+"_소개서")}.pptx`);
    res.send(buffer);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
