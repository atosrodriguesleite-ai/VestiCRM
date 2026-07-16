import { NextRequest, NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import sharp from "sharp";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Catálogo de REVENDA em PDF — o lojista/sacoleira encaminha ao cliente da
 * ponta. Estética editorial e NEUTRA (preto/branco/cinza, sem cor de marca),
 * no capricho dos catálogos do sistema. Pode levar o nome da loja do lojista.
 * Preço opcional por regra (nunca item a item):
 *   ?preco=nao
 *   ?preco=margem&markup=100
 *   ?preco=margem&markup=100&round=1   (arredonda para ,90)
 * Preferências (margem, arredondar, nome da loja) ficam salvas na ficha do
 * lojista. Rodapé com convite discreto ao AtacadoPro.
 */

// pedidos grandes: converter fotos (WebP → JPEG) leva alguns segundos
export const maxDuration = 60;

const BLACK = rgb(0.07, 0.07, 0.07);
const GRAY = rgb(0.4, 0.4, 0.4);
const SOFT = rgb(0.62, 0.62, 0.62);
const HAIR = rgb(0.8, 0.8, 0.8);
const PHOTOBG = rgb(0.965, 0.965, 0.965);
const CREME = rgb(0.96, 0.94, 0.9);
const CREME_DIM = rgb(0.72, 0.69, 0.64);

const money = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/** Preço psicológico terminando em ,90 (ex.: 70 → 69,90; 65 → 64,90). */
const charm = (v: number) => Math.max(0, Math.round(v) - 0.1);

const MAIN_SITE = (
  process.env.MAIN_SITE_URL?.trim() || "https://www.atacadopro.com"
).replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Fontes padrao do pdf-lib usam WinAnsi: troca o que ela nao codifica
 *  (em-dash, aspas curvas, espaco fino, emoji...) para nao quebrar. */
const MAP: Record<string, string> = {
  "\u2014": "-", "\u2013": "-", "\u2011": "-", "\u2022": "-", "\u2026": "...",
  "\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'",
  "\u2009": " ", "\u00a0": " ", "\u200b": "",
};
const safe = (s: string) =>
  [...s]
    .map((ch) => (MAP[ch] !== undefined ? MAP[ch] : ch.codePointAt(0)! <= 0xff ? ch : ""))
    .join("");

/** Espaça letras (visual editorial) — pdf-lib não tem letter-spacing. */
const spaced = (s: string) => safe(s).toUpperCase().split("").join(" ");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const order = await db.order.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: true, items: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const sp = req.nextUrl.searchParams;
    const priceMode = sp.get("preco") ?? "nao";
    const markup = Math.max(0, parseFloat(sp.get("markup") ?? "0") || 0);
    const round = sp.get("round") === "1";
    const storeName = (sp.get("loja") ?? "").trim().slice(0, 40);
    const showPrice = priceMode === "margem";

    await db.customer.update({
      where: { id: order.customerId },
      data: {
        ...(showPrice ? { resaleMarkup: markup, resaleRound: round } : {}),
        resaleStoreName: storeName || null,
      },
    });

    const price = (paid: number) => {
      const v = paid * (1 + markup / 100);
      return round ? charm(v) : v;
    };

    const byProduct = new Map<
      string,
      { name: string; paid: number; productId: string | null }
    >();
    for (const it of order.items) {
      const key = it.productId ?? it.name;
      if (!byProduct.has(key)) {
        byProduct.set(key, { name: it.name, paid: it.unitPrice, productId: it.productId });
      }
    }
    const productIds = [...byProduct.values()]
      .map((p) => p.productId)
      .filter((v): v is string => !!v);
    // só a CAPA de cada produto entra no PDF: primeiro descobre qual é (sem
    // puxar base64), depois busca o conteúdo apenas dessas
    const imgRows = await db.productImage.findMany({
      where: { productId: { in: productIds } },
      select: { id: true, productId: true, order: true },
      orderBy: { order: "asc" },
    });
    const coverId = new Map<string, string>();
    for (const img of imgRows) {
      if (!coverId.has(img.productId)) coverId.set(img.productId, img.id);
    }
    const covers = await db.productImage.findMany({
      where: { id: { in: [...coverId.values()] } },
      select: { productId: true, url: true },
    });
    const firstImage = new Map<string, string>();
    for (const img of covers) firstImage.set(img.productId, img.url);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const A4: [number, number] = [595.28, 841.89];
    const M = 44;
    const COLS = 2;
    const GAP = 26;
    const width = A4[0];
    const height = A4[1];
    const HEADER_H = 96; // faixa preta do topo
    const FOOTER_H = 40; // faixa preta do rodapé
    const cardW = (width - M * 2 - GAP * (COLS - 1)) / COLS;
    const imgH = cardW * 1.12; // fotos maiores, mantendo 4 por página
    const capH = 40; // legenda (nome + preço) abaixo da foto
    const cardH = imgH + capH;
    const CONTENT_TOP = height - HEADER_H - 22;
    const CONTENT_BOTTOM = FOOTER_H + 20;

    const center = (
      page: PDFPage,
      text: string,
      cx: number,
      y: number,
      size: number,
      f: PDFFont,
      color = BLACK
    ) => {
      const t = safe(text);
      const w = f.widthOfTextAtSize(t, size);
      page.drawText(t, { x: cx - w / 2, y, size, font: f, color });
    };

    const drawHeader = (page: PDFPage) => {
      const cx = width / 2;
      // faixa preta cheia no topo
      page.drawRectangle({ x: 0, y: height - HEADER_H, width, height: HEADER_H, color: BLACK });
      center(page, spaced(storeName ? "Novidades" : "Catálogo"), cx, height - 40, 8, font, CREME_DIM);
      center(page, storeName || "Catálogo", cx, height - 68, 23, bold, CREME);
      // filete curto creme sob o nome
      page.drawLine({
        start: { x: cx - 22, y: height - 80 },
        end: { x: cx + 22, y: height - 80 },
        thickness: 1,
        color: CREME_DIM,
      });
    };

    const drawFooter = (page: PDFPage) => {
      const cx = width / 2;
      // faixa preta cheia no rodapé
      page.drawRectangle({ x: 0, y: 0, width, height: FOOTER_H, color: BLACK });
      const label = spaced("Catálogo Profissional");
      const ty = FOOTER_H / 2 - 3;
      const wl = font.widthOfTextAtSize(label, 7.5);
      const site = MAIN_SITE;
      const ws = bold.widthOfTextAtSize(site, 8);
      const dot = "   ·   ";
      const wd = font.widthOfTextAtSize(dot, 8);
      const totalW = wl + wd + ws;
      let x = cx - totalW / 2;
      page.drawText(label, { x, y: ty, size: 7.5, font, color: CREME_DIM });
      x += wl;
      page.drawText(dot, { x, y: ty, size: 8, font, color: CREME_DIM });
      x += wd;
      page.drawText(site, { x, y: ty, size: 8, font: bold, color: CREME });
    };

    let page = pdf.addPage(A4);
    drawHeader(page);
    drawFooter(page);

    let col = 0;
    let y = CONTENT_TOP - cardH;

    for (const item of byProduct.values()) {
      if (y < CONTENT_BOTTOM) {
        page = pdf.addPage(A4);
        drawHeader(page);
        drawFooter(page);
        y = CONTENT_TOP - cardH;
        col = 0;
      }
      const x = M + col * (cardW + GAP);

      // fundo neutro (só aparece quando não há foto)
      const boxX = x;
      const boxY = y + capH;
      page.drawRectangle({ x: boxX, y: boxY, width: cardW, height: imgH, color: PHOTOBG });

      let url = item.productId ? (firstImage.get(item.productId) ?? null) : null;
      // atalho /api/img/<id> (legado): resolve para a foto real
      if (url && !url.startsWith("data:")) {
        const ref = url.match(/^\/api\/img\/([a-z0-9]+)/i);
        const target = ref
          ? await db.productImage.findUnique({
              where: { id: ref[1] },
              select: { url: true },
            })
          : null;
        url = target?.url.startsWith("data:") ? target.url : null;
      }
      let embedded = null;
      if (url) {
        try {
          let bytes = Buffer.from(url.split(",")[1], "base64");
          const isPng = url.startsWith("data:image/png");
          const isJpg = /^data:image\/jpe?g/.test(url);
          if (!isPng && !isJpg) {
            // PDF só embute JPEG/PNG; WebP e afins são convertidos na hora
            // (era isto que deixava produtos "sem foto" no catálogo impresso)
            bytes = await sharp(bytes).rotate().jpeg({ quality: 85 }).toBuffer();
          }
          try {
            embedded = isPng
              ? await pdf.embedPng(bytes)
              : await pdf.embedJpg(bytes);
          } catch {
            // último recurso: normaliza qualquer arquivo problemático em JPEG
            const jpg = await sharp(bytes).rotate().jpeg({ quality: 85 }).toBuffer();
            embedded = await pdf.embedJpg(jpg);
          }
        } catch {
          embedded = null;
        }
      }
      if (embedded) {
        // "cover": a foto PREENCHE 100% do quadro (sem sobrar borda de fundo).
        // O excedente é recortado nas bordas; leve viés ao topo para nunca
        // cortar a cabeça da modelo (mantém rosto/tronco, corta pés/sobra).
        const scale = Math.max(cardW / embedded.width, imgH / embedded.height);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        const overflowV = h - imgH; // sobra vertical (quando a foto é mais alta)
        const ix = boxX + (cardW - w) / 2; // centralizado na horizontal
        const iy = boxY - overflowV * 0.68; // topo preservado, corta mais embaixo
        // recorta ao quadro para a foto não invadir a legenda nem o card vizinho
        page.pushOperators(
          pushGraphicsState(),
          moveTo(boxX, boxY),
          lineTo(boxX + cardW, boxY),
          lineTo(boxX + cardW, boxY + imgH),
          lineTo(boxX, boxY + imgH),
          closePath(),
          clip(),
          endPath()
        );
        page.drawImage(embedded, { x: ix, y: iy, width: w, height: h });
        page.pushOperators(popGraphicsState());
      } else {
        center(page, "sem foto", boxX + cardW / 2, boxY + imgH / 2, 9, font, SOFT);
      }

      // legenda centralizada: nome + preço
      const cx = x + cardW / 2;
      const fullName = safe(item.name);
      let name = fullName;
      while (bold.widthOfTextAtSize(name, 10.5) > cardW - 6 && name.length > 4) {
        name = name.slice(0, -1);
      }
      if (name !== fullName) name = name.slice(0, -1) + "...";
      center(page, name, cx, y + capH - 16, 10.5, bold, BLACK);
      if (showPrice) {
        center(page, money(price(item.paid)), cx, y + capH - 31, 11.5, bold, BLACK);
      }

      col++;
      if (col >= COLS) {
        col = 0;
        y -= cardH + GAP;
      }
    }

    const bytes = await pdf.save();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="catalogo-${order.number}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
