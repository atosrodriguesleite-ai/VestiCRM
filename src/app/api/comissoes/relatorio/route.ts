import { NextRequest, NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFString,
  PDFArray,
  type RGB,
  type PDFPage,
} from "pdf-lib";
import { paginaSegura } from "@/lib/pdf-texto";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { orderNumber, orderStatusLabel, round2, PAID_ORDER_STATUSES } from "@/lib/orders";
import { appBaseUrl } from "@/lib/comm/evolution";

/**
 * Extrato de comissão do vendedor em PDF — conferência ANTES de pagar.
 *
 * Pedido a pedido: quando o orçamento foi montado, quando foi PAGO (a data
 * que decide o mês), de onde veio, base e comissão. O número do pedido é um
 * link clicável direto para a tela dele no sistema. Fecha com a regra de
 * cálculo por extenso e espaço de assinatura — vira comprovante da loja.
 */

const INK = rgb(0.118, 0.161, 0.235); // slate-800
const GRAY = rgb(0.392, 0.455, 0.545); // slate-500
const LIGHT = rgb(0.945, 0.961, 0.976); // slate-100
const GREEN = rgb(0.02, 0.47, 0.34); // emerald-700

const money = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const dia = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

const ORIGEM: Record<string, string> = {
  CATALOGO: "Catálogo",
  NUVEMSHOP: "Loja online",
  MANUAL: "Manual",
};

function hexToRgb(hex: string | null | undefined, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// mesmo recorte de período da tela Comissões (dia em São Paulo)
const SP_OFFSET = 3 * 60 * 60 * 1000;
const spStart = (d?: string | null) => {
  const t = d ? Date.parse(`${d}T00:00:00Z`) : NaN;
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
};
const spEnd = (d?: string | null) => {
  const t = d ? Date.parse(`${d}T23:59:59.999Z`) : NaN;
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    // extrato é instrumento de pagamento: só gerente/admin
    if (!isManagerUp(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    const q = req.nextUrl.searchParams;
    const sellerId = q.get("seller") ?? "";
    const now = new Date();
    const spNow = new Date(now.getTime() - SP_OFFSET);
    const defFrom = new Date(
      Date.UTC(spNow.getUTCFullYear(), spNow.getUTCMonth(), 1) + SP_OFFSET
    );
    const from = spStart(q.get("de")) ?? defFrom;
    const to = spEnd(q.get("ate")) ?? now;

    const [seller, company] = await Promise.all([
      db.user.findFirst({
        where: { id: sellerId, companyId: user.companyId },
        select: { id: true, name: true, commissionRate: true, active: true },
      }),
      db.company.findUniqueOrThrow({
        where: { id: user.companyId },
        select: { name: true, commissionBase: true, catalogPrimary: true },
      }),
    ]);
    if (!seller)
      return NextResponse.json({ error: "Vendedor não encontrado" }, { status: 404 });

    const base = (company.commissionBase ?? "SUBTOTAL") as "SUBTOTAL" | "VENDIDO";
    const orders = await db.order.findMany({
      where: {
        companyId: user.companyId,
        sellerId: seller.id,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: from, lte: to },
      },
      orderBy: { paidAt: "asc" },
      select: {
        id: true,
        number: true,
        status: true,
        source: true,
        subtotal: true,
        netTotal: true,
        createdAt: true,
        paidAt: true,
        customer: { select: { name: true } },
      },
    });

    const valorBase = (o: { subtotal: number; netTotal: number }) =>
      base === "VENDIDO" ? o.netTotal : o.subtotal;
    const taxa = seller.commissionRate;
    // a comissão é arredondada POR LINHA e o total soma as linhas — assim a
    // conta de cabeça (somar a coluna) bate com o total, centavo por centavo
    // (calcular sobre a base agregada divergia da soma das linhas impressas)
    const comissaoDaLinha = (o: { subtotal: number; netTotal: number }) =>
      round2((valorBase(o) * taxa) / 100);
    const totalBase = round2(orders.reduce((s, o) => s + valorBase(o), 0));
    const totalComissao = round2(orders.reduce((s, o) => s + comissaoDaLinha(o), 0));

    const ACCENT = hexToRgb(company.catalogPrimary, rgb(0.055, 0.004, 0.259));
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const A4: [number, number] = [595.28, 841.89];
    const M = 48;
    let page = paginaSegura(pdf.addPage(A4));
    const { width, height } = page.getSize();
    let y = height - 60;

    // link clicável (o PDF é vivo: número do pedido abre a tela do pedido)
    const addLink = (pg: PDFPage, x: number, yy: number, w: number, h: number, url: string) => {
      const annot = pdf.context.register(
        pdf.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [x, yy, x + w, yy + h],
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
        })
      );
      const existing = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (existing) existing.push(annot);
      else pg.node.set(PDFName.of("Annots"), pdf.context.obj([annot]));
    };

    // cabeçalho da tabela (repete quando a lista vira a página)
    const cols = { pedido: M, cliente: M + 78, orc: 288, pago: 352, basex: width - M - 78, com: width - M };
    const drawTableHead = () => {
      page.drawRectangle({ x: M, y: y - 6, width: width - 2 * M, height: 22, color: LIGHT });
      page.drawText("PEDIDO", { x: cols.pedido + 4, y, size: 8, font: bold, color: GRAY });
      page.drawText("CLIENTE", { x: cols.cliente, y, size: 8, font: bold, color: GRAY });
      page.drawText("ORÇAMENTO", { x: cols.orc, y, size: 8, font: bold, color: GRAY });
      page.drawText("PAGO EM", { x: cols.pago, y, size: 8, font: bold, color: GRAY });
      const bw = bold.widthOfTextAtSize("BASE", 8);
      page.drawText("BASE", { x: cols.basex - bw, y, size: 8, font: bold, color: GRAY });
      const cw = bold.widthOfTextAtSize("COMISSÃO", 8);
      page.drawText("COMISSÃO", { x: cols.com - cw, y, size: 8, font: bold, color: GRAY });
      y -= 26;
    };
    const newPageIfNeeded = (needed: number, comCabecalho = true) => {
      if (y - needed < 80) {
        page = paginaSegura(pdf.addPage(A4));
        y = height - 60;
        if (comCabecalho) drawTableHead();
      }
    };

    // ---- Cabeçalho ----
    page.drawRectangle({ x: M, y: y - 6, width: 26, height: 26, color: ACCENT });
    page.drawText(company.name.charAt(0).toUpperCase(), {
      x: M + 8, y, size: 15, font: bold, color: rgb(1, 1, 1),
    });
    page.drawText(company.name, { x: M + 36, y: y + 2, size: 16, font: bold, color: INK });
    page.drawText("Extrato de comissão — conferência para pagamento", {
      x: M + 36, y: y - 10, size: 8, font, color: GRAY,
    });
    const periodo = `${dia(from)} a ${dia(to)}`;
    const pw = bold.widthOfTextAtSize(periodo, 11);
    page.drawText(periodo, { x: width - M - pw, y: y + 2, size: 11, font: bold, color: ACCENT });
    const ger = `gerado em ${now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }).slice(0, 16)}`;
    const gw = font.widthOfTextAtSize(ger, 8);
    page.drawText(ger, { x: width - M - gw, y: y - 10, size: 8, font, color: GRAY });

    y -= 42;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: LIGHT });
    y -= 24;

    // ---- Vendedora ----
    page.drawText("VENDEDOR(A)", { x: M, y, size: 8, font: bold, color: GRAY });
    y -= 15;
    page.drawText(seller.name.slice(0, 45) + (seller.active ? "" : "  (desligada)"), {
      x: M, y, size: 13, font: bold, color: INK,
    });
    y -= 24;

    // ---- Regra de cálculo por extenso (a parte que evita discussão) ----
    const regras = [
      `Comissão = ${base === "VENDIDO" ? "valor VENDIDO (produtos − desconto + acréscimo)" : "valor dos PRODUTOS (antes do desconto)"} × ${String(taxa).replace(".", ",")}%.`,
      "O FRETE nunca entra na comissão — é valor da transportadora, não venda.",
      "Só entra pedido PAGO (orçamento, aguardando pagamento e cancelado ficam de fora).",
      "O pedido conta no período pela DATA DO PAGAMENTO — não pela data do orçamento.",
      "Pedido do catálogo é de quem MANDOU O LINK (?ref da vendedora); sem link de vendedora, nasce sem dona (é da loja).",
      "Troca de vendedor fica registrada no histórico do pedido.",
    ];
    const regraH = 16 + regras.length * 12 + 10;
    page.drawRectangle({
      x: M, y: y - regraH + 12, width: width - 2 * M, height: regraH,
      color: rgb(0.985, 0.973, 0.95),
    });
    page.drawText("REGRA DO CÁLCULO", { x: M + 10, y: y - 2, size: 8, font: bold, color: ACCENT });
    let ry = y - 15;
    for (const r of regras) {
      page.drawText(`•  ${r}`.slice(0, 118), { x: M + 10, y: ry, size: 8, font, color: INK });
      ry -= 12;
    }
    y = ry - 14;

    // ---- Tabela de pedidos ----
    drawTableHead();
    const ROW = 26;
    for (const o of orders) {
      newPageIfNeeded(ROW + 4);
      const num = orderNumber(o.number);
      page.drawText(num, { x: cols.pedido + 4, y, size: 9, font: bold, color: ACCENT });
      // o número é clicável: abre o pedido no sistema (área um pouco maior que o texto)
      addLink(page, cols.pedido, y - 12, 70, 22, `${appBaseUrl()}/pedidos/${o.id}`);
      page.drawText(ORIGEM[o.source] ?? o.source, {
        x: cols.pedido + 4, y: y - 10, size: 7, font, color: GRAY,
      });
      page.drawText(o.customer.name.slice(0, 30), { x: cols.cliente, y, size: 9, font, color: INK });
      page.drawText(orderStatusLabel[o.status].slice(0, 24), {
        x: cols.cliente, y: y - 10, size: 7, font, color: GRAY,
      });
      page.drawText(dia(o.createdAt), { x: cols.orc, y, size: 9, font, color: GRAY });
      page.drawText(dia(o.paidAt), { x: cols.pago, y, size: 9, font: bold, color: INK });
      const bTxt = money(valorBase(o));
      page.drawText(bTxt, {
        x: cols.basex - font.widthOfTextAtSize(bTxt, 9), y, size: 9, font, color: INK,
      });
      const cTxt = money(comissaoDaLinha(o));
      page.drawText(cTxt, {
        x: cols.com - bold.widthOfTextAtSize(cTxt, 9), y, size: 9, font: bold, color: GREEN,
      });
      y -= ROW;
      page.drawLine({ start: { x: M, y: y + 8 }, end: { x: width - M, y: y + 8 }, thickness: 0.5, color: LIGHT });
    }
    if (orders.length === 0) {
      page.drawText("Nenhum pedido pago deste vendedor no período.", {
        x: M + 4, y, size: 10, font, color: GRAY,
      });
      y -= 22;
    }

    // ---- Totais ----
    newPageIfNeeded(120, false);
    y -= 6;
    const linhas: [string, string, boolean][] = [
      [`Pedidos pagos (${orders.length})`, money(totalBase), false],
      [`Comissão a pagar (${String(taxa).replace(".", ",")}%)`, money(totalComissao), true],
    ];
    for (const [label, value, strong] of linhas) {
      const f = strong ? bold : font;
      const size = strong ? 13 : 10;
      const lw = f.widthOfTextAtSize(label, size);
      const vw = f.widthOfTextAtSize(value, size);
      page.drawText(label, { x: cols.basex - lw - 14, y, size, font: f, color: strong ? GREEN : GRAY });
      page.drawText(value, { x: cols.com - vw, y, size, font: f, color: strong ? GREEN : INK });
      y -= strong ? 24 : 16;
    }

    // ---- Assinaturas (vira comprovante do pagamento) ----
    newPageIfNeeded(90, false);
    y -= 26;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: LIGHT });
    y -= 24;
    page.drawText("Conferido/pago por: ______________________________", { x: M, y, size: 10, font, color: INK });
    page.drawText("Data: ____/____/______", { x: width / 2 + 60, y, size: 10, font, color: INK });
    y -= 26;
    page.drawText("Recebido por (vendedora): ______________________________", { x: M, y, size: 10, font, color: INK });

    // rodapé em todas as páginas
    const pages = pdf.getPages();
    pages.forEach((pg, i) => {
      pg.drawText(
        `Extrato de comissão · ${seller.name} · ${periodo} · gerado por ${user.name}${pages.length > 1 ? ` · pág. ${i + 1}/${pages.length}` : ""}`,
        { x: M, y: 40, size: 8, font, color: GRAY }
      );
    });

    const bytes = await pdf.save();
    const arquivo = `comissao-${seller.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${arquivo}"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
