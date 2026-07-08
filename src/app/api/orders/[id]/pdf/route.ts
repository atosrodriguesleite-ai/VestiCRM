import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderNumber, orderStatusLabel } from "@/lib/orders";
import { buildPixPayload } from "@/lib/pix";

const BRAND = rgb(0.145, 0.388, 0.922); // #2563EB
const DEEP = rgb(0.118, 0.227, 0.373); // #1E3A5F petróleo
const INK = rgb(0.118, 0.161, 0.235); // slate-800
const GRAY = rgb(0.392, 0.455, 0.545); // slate-500
const LIGHT = rgb(0.945, 0.961, 0.976); // slate-100

const money = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/** Orçamento profissional em PDF (A4). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const order = await db.order.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        customer: true,
        seller: true,
        items: true,
        company: true,
        payments: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();
    const M = 48;
    let y = height - 60;

    // Cabeçalho com "logo" (marca tipográfica no padrão do app)
    page.drawRectangle({ x: M, y: y - 6, width: 26, height: 26, color: DEEP });
    page.drawText("V", { x: M + 8, y, size: 16, font: bold, color: rgb(1, 1, 1) });
    page.drawText(order.company.name, { x: M + 36, y: y + 2, size: 16, font: bold, color: INK });
    page.drawText("VestiCRM", { x: M + 36, y: y - 10, size: 8, font, color: GRAY });

    const title = `ORÇAMENTO ${orderNumber(order.number)}`;
    const tw = bold.widthOfTextAtSize(title, 13);
    page.drawText(title, { x: width - M - tw, y: y + 2, size: 13, font: bold, color: BRAND });
    const dateStr = order.createdAt.toLocaleDateString("pt-BR");
    const dw = font.widthOfTextAtSize(dateStr, 9);
    page.drawText(dateStr, { x: width - M - dw, y: y - 10, size: 9, font, color: GRAY });

    y -= 46;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: LIGHT });
    y -= 24;

    // Cliente e vendedor
    page.drawText("CLIENTE", { x: M, y, size: 8, font: bold, color: GRAY });
    page.drawText("VENDEDOR(A)", { x: width / 2, y, size: 8, font: bold, color: GRAY });
    y -= 14;
    page.drawText(order.customer.name, { x: M, y, size: 11, font: bold, color: INK });
    page.drawText(order.seller?.name ?? "—", { x: width / 2, y, size: 11, font, color: INK });
    y -= 13;
    const place = [order.customer.city, order.customer.state].filter(Boolean).join("/");
    page.drawText(
      `${order.customer.phone}${place ? `  ·  ${place}` : ""}`,
      { x: M, y, size: 9, font, color: GRAY }
    );
    page.drawText(`Status: ${orderStatusLabel[order.status]}`, {
      x: width / 2, y, size: 9, font, color: GRAY,
    });

    // Tabela de itens
    y -= 32;
    page.drawRectangle({ x: M, y: y - 6, width: width - 2 * M, height: 22, color: LIGHT });
    const cols = { item: M + 10, qty: 350, unit: 420, total: width - M - 10 };
    page.drawText("PRODUTO", { x: cols.item, y, size: 8, font: bold, color: GRAY });
    page.drawText("QTD", { x: cols.qty, y, size: 8, font: bold, color: GRAY });
    page.drawText("UNIT.", { x: cols.unit, y, size: 8, font: bold, color: GRAY });
    const th = bold.widthOfTextAtSize("TOTAL", 8);
    page.drawText("TOTAL", { x: cols.total - th, y, size: 8, font: bold, color: GRAY });
    y -= 26;

    for (const item of order.items) {
      page.drawText(item.name.slice(0, 46), { x: cols.item, y, size: 10, font: bold, color: INK });
      const varTxt = [item.color, item.size].filter(Boolean).join(" · ");
      if (varTxt) {
        page.drawText(varTxt + (item.sku ? `  ·  ${item.sku}` : ""), {
          x: cols.item, y: y - 11, size: 8, font, color: GRAY,
        });
      }
      page.drawText(String(item.quantity), { x: cols.qty, y, size: 10, font, color: INK });
      page.drawText(money(item.unitPrice), { x: cols.unit, y, size: 10, font, color: INK });
      const totalTxt = money(item.total);
      const w = bold.widthOfTextAtSize(totalTxt, 10);
      page.drawText(totalTxt, { x: cols.total - w, y, size: 10, font: bold, color: INK });
      y -= varTxt ? 30 : 22;
      page.drawLine({ start: { x: M, y: y + 8 }, end: { x: width - M, y: y + 8 }, thickness: 0.5, color: LIGHT });
    }

    // Totais
    y -= 8;
    const totals: [string, string, boolean][] = [
      ["Subtotal", money(order.subtotal), false],
      ...(order.discount > 0
        ? ([["Desconto", `- ${money(order.discount)}`, false]] as [string, string, boolean][])
        : []),
      ...(order.shippingFee > 0
        ? ([["Frete", money(order.shippingFee), false]] as [string, string, boolean][])
        : []),
      ["TOTAL", money(order.total), true],
    ];
    for (const [label, value, strong] of totals) {
      const f = strong ? bold : font;
      const size = strong ? 13 : 10;
      const lw = f.widthOfTextAtSize(label, size);
      const vw = f.widthOfTextAtSize(value, size);
      page.drawText(label, {
        x: cols.unit - lw - 8, y, size, font: f, color: strong ? BRAND : GRAY,
      });
      page.drawText(value, {
        x: cols.total - vw, y, size, font: f, color: strong ? BRAND : INK,
      });
      y -= strong ? 22 : 16;
    }

    // Observações
    if (order.notes) {
      y -= 8;
      page.drawText("OBSERVAÇÕES", { x: M, y, size: 8, font: bold, color: GRAY });
      y -= 13;
      page.drawText(order.notes.slice(0, 110), { x: M, y, size: 9, font, color: INK });
      y -= 10;
    }

    // Bloco PIX (estrutura pronta: QR real quando a loja configurar a chave)
    y -= 24;
    const boxH = 96;
    page.drawRectangle({
      x: M, y: y - boxH + 14, width: width - 2 * M, height: boxH,
      color: rgb(0.937, 0.965, 1),
    });
    page.drawRectangle({
      x: M + 14, y: y - boxH + 26, width: 72, height: 72,
      borderColor: BRAND, borderWidth: 1.2,
    });
    page.drawText("QR PIX", { x: M + 32, y: y - boxH + 58, size: 9, font: bold, color: BRAND });
    page.drawText("PAGUE COM PIX", { x: M + 100, y: y - 8, size: 9, font: bold, color: BRAND });
    const pending = order.payments.find((p) => p.status === "PENDENTE");
    const pixPayload = buildPixPayload({
      pixKey: pending?.pixKey ?? "configure-sua-chave@sualoja.com.br",
      merchantName: order.company.name,
      merchantCity: order.customer.city ?? "BRASIL",
      amount: order.total,
      txid: `PED${String(order.number).padStart(4, "0")}`,
    });
    page.drawText(`Valor: ${money(order.total)}`, {
      x: M + 100, y: y - 24, size: 10, font, color: INK,
    });
    page.drawText("Copia e cola:", { x: M + 100, y: y - 40, size: 8, font: bold, color: GRAY });
    // payload quebrado em linhas
    const chunk = 78;
    for (let i = 0; i < Math.min(pixPayload.length, chunk * 3); i += chunk) {
      page.drawText(pixPayload.slice(i, i + chunk), {
        x: M + 100, y: y - 52 - (i / chunk) * 10, size: 6.5, font, color: GRAY,
      });
    }

    // Rodapé
    page.drawText(
      `Orçamento gerado em ${new Date().toLocaleDateString("pt-BR")} · ${order.company.name} · via VestiCRM`,
      { x: M, y: 40, size: 8, font, color: GRAY }
    );

    const bytes = await pdf.save();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="orcamento-${orderNumber(order.number).replace("#", "")}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
