const PptxGenJS = require("pptxgenjs");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    const { products, brandName, brandColor } = req.body;

    const pres = new PptxGenJS();
    pres.layout = "LAYOUT_WIDE"; // 16:9

    for (const p of products) {
      const slide = pres.addSlide();
      slide.background = { color: "FFFFFF" };

      // 왼쪽 이미지 배경
      slide.addShape(pres.ShapeType.rect, { x:0, y:0, w:4.2, h:5.625, fill:{ color:"F8FAFC" }, line:{ color:"F8FAFC" } });

      // 이미지
      if (p.small_image) {
        try {
          slide.addImage({ path: p.small_image, x:0.1, y:0.2, w:4.0, h:5.2, sizing:{ type:"contain", w:4.0, h:5.2 } });
        } catch(e) {}
      }

      // 오른쪽 콘텐츠 영역
      const color = (brandColor||"3B82F6").replace("#","");

      // 브랜드명
      slide.addText(p.brand_name||brandName||"", { x:4.5, y:0.35, w:5.2, h:0.35, fontSize:11, color:"94A3B8", bold:true });

      // 상품명
      slide.addText(p.product_name||"", { x:4.5, y:0.75, w:5.2, h:1.0, fontSize:20, color:"1E293B", bold:true, wrap:true });

      // 구분선
      slide.addShape(pres.ShapeType.rect, { x:4.5, y:1.85, w:5.2, h:0.03, fill:{ color:"E2E8F0" }, line:{ color:"E2E8F0" } });

      // 요약설명
      slide.addText(p.summary_description||"", { x:4.5, y:2.0, w:5.2, h:0.9, fontSize:12, color:"475569", wrap:true });

      // 판매가 박스
      slide.addShape(pres.ShapeType.rect, { x:4.5, y:3.05, w:2.4, h:0.9, fill:{ color:"EFF6FF" }, line:{ color:"EFF6FF" }, rectRadius:0.1 });
      slide.addText("판매가", { x:4.5, y:3.1, w:2.4, h:0.3, fontSize:10, color:"3B82F6", bold:true, align:"center" });
      slide.addText(p.price ? Number(p.price).toLocaleString()+"원" : "-", { x:4.5, y:3.4, w:2.4, h:0.45, fontSize:16, color:"3B82F6", bold:true, align:"center" });

      // 공급가 박스
      slide.addShape(pres.ShapeType.rect, { x:7.1, y:3.05, w:2.4, h:0.9, fill:{ color:"F0FDF4" }, line:{ color:"F0FDF4" }, rectRadius:0.1 });
      slide.addText("공급가", { x:7.1, y:3.1, w:2.4, h:0.3, fontSize:10, color:"10B981", bold:true, align:"center" });
      slide.addText(p.supply_price ? Number(p.supply_price).toLocaleString()+"원" : "-", { x:7.1, y:3.4, w:2.4, h:0.45, fontSize:16, color:"10B981", bold:true, align:"center" });

      // 제조사 / 규격
      slide.addText(`제조사: ${p.manufacturer||"-"}`, { x:4.5, y:4.1, w:2.5, h:0.3, fontSize:11, color:"64748B" });
      slide.addText(`규격: ${p.weight||"-"}`, { x:7.1, y:4.1, w:2.4, h:0.3, fontSize:11, color:"64748B" });
    }

    const buffer = await pres.write({ outputType:"nodebuffer" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent((brandName||"상품")+"_소개서")}.pptx`);
    res.send(buffer);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
