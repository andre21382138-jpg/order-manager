const PptxGenJS = require("pptxgenjs");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    const { products, brandName } = req.body;

    const pres = new PptxGenJS();
    pres.layout = "LAYOUT_WIDE";

    for (const p of products) {
      const slide = pres.addSlide();

      // 배경: 딥 다크네이비
      slide.background = { color: "0F1923" };

      // 왼쪽 이미지 영역 (32%)
      const imgW = 4.22;
      slide.addShape(pres.ShapeType.rect, { x:0, y:0, w:imgW, h:5.625, fill:{ color:"1E2D3D" }, line:{ color:"1E2D3D" } });

      // 이미지
      if (p.small_image) {
        try {
          slide.addImage({ path: p.small_image, x:0, y:0, w:imgW, h:5.625, sizing:{ type:"cover", w:imgW, h:5.625 } });
        } catch(e) {}
      }

      // 이미지 우측 그라데이션 오버레이 (반투명 rect)
      slide.addShape(pres.ShapeType.rect, { x:imgW-0.8, y:0, w:0.8, h:5.625, fill:{ type:"solid", color:"0F1923" }, transparency:30, line:{ color:"0F1923" } });

      // 브랜드 배지
      slide.addShape(pres.ShapeType.rect, { x:0.18, y:4.9, w:1.6, h:0.38, fill:{ color:"C9A96E" }, transparency:80, line:{ color:"C9A96E", width:0.5, transparency:60 } });
      slide.addText(p.brand_name||brandName||"", { x:0.18, y:4.9, w:1.6, h:0.38, fontSize:9, color:"C9A96E", bold:true, align:"center", valign:"middle", charSpacing:2 });

      // 콘텐츠 영역 시작
      const cx = imgW + 0.35;
      const cw = 9.5 - cx;

      // 상품명
      slide.addText(p.product_name||"", {
        x:cx, y:0.55, w:cw, h:1.1,
        fontSize:22, color:"F8F4EE", bold:true,
        fontFace:"Malgun Gothic",
        wrap:true, valign:"top"
      });

      // 골드 구분선
      slide.addShape(pres.ShapeType.rect, { x:cx, y:1.75, w:1.2, h:0.04, fill:{ color:"C9A96E" }, line:{ color:"C9A96E" } });

      // 요약설명
      if (p.summary_description) {
        slide.addText(p.summary_description, {
          x:cx, y:1.95, w:cw, h:0.9,
          fontSize:11, color:"9EAFC2",
          fontFace:"Malgun Gothic",
          wrap:true, valign:"top"
        });
      }

      // 판매가 박스
      slide.addShape(pres.ShapeType.rect, { x:cx, y:3.05, w:(cw/2)-0.1, h:0.95, fill:{ color:"C9A96E" }, transparency:85, line:{ color:"C9A96E", width:0.75, transparency:65 } });
      slide.addText("RETAIL PRICE", { x:cx, y:3.1, w:(cw/2)-0.1, h:0.28, fontSize:8, color:"C9A96E", bold:true, align:"center", charSpacing:1.5 });
      slide.addText(p.price ? Number(p.price).toLocaleString()+"원" : "-", { x:cx, y:3.38, w:(cw/2)-0.1, h:0.5, fontSize:18, color:"C9A96E", bold:true, align:"center" });

      // 공급가 박스
      const spx = cx + (cw/2) + 0.1;
      slide.addShape(pres.ShapeType.rect, { x:spx, y:3.05, w:(cw/2)-0.1, h:0.95, fill:{ color:"FFFFFF" }, transparency:92, line:{ color:"FFFFFF", width:0.75, transparency:75 } });
      slide.addText("SUPPLY PRICE", { x:spx, y:3.1, w:(cw/2)-0.1, h:0.28, fontSize:8, color:"9EAFC2", bold:true, align:"center", charSpacing:1.5 });
      slide.addText(p.supply_price ? Number(p.supply_price).toLocaleString()+"원" : "-", { x:spx, y:3.38, w:(cw/2)-0.1, h:0.5, fontSize:18, color:"F8F4EE", bold:true, align:"center" });

      // 하단 정보
      slide.addShape(pres.ShapeType.rect, { x:cx, y:4.22, w:cw, h:0.02, fill:{ color:"FFFFFF" }, transparency:88, line:{ color:"FFFFFF", transparency:88 } });
      slide.addText(`MANUFACTURER  ${p.manufacturer||"-"}`, { x:cx, y:4.35, w:cw/2, h:0.3, fontSize:10, color:"6B7F94", fontFace:"Malgun Gothic" });
      slide.addText(`WEIGHT / SIZE  ${p.weight||"-"}`, { x:cx+(cw/2), y:4.35, w:cw/2, h:0.3, fontSize:10, color:"6B7F94", fontFace:"Malgun Gothic" });
    }

    const buffer = await pres.write({ outputType:"nodebuffer" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent((brandName||"상품")+"_소개서")}.pptx`);
    res.send(buffer);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
