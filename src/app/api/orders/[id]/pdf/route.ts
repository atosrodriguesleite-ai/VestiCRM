import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type RGB } from "pdf-lib";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderNumber, orderStatusLabel, paymentMethodLabel } from "@/lib/orders";

/**
 * Romaneio do pedido em PDF (A4) — uso interno da loja (expedição).
 *
 * • Identidade visual da LOJA (logo + cor do catálogo), não da plataforma.
 * • Ficha completa do cliente (telefone, CPF/CNPJ, e-mail, endereço).
 * • Caixinha de conferência ao lado de cada peça, para marcar na separação.
 * • Forma de pagamento e forma de envio (com rastreio), para a expedição.
 */

const INK = rgb(0.118, 0.161, 0.235); // slate-800
const GRAY = rgb(0.392, 0.455, 0.545); // slate-500
const LIGHT = rgb(0.945, 0.961, 0.976); // slate-100

const money = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

function hexToRgb(hex: string | null | undefined, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

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
        payments: { orderBy: { createdAt: "asc" } },
        shipping: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const ACCENT = hexToRgb(order.company.catalogPrimary, rgb(0.055, 0.004, 0.259));

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // logo da loja, quando for imagem embutida (data URI)
    let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
    const logoUrl = order.company.logoUrl ?? "";
    try {
      if (logoUrl.startsWith("data:image/png")) {
        logo = await pdf.embedPng(Buffer.from(logoUrl.split(",")[1], "base64"));
      } else if (
        logoUrl.startsWith("data:image/jpeg") ||
        logoUrl.startsWith("data:image/jpg")
      ) {
        logo = await pdf.embedJpg(Buffer.from(logoUrl.split(",")[1], "base64"));
      }
    } catch {
      logo = null;
    }

    // ---- Fotos das peças (miniatura no romaneio) ----
    // Uma foto por produto (a capa). Embutimos uma vez só e reaproveitamos
    // em todos os itens do mesmo produto. Se a foto não for PNG/JPG (ex: webp)
    // ou falhar, o item sai sem miniatura — nunca derruba o romaneio.
    const productIds = [
      ...new Set(order.items.map((i) => i.productId).filter((x): x is string => !!x)),
    ];
    const imgs = productIds.length
      ? await db.productImage.findMany({
          where: { productId: { in: productIds } },
          orderBy: { order: "asc" },
          select: { productId: true, url: true },
        })
      : [];
    const urlByProduct = new Map<string, string>();
    for (const im of imgs) {
      if (!urlByProduct.has(im.productId)) urlByProduct.set(im.productId, im.url);
    }

    type Embedded = Awaited<ReturnType<typeof pdf.embedPng>>;
    async function embedFoto(url: string): Promise<Embedded | null> {
      try {
        let bytes: Buffer | null = null;
        let kind: "png" | "jpg" | null = null;
        if (url.startsWith("data:")) {
          const comma = url.indexOf(",");
          const head = url.slice(0, comma);
          const b64 = url.slice(comma + 1);
          if (!b64) return null;
          bytes = Buffer.from(b64, "base64");
          kind = /image\/png/i.test(head) ? "png" : /image\/jpe?g/i.test(head) ? "jpg" : null;
        } else if (/^https?:\/\//i.test(url)) {
          const res = await fetch(url);
          if (!res.ok) return null;
          const ct = res.headers.get("content-type") ?? "";
          bytes = Buffer.from(await res.arrayBuffer());
          kind =
            /png/i.test(ct) || /\.png(\?|$)/i.test(url)
              ? "png"
              : /jpe?g/i.test(ct) || /\.jpe?g(\?|$)/i.test(url)
              ? "jpg"
              : null;
        }
        if (!bytes || !kind) return null;
        return kind === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      } catch {
        return null;
      }
    }

    const fotoByProduct = new Map<string, Embedded>();
    for (const [pid, url] of urlByProduct) {
      const emb = await embedFoto(url);
      if (emb) fotoByProduct.set(pid, emb);
    }

    const A4: [number, number] = [595.28, 841.89];
    const M = 48;
    let page = pdf.addPage(A4);
    const { width, height } = page.getSize();
    let y = height - 60;

    const newPageIfNeeded = (needed: number) => {
      if (y - needed < 70) {
        page = pdf.addPage(A4);
        y = height - 60;
      }
    };

    // ---- Cabeçalho: identidade da LOJA ----
    if (logo) {
      const dim = logo.scaleToFit(30, 30);
      page.drawImage(logo, { x: M, y: y - 8, width: dim.width, height: dim.height });
    } else {
      page.drawRectangle({ x: M, y: y - 6, width: 26, height: 26, color: ACCENT });
      page.drawText(order.company.name.charAt(0).toUpperCase(), {
        x: M + 8, y, size: 15, font: bold, color: rgb(1, 1, 1),
      });
    }
    page.drawText(order.company.name, { x: M + 36, y: y + 2, size: 16, font: bold, color: INK });
    if (order.company.tagline) {
      page.drawText(order.company.tagline.slice(0, 60), { x: M + 36, y: y - 10, size: 8, font, color: GRAY });
    }

    const title = `PEDIDO ${orderNumber(order.number)}`;
    const tw = bold.widthOfTextAtSize(title, 13);
    page.drawText(title, { x: width - M - tw, y: y + 2, size: 13, font: bold, color: ACCENT });
    const dateStr = order.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const sub = `${dateStr} · ${orderStatusLabel[order.status]}`;
    const dw = font.widthOfTextAtSize(sub, 9);
    page.drawText(sub, { x: width - M - dw, y: y - 10, size: 9, font, color: GRAY });

    y -= 46;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: LIGHT });
    y -= 24;

    // ---- Cliente (ficha completa) e vendedor ----
    const c = order.customer;
    page.drawText("CLIENTE", { x: M, y, size: 8, font: bold, color: GRAY });
    page.drawText("VENDEDOR(A)", { x: width / 2 + 40, y, size: 8, font: bold, color: GRAY });
    y -= 14;
    page.drawText(c.name.slice(0, 40), { x: M, y, size: 11, font: bold, color: INK });
    page.drawText(order.seller?.name ?? "—", { x: width / 2 + 40, y, size: 10, font, color: INK });
    y -= 13;

    const lines: string[] = [];
    const contato = [
      c.phone ? `Tel: ${c.phone}` : null,
      c.document ? `CPF/CNPJ: ${c.document}` : null,
    ].filter(Boolean).join("  ·  ");
    if (contato) lines.push(contato);
    if (c.email) lines.push(`E-mail: ${c.email}`);
    const rua = [
      [c.street, c.streetNumber].filter(Boolean).join(", "),
      c.complement,
      c.district,
    ].filter(Boolean).join(" - ");
    const cidade = [ [c.city, c.state].filter(Boolean).join("/"), c.zip ? `CEP ${c.zip}` : null ]
      .filter(Boolean).join("  ·  ");
    if (rua) lines.push(rua);
    if (cidade) lines.push(cidade);
    if (!lines.length) lines.push("Sem dados de contato — preencher no sistema");
    for (const line of lines) {
      page.drawText(line.slice(0, 80), { x: M, y, size: 9, font, color: GRAY });
      y -= 12;
    }

    // ---- Forma de pagamento e forma de envio (no topo, para a expedição) ----
    y -= 16;
    const col2 = width / 2 + 40;
    const pagamento = order.payments.length
      ? [...new Set(order.payments.map((p) => paymentMethodLabel[p.method]))].join(", ")
      : "A definir";
    const envio = order.shipping?.method?.trim() || "A definir";
    const rastreio = order.shipping?.trackingCode?.trim();
    page.drawText("FORMA DE PAGAMENTO", { x: M, y, size: 8, font: bold, color: GRAY });
    page.drawText("FORMA DE ENVIO", { x: col2, y, size: 8, font: bold, color: GRAY });
    y -= 14;
    page.drawText(pagamento.slice(0, 40), { x: M, y, size: 11, font: bold, color: INK });
    page.drawText(envio.slice(0, 40), { x: col2, y, size: 11, font: bold, color: INK });
    y -= 13;
    if (rastreio) {
      page.drawText(`Rastreio: ${rastreio}`.slice(0, 50), { x: col2, y, size: 9, font, color: GRAY });
      y -= 12;
    }

    // ---- Tabela de itens com caixa de conferência ----
    y -= 18;
    page.drawRectangle({ x: M, y: y - 6, width: width - 2 * M, height: 22, color: LIGHT });
    const cols = { check: M + 10, photo: M + 30, item: M + 66, qty: 360, unit: 420, total: width - M - 10 };
    page.drawText("CONF.", { x: cols.check - 2, y, size: 8, font: bold, color: GRAY });
    page.drawText("PRODUTO", { x: cols.item, y, size: 8, font: bold, color: GRAY });
    page.drawText("QTD", { x: cols.qty, y, size: 8, font: bold, color: GRAY });
    page.drawText("UNIT.", { x: cols.unit, y, size: 8, font: bold, color: GRAY });
    const th = bold.widthOfTextAtSize("TOTAL", 8);
    page.drawText("TOTAL", { x: cols.total - th, y, size: 8, font: bold, color: GRAY });
    y -= 26;

    const ROW = 34; // altura da linha: cabe a miniatura de 26px
    for (const item of order.items) {
      newPageIfNeeded(ROW + 4);
      // caixinha de conferência
      page.drawRectangle({
        x: cols.check, y: y - 3, width: 12, height: 12,
        borderColor: GRAY, borderWidth: 1,
      });
      // miniatura da peça (quando o produto tem foto)
      const foto = item.productId ? fotoByProduct.get(item.productId) : null;
      if (foto) {
        const d = foto.scaleToFit(26, 26);
        page.drawImage(foto, {
          x: cols.photo + (26 - d.width) / 2,
          y: y - 16 + (26 - d.height) / 2,
          width: d.width,
          height: d.height,
        });
      } else {
        // moldura leve no lugar da foto, pra manter o alinhamento
        page.drawRectangle({
          x: cols.photo, y: y - 16, width: 26, height: 26,
          borderColor: LIGHT, borderWidth: 1,
        });
      }
      page.drawText(item.name.slice(0, 38), { x: cols.item, y, size: 10, font: bold, color: INK });
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
      y -= ROW;
      page.drawLine({ start: { x: M, y: y + 8 }, end: { x: width - M, y: y + 8 }, thickness: 0.5, color: LIGHT });
    }

    // ---- Totais ----
    newPageIfNeeded(110);
    y -= 8;
    const totalPieces = order.items.reduce((a, i) => a + i.quantity, 0);
    const totals: [string, string, boolean][] = [
      [`Peças (${totalPieces})`, money(order.subtotal), false],
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
        x: cols.unit - lw - 8, y, size, font: f, color: strong ? ACCENT : GRAY,
      });
      page.drawText(value, {
        x: cols.total - vw, y, size, font: f, color: strong ? ACCENT : INK,
      });
      y -= strong ? 22 : 16;
    }

    // ---- Observações ----
    if (order.notes) {
      newPageIfNeeded(60);
      y -= 8;
      page.drawText("OBSERVAÇÕES", { x: M, y, size: 8, font: bold, color: GRAY });
      y -= 13;
      for (const line of order.notes.split("\n").slice(0, 4)) {
        page.drawText(line.slice(0, 110), { x: M, y, size: 9, font, color: INK });
        y -= 12;
      }
    }

    // ---- Bloco de conferência final ----
    newPageIfNeeded(80);
    y -= 24;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: LIGHT });
    y -= 22;
    page.drawText("Conferido por: ______________________________", {
      x: M, y, size: 10, font, color: INK,
    });
    page.drawText("Data: ____/____/______", {
      x: width / 2 + 40, y, size: 10, font, color: INK,
    });

    // Rodapé em todas as páginas
    const pages = pdf.getPages();
    pages.forEach((pg, i) => {
      pg.drawText(
        `Romaneio do pedido ${orderNumber(order.number)} · ${order.company.name}${pages.length > 1 ? ` · pág. ${i + 1}/${pages.length}` : ""}`,
        { x: M, y: 40, size: 8, font, color: GRAY }
      );
    });

    const bytes = await pdf.save();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="pedido-${orderNumber(order.number).replace("#", "")}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
