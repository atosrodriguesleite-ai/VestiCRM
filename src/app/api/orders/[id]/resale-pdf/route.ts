import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Catálogo de REVENDA em PDF — o lojista/sacoleira encaminha ao cliente da
 * ponta. Uma grade limpa com as FOTOS e os modelos que ele comprou neste
 * pedido, SEM identidade da loja de atacado (para o revendedor apresentar
 * as peças como dele). Preço é opcional:
 *   ?preco=nao                 → sem preço (o revendedor negocia no chat)
 *   ?preco=margem&markup=100   → preço = valor pago × (1 + 100%)
 * A margem informada é guardada na ficha do lojista para os próximos PDFs.
 */

const INK = rgb(0.114, 0.106, 0.078); // espresso suave
const GRAY = rgb(0.45, 0.42, 0.36);
const LINE = rgb(0.89, 0.86, 0.8);

const money = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

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

    // modo de preço
    const priceMode = req.nextUrl.searchParams.get("preco") ?? "nao";
    const markup = Math.max(
      0,
      parseFloat(req.nextUrl.searchParams.get("markup") ?? "0") || 0
    );
    // guarda a margem na ficha do lojista (lembrada nos próximos PDFs)
    if (priceMode === "margem") {
      await db.customer.update({
        where: { id: order.customerId },
        data: { resaleMarkup: markup },
      });
    }
    const showPrice = priceMode === "margem";
    const resalePrice = (paid: number) => paid * (1 + markup / 100);

    // uma "peça" por produto (agrupa cores/tamanhos do mesmo modelo); pega a
    // primeira foto real do produto para embutir no PDF
    const byProduct = new Map<
      string,
      { name: string; paid: number; productId: string | null }
    >();
    for (const it of order.items) {
      const key = it.productId ?? it.name;
      if (!byProduct.has(key)) {
        // mantém o nome completo (com a cor, quando faz parte do modelo) —
        // é informação útil para o consumidor da ponta
        byProduct.set(key, { name: it.name, paid: it.unitPrice, productId: it.productId });
      }
    }
    const productIds = [...byProduct.values()]
      .map((p) => p.productId)
      .filter((v): v is string => !!v);
    const images = await db.productImage.findMany({
      where: { productId: { in: productIds } },
      orderBy: { order: "asc" },
    });
    const firstImage = new Map<string, string>();
    for (const img of images) {
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
    const imgH = cardW * 1.25; // proporção retrato
    const cardH = imgH + 44;

    // cabeçalho simples (sem marca do atacado)
    const drawHeader = () => {
      page.drawText("Catálogo", { x: M, y: height - 52, size: 22, font: bold, color: INK });
      page.drawText("Peças selecionadas — peça já a sua!", {
        x: M,
        y: height - 70,
        size: 10,
        font,
        color: GRAY,
      });
      page.drawLine({
        start: { x: M, y: height - 84 },
        end: { x: width - M, y: height - 84 },
        thickness: 1,
        color: LINE,
      });
    };
    drawHeader();

    let col = 0;
    let y = height - 84 - GAP - cardH;

    for (const item of byProduct.values()) {
      if (y < M) {
        page = pdf.addPage(A4);
        y = height - M - cardH;
        col = 0;
      }
      const x = M + col * (cardW + GAP);

      // moldura da foto
      page.drawRectangle({
        x,
        y,
        width: cardW,
        height: cardH,
        borderColor: LINE,
        borderWidth: 1,
        color: rgb(0.99, 0.98, 0.96),
      });

      // foto embutida
      const url = item.productId ? firstImage.get(item.productId) : null;
      let embedded = null;
      if (url && url.startsWith("data:")) {
        try {
          const b64 = url.split(",")[1];
          const bytes = Buffer.from(b64, "base64");
          embedded = url.startsWith("data:image/png")
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes);
        } catch {
          embedded = null;
        }
      }
      // área da foto: topo do card (deixa 40px embaixo para nome/preço)
      const padImg = 6;
      const areaX = x + padImg;
      const areaBottom = y + 40;
      const areaW = cardW - padImg * 2;
      const areaH = cardH - 40 - padImg;
      if (embedded) {
        // contém a foto inteira dentro da área, centralizada (nunca vaza)
        const fit = embedded.scaleToFit(areaW, areaH);
        page.drawImage(embedded, {
          x: areaX + (areaW - fit.width) / 2,
          y: areaBottom + (areaH - fit.height) / 2,
          width: fit.width,
          height: fit.height,
        });
      } else {
        page.drawText("sem foto", {
          x: areaX + areaW / 2 - 18,
          y: areaBottom + areaH / 2,
          size: 9,
          font,
          color: GRAY,
        });
      }

      // nome do modelo + preço opcional
      const name = item.name.slice(0, 34);
      page.drawText(name, { x: x + 8, y: y + 22, size: 10, font: bold, color: INK });
      if (showPrice) {
        page.drawText(money(resalePrice(item.paid)), {
          x: x + 8,
          y: y + 8,
          size: 11,
          font: bold,
          color: rgb(0.77, 0.38, 0.18), // cobre
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
        "Content-Disposition": `attachment; filename="catalogo-revenda-${order.number}.pdf"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
