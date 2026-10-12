import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Contract } from "./domain";
import type { RuntimeEnv } from "./security";
function wrap(text: string, font: PDFFont, width: number, size: number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\t/g, " ").split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (font.widthOfTextAtSize(line + character, size) > width && line) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}
export async function createPDF(env: RuntimeEnv, c: Contract) {
  const fontResponse = await env.ASSETS.fetch(
    new Request("https://assets.internal/fonts/NotoSansJP-Regular.ttf"),
  );
  if (!fontResponse.ok) throw new Error("Font missing");
  return generatePDF(c, await fontResponse.arrayBuffer());
}
export async function generatePDF(c: Contract, fontData: ArrayBuffer) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontData, { subset: false });
  const dark = rgb(0.1, 0.18, 0.22),
    green = rgb(0.08, 0.35, 0.29);
  const lines = wrap(c.body, font, 491, 10);
  const count = Math.max(1, Math.ceil(lines.length / 43));
  const perPage = Math.ceil(lines.length / count);
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 831, width: 596, height: 11, color: green });
    page.drawText("bridge★  /  契約書", {
      x: 52,
      y: 795,
      size: 16,
      font,
      color: green,
    });
    page.drawText(
      c.status === "draft" || c.status === "review"
        ? "確認用・未承認"
        : "契約内容（確定版）",
      { x: 390, y: 797, size: 10, font, color: dark },
    );
    page.drawLine({
      start: { x: 52, y: 776 },
      end: { x: 543, y: 776 },
      thickness: 0.6,
      color: rgb(0.8, 0.85, 0.84),
    });
    const subset = lines.slice(i * perPage, (i + 1) * perPage);
    const lineHeight = Math.min(20, 646 / Math.max(1, perPage - 1));
    subset.forEach((line, n) =>
      page.drawText(line, {
        x: 52,
        y: 751 - n * lineHeight,
        size: 10,
        font,
        color: dark,
      }),
    );
    page.drawLine({
      start: { x: 52, y: 70 },
      end: { x: 543, y: 70 },
      thickness: 0.5,
      color: rgb(0.8, 0.85, 0.84),
    });
    page.drawText(`契約番号 ${c.id}`, {
      x: 52,
      y: 51,
      size: 8,
      font,
      color: dark,
    });
    page.drawText(`${i + 1} / ${count}`, {
      x: 505,
      y: 51,
      size: 9,
      font,
      color: dark,
    });
    page.drawText("署名の氏名・日時は、締結後の合意記録に保存されます。", {
      x: 52,
      y: 34,
      size: 8,
      font,
      color: dark,
    });
  }
  pdf.setTitle(c.title);
  pdf.setAuthor("株式会社ThreeStars");
  pdf.setSubject("契約内容の確定記録");
  pdf.setCreationDate(new Date(c.created_at));
  pdf.setModificationDate(new Date(c.created_at));
  return pdf.save();
}
export async function receiptPDF(env: RuntimeEnv, c: Contract) {
  const fontResponse = await env.ASSETS.fetch(
    new Request("https://assets.internal/fonts/NotoSansJP-Regular.ttf"),
  );
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await fontResponse.arrayBuffer(), {
    subset: false,
  });
  const page = pdf.addPage([595.28, 841.89]);
  const green = rgb(0.08, 0.35, 0.29),
    ink = rgb(0.12, 0.22, 0.2),
    muted = rgb(0.39, 0.46, 0.42);
  page.drawRectangle({ x: 0, y: 830, width: 596, height: 12, color: green });
  page.drawText("bridge★", { x: 50, y: 788, size: 21, font, color: green });
  page.drawText("合意記録", { x: 50, y: 727, size: 28, font, color: ink });
  page.drawText("株式会社ThreeStars / 中高一貫ブリッジスター", {
    x: 50,
    y: 699,
    size: 10,
    font,
    color: muted,
  });
  page.drawRectangle({
    x: 50,
    y: 577,
    width: 495,
    height: 96,
    color: rgb(0.93, 0.96, 0.9),
  });
  page.drawText("署名者", { x: 68, y: 649, size: 10, font, color: muted });
  let nameSize = 23;
  while (
    font.widthOfTextAtSize(c.signature_name || "", nameSize) > 450 &&
    nameSize > 9
  )
    nameSize--;
  page.drawText(c.signature_name || "", {
    x: 68,
    y: 616,
    size: nameSize,
    font,
    color: green,
  });
  page.drawText("契約内容への同意を記録しました。", {
    x: 68,
    y: 592,
    size: 10,
    font,
    color: ink,
  });
  const rows = [
    ["契約名", c.title],
    ["契約番号", c.id],
    ["署名者メールアドレス", c.party_email],
    [
      "同意日時（日本時間）",
      c.signed_at
        ? new Date(c.signed_at).toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
            hour12: false,
          }) + " JST"
        : "—",
    ],
    ["確認方法", "専用リンク＋メール確認コード"],
    ["契約本文のハッシュ（SHA-256）", c.content_hash],
    ["契約PDFのハッシュ（SHA-256）", c.pdf_hash || "—"],
  ];
  let y = 550;
  for (const [label, value] of rows) {
    page.drawText(label, { x: 50, y, size: 9, font, color: muted });
    const lines = wrap(value, font, 495, 10);
    lines.forEach((l, i) =>
      page.drawText(l, {
        x: 50,
        y: y - 19 - i * 14,
        size: 10,
        font,
        color: ink,
      }),
    );
    y -= 42 + 14 * (lines.length - 1);
  }
  const foot = [
    "本記録は、自社システムに保存された合意の氏名・日時・対象文書を示します。",
    "第三者の電子証明書や認定タイムスタンプを付与した証明書ではありません。",
    "契約PDFと詳細な操作記録（JSON）を併せて保存してください。",
  ];
  page.drawLine({
    start: { x: 50, y: 143 },
    end: { x: 545, y: 143 },
    thickness: 0.6,
    color: rgb(0.8, 0.85, 0.8),
  });
  foot.forEach((l, i) =>
    page.drawText(l, { x: 50, y: 122 - i * 16, size: 9, font, color: muted }),
  );
  page.drawText("株式会社ThreeStars", {
    x: 50,
    y: 49,
    size: 9,
    font,
    color: ink,
  });
  page.drawText("1 / 1", { x: 510, y: 49, size: 9, font, color: ink });
  pdf.setTitle("合意記録 - " + c.title);
  pdf.setAuthor("株式会社ThreeStars");
  pdf.setCreationDate(new Date(c.signed_at!));
  pdf.setModificationDate(new Date(c.signed_at!));
  return pdf.save();
}
