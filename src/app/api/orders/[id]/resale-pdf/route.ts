import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Catálogo de REVENDA em PDF — o lojista/sacoleira encaminha ao cliente da
 * ponta. Grade limpa e NEUTRA (preto/branco/cinza, sem cor de marca) com as
 * fotos e modelos que ele comprou. Pode levar o NOME DA LOJA dele. Preço
 * opcional por regra (nunca item a item):
 *   ?preco=nao                        → sem preço
 *   ?preco=margem&markup=100          → valor pago × (1 + 100%)
 *   ?preco=margem&markup=100&round=1  → o mesmo, arredondado para ,90
 * Preferências (margem, arredondar, nome da loja) ficam salvas na ficha do
 * lojista para os próximos PDFs. No rodapé, um convite discreto ao AtacadoPro.
 */

const BLACK = rgb(0.08, 0.08, 0.08);
const GRAY = rgb(0.42, 0.42, 0.42);
const SOFT = rgb(0.62, 0.62, 0.62);
const LINE = rgb(0.85, 0.85, 0.85);
const CARDBG = rgb(0.98, 0.98, 0.98);

const money = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/** Arredondamento psicológico: termina sempre em ,90 (ex.: 70 → 69,90; 65 → 64,90). */
const charm = (v: number) => Math.max(0, Math.round(v) - 0.1);

const MAIN_SITE = (
  process.env.MAIN_SITE_URL?.trim() || "https://www.atacadopro.com"
).replace(/^https?:\/\//, "");

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
    const storeName = (sp.get("loja") ?? "").trim().slice(0, 60);
    const showPrice = priceMode === "margem";

    // guarda as preferências na ficha do lojista (lembradas no próximo PDF)
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

    // uma "peça" por produto; pega a primeira foto real para embutir
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
    const imgs = await db.productImage.findMany({
      where: { productId: { in: productIds } },
      orderBy: { order: "asc" },
    });
    const firstImage = new Map<string, string>();
    for (const img of imgs) {
      if (!firstImage.has(img.productId)) firstImage.set(img.productId, img.url);
    }

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const A4: [number, number] = [595.28, 841.89];
    const M = 40;
    const COLS = 2;
    const GAP = 20;
    let page = pdf.addPage(A4);
    const { width, height } = page.getSize();
    const cardW = (width - M * 2 - GAP * (COLS - 1)) / COLS;
    const imgAreaH = cardW * 1.28;
    const cardH = imgAreaH + 42;
    const HEADER_BOTTOM = height - 92;
    const FOOTER_TOP = 54;

    // rodapé (marketing discreto do AtacadoPro) em todas as páginas
    const drawFooter = () => {
      page.drawLine({
        start: { x: M, y: FOOTER_TOP + 14 },
        end: { x: width - M, y: FOOTER_TOP + 14 },
        thickness: 0.5,
        color: LINE,
      });
      const l1 = "Catálogo criado com AtacadoPro";
      const l2 = `Quer o seu catálogo profissional? ${MAIN_SITE}`;
      const w1 = font.widthOfTextAtSize(l1, 8);
      const w2 = bold.widthOfTextAtSize(l2, 8);
      page.drawText(l1, { x: (width - w1) / 2, y: FOOTER_TOP, size: 8, font, color: SOFT });
      page.drawText(l2, { x: (width - w2) / 2, y: FOOTER_TOP - 11, size: 8, font: bold, color: GRAY });
    };

    const drawHeader = () => {
      if (storeName) {
        page.drawText(storeName, { x: M, y: height - 52, size: 22, font: bold, color: BLACK });
        page.drawText("CATÁLOGO DE NOVIDADES", {
          x: M, y: height - 68, size: 9, font, color: GRAY,
        });
      } else {
        page.drawText("Catálogo", { x: M, y: height - 52, size: 22, font: bold, color: BLACK });
        page.drawText("Peças selecionadas — garanta a sua!", {
          x: M, y: height - 68, size: 10, font, color: GRAY,
        });
      }
      page.drawLine({
        start: { x: M, y: HEADER_BOTTOM },
        end: { x: width - M, y: HEADER_BOTTOM },
        thickness: 1,
        color: LINE,
      });
    };

    drawHeader();
    drawFooter();

    let col = 0;
    let y = HEADER_BOTTOM - GAP - cardH;

    for (const item of byProduct.values()) {
      if (y < FOOTER_TOP + 26) {
        page = pdf.addPage(A4);
        drawFooter();
        y = height - M - cardH;
        col = 0;
      }
      const x = M + col * (cardW + GAP);

      page.drawRectangle({
        x, y, width: cardW, height: cardH,
        borderColor: LINE, borderWidth: 1, color: CARDBG,
      });

      // foto: ocupa o topo do card, contida e centralizada (nunca vaza)
      const pad = 6;
      const areaX = x + pad;
      const areaBottom = y + 38;
      const areaW = cardW - pad * 2;
      const areaH = cardH - 38 - pad;
      const url = item.productId ? firstImage.get(item.productId) : null;
      let embedded = null;
      if (url && url.startsWith("data:")) {
        try {
          const bytes = Buffer.from(url.split(",")[1], "base64");
          embedded = url.startsWith("data:image/png")
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes);
        } catch {
          embedded = null;
        }
      }
      if (embedded) {
        const fit = embedded.scaleToFit(areaW, areaH);
        page.drawImage(embedded, {
          x: areaX + (areaW - fit.width) / 2,
          y: areaBottom + (areaH - fit.height) / 2,
          width: fit.width,
          height: fit.height,
        });
      } else {
        page.drawText("sem foto", {
          x: areaX + areaW / 2 - 18, y: areaBottom + areaH / 2,
          size: 9, font, color: SOFT,
        });
      }

      page.drawText(item.name.slice(0, 34), {
        x: x + 8, y: y + 20, size: 10, font: bold, color: BLACK,
      });
      if (showPrice) {
        page.drawText(money(price(item.paid)), {
          x: x + 8, y: y + 7, size: 11, font: bold, color: BLACK,
        });
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
