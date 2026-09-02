import { NextRequest, NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { paginaSegura, quebrarEmLinhas, textoPdf } from "@/lib/pdf-texto";
import { corIgual } from "@/lib/capa-por-cor";
import sharp from "sharp";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";

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

// pedidos grandes: TODA foto é recortada e reconvertida (sharp) — leva segundos
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
 *  (hifens especiais, espaco fino...) e o textoPdf tira o resto (emoji e
 *  os codigos de controle que derrubam ate a MEDICAO de largura \u2014 a
 *  paginaSegura protege so o drawText, nao o widthOfTextAtSize). */
const MAP: Record<string, string> = {
  "\u2011": "-", "\u2009": " ", "\u00a0": " ", "\u200b": "",
};
const safe = (s: string) =>
  textoPdf([...s].map((ch) => MAP[ch] ?? ch).join(""));

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
      where: { id, ...orderScope(user) },
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

    // preferências LEMBRADAS, nunca apagadas: gerar o PDF com o campo de
    // loja vazio zerava o resaleStoreName salvo da lojista (auditoria
    // 07/08/2026) — agora só persiste o que veio preenchido
    const lembrar = {
      ...(showPrice ? { resaleMarkup: markup, resaleRound: round } : {}),
      ...(storeName ? { resaleStoreName: storeName } : {}),
    };
    if (Object.keys(lembrar).length > 0) {
      await db.customer.update({
        where: { id: order.customerId },
        data: lembrar,
      });
    }

    const price = (paid: number) => {
      const v = paid * (1 + markup / 100);
      return round ? charm(v) : v;
    };

    // Um card POR COR, com a MESMA foto do romaneio (a da cor comprada,
    // guardada no item): a capa geral do produto mostrava a bermuda PRATA
    // num pedido da PRETA — a cliente da ponta reclamou, com razão. Duas
    // cores da mesma peça também viravam um card só; agora cada uma aparece.
    const byPeca = new Map<
      string,
      {
        name: string;
        color: string | null;
        paid: number;
        productId: string | null;
        imageUrl: string | null;
      }
    >();
    for (const it of order.items) {
      const key = `${it.productId ?? it.name}|${it.color ?? ""}`;
      if (!byPeca.has(key)) {
        byPeca.set(key, {
          name: it.name,
          color: it.color,
          paid: it.unitPrice,
          productId: it.productId,
          imageUrl: it.imageUrl,
        });
      }
    }
    const productIds = [...byPeca.values()]
      .map((p) => p.productId)
      .filter((v): v is string => !!v);
    // 1º passo (molde do romaneio): galeria LEVE (id + cor, sem base64)
    const imgRows = await db.productImage.findMany({
      where: { productId: { in: productIds } },
      select: { id: true, productId: true, color: true },
      orderBy: { order: "asc" },
    });
    const galeriaPorProduto = new Map<string, typeof imgRows>();
    for (const img of imgRows) {
      const l = galeriaPorProduto.get(img.productId);
      if (l) l.push(img);
      else galeriaPorProduto.set(img.productId, [img]);
    }

    // 2º passo: a foto de cada card, em ordem de preferência — a guardada no
    // ITEM (a mesma do romaneio); item antigo sem foto guardada cai na foto
    // DA COR na galeria (corIgual, nunca "contém"); capa geral por último.
    const fonteDireta = new Map<string, string>(); // key → data-URL já no item
    const candidatos = new Map<string, string[]>(); // key → ids por preferência
    for (const [key, p] of byPeca) {
      if (p.imageUrl?.startsWith("data:")) {
        fonteDireta.set(key, p.imageUrl);
        continue;
      }
      const ids: string[] = [];
      const ref = p.imageUrl?.match(/^\/api\/img\/([a-z0-9]+)/i);
      if (ref) ids.push(ref[1]);
      const galeria = p.productId ? (galeriaPorProduto.get(p.productId) ?? []) : [];
      const daCor = galeria.find((f) => corIgual(f.color, p.color));
      if (daCor) ids.push(daCor.id);
      if (galeria[0]) ids.push(galeria[0].id);
      candidatos.set(key, [...new Set(ids)]);
    }

    // 3º passo: o CONTEÚDO (pesado) só das primeiras escolhas, numa busca só;
    // se alguma faltar (foto apagada), UMA segunda busca pega os planos B.
    const urlPorImagem = new Map<string, string>();
    const buscarConteudo = async (ids: string[]) => {
      if (ids.length === 0) return;
      const rows = await db.productImage.findMany({
        // RN-013: mesmo buscando por id, a consulta não sai da loja
        where: { id: { in: ids }, product: { companyId: user.companyId } },
        select: { id: true, url: true },
      });
      for (const r of rows) urlPorImagem.set(r.id, r.url);
    };
    await buscarConteudo([
      ...new Set(
        [...candidatos.values()].map((c) => c[0]).filter((v): v is string => !!v)
      ),
    ]);
    const faltantes = [...candidatos.values()]
      .filter((c) => c.length > 0 && !urlPorImagem.has(c[0]))
      .flatMap((c) => c.slice(1));
    await buscarConteudo([...new Set(faltantes)]);

    const urlDaPeca = (key: string): string | null => {
      const direta = fonteDireta.get(key);
      if (direta) return direta;
      for (const id of candidatos.get(key) ?? []) {
        const u = urlPorImagem.get(id);
        if (u) return u;
      }
      return null;
    };

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const A4: [number, number] = [595.28, 841.89];
    const M = 44;
    const COLS = 2;
    const GAP = 26;
    const width = A4[0];
    const height = A4[1];
    const HEADER_H = 62; // faixa preta do topo, compacta: o foco são as peças
    const FOOTER_H = 40; // faixa preta do rodapé
    const cardW = (width - M * 2 - GAP * (COLS - 1)) / COLS;
    const imgH = cardW * 1.22; // fotos maiores (espaço ganho do cabeçalho)
    // A foto é ENCAIXADA num quadro de proporção exata (~2,6x em pixels,
    // para sair nítida na impressão) — inteira, sem recorte (ver abaixo).
    const FOTO_W = 640;
    const FOTO_H = Math.round(FOTO_W * (imgH / cardW));

    // A foto sai INTEIRA (fit: contain), com o fundo neutro completando o
    // quadro — o "cover" que imitava o card do catálogo online cortava a
    // peça e as pernas da modelo na foto de corpo inteiro, e revendedora
    // vende com a foto completa (reclamação de cliente real, 02/09/2026).
    // O quadro continua com a MEDIDA EXATA para todos os cards (o fundo é
    // gravado na própria imagem), então a grade segue alinhada — que era o
    // problema que levou ao cover. De quebra, converte WebP e afins em JPEG
    // (PDF só embute JPEG/PNG).
    const prepararFoto = async (
      url: string | null
    ): Promise<{ bytes: Buffer; png: boolean; cover: boolean } | null> => {
      if (!url) return null;
      try {
        let bytes: Buffer;
        if (url.startsWith("data:")) {
          bytes = Buffer.from(url.split(",")[1], "base64");
        } else if (/^https?:\/\//i.test(url)) {
          // loja Nuvemshop guarda o LINK da foto — busca como o romaneio
          const res = await fetch(url);
          if (!res.ok) return null;
          bytes = Buffer.from(await res.arrayBuffer());
        } else {
          return null;
        }
        try {
          const jpg = await sharp(bytes)
            .rotate()
            .flatten({ background: "#f6f6f6" }) // PNG transparente ganha o fundo neutro
            .resize(FOTO_W, FOTO_H, { fit: "contain", background: "#f6f6f6" })
            .jpeg({ quality: 85 })
            .toBuffer();
          return { bytes: jpg, png: false, cover: true };
        } catch {
          // plano B: embute a foto como veio, desenhada inteira no quadro
          const ehPng =
            url.startsWith("data:image/png") || /\.png(\?|$)/i.test(url);
          return { bytes, png: ehPng, cover: false };
        }
      } catch {
        return null;
      }
    };

    // Recorta em lotes de 4 ANTES de montar as páginas: uma a uma, pedido
    // grande flertava com os 60s da rota; todas de uma vez pesa a memória.
    const fotos = new Map<
      string,
      { bytes: Buffer; png: boolean; cover: boolean } | null
    >();
    const chaves = [...byPeca.keys()];
    for (let i = 0; i < chaves.length; i += 4) {
      await Promise.all(
        chaves.slice(i, i + 4).map(async (key) => {
          fotos.set(key, await prepararFoto(urlDaPeca(key)));
        })
      );
    }
    const NOME_SIZE = 10.5;
    const NOME_LH = 13; // entrelinha do nome
    const CONTENT_TOP = height - HEADER_H - 14;
    const CONTENT_BOTTOM = FOOTER_H + 18;

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
      center(page, spaced(storeName ? "Novidades" : "Catálogo"), cx, height - 22, 6.5, font, CREME_DIM);
      center(page, storeName || "Catálogo", cx, height - 44, 17, bold, CREME);
      // filete curto creme sob o nome
      page.drawLine({
        start: { x: cx - 18, y: height - 52 },
        end: { x: cx + 18, y: height - 52 },
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

    /** Quebra o nome em linhas que cabem na coluna — o nome sai INTEIRO.
     *  Antes ele era cortado com "..." e a cliente da ponta não sabia qual
     *  peça era ("Legging básica poliamida premium + Top Kes...").
     *  Mesmo quebrador do romaneio (pdf-texto): o teto de 6 linhas só existe
     *  para um nome absurdo não estourar a página — nome real usa 1 a 3. */
    const quebraNome = (texto: string): string[] =>
      quebrarEmLinhas(
        safe(texto),
        (t) => bold.widthOfTextAtSize(t, NOME_SIZE),
        cardW - 6,
        6
      );

    let page = paginaSegura(pdf.addPage(A4));
    drawHeader(page);
    let yTopo = CONTENT_TOP;

    // Desenha FILEIRA a fileira: a legenda cresce com o nome e a dupla da
    // mesma fileira compartilha a altura — a grade continua alinhada.
    // o card diz a COR (como o romaneio) — a menos que o nome já a contenha
    // como PALAVRA INTEIRA ("Vestido Azulão" não engole o "— Azul")
    const semAcento = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const escapaRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nomeJaTemCor = (nome: string, cor: string) =>
      new RegExp(`(^|\\P{L})${escapaRegex(semAcento(cor))}(\\P{L}|$)`, "u").test(
        semAcento(nome)
      );
    const rotulo = (p: { name: string; color: string | null }) =>
      p.color && !nomeJaTemCor(p.name, p.color)
        ? `${p.name} — ${p.color}`
        : p.name;

    const itens = [...byPeca.entries()];
    for (let i = 0; i < itens.length; i += COLS) {
      const fileira = itens.slice(i, i + COLS);
      const nomes = fileira.map(([, it]) => quebraNome(rotulo(it)));
      const maxLinhas = Math.max(...nomes.map((l) => l.length));
      // 16 até a 1ª linha do nome + entrelinhas + preço + respiro embaixo
      const capH = 16 + (maxLinhas - 1) * NOME_LH + (showPrice ? 15 : 0) + 9;
      const cardH = imgH + capH;
      if (yTopo - cardH < CONTENT_BOTTOM) {
        page = paginaSegura(pdf.addPage(A4));
        drawHeader(page);
        yTopo = CONTENT_TOP;
      }

      for (let c = 0; c < fileira.length; c++) {
        const [key, item] = fileira[c];
        const boxX = M + c * (cardW + GAP);
        const boxY = yTopo - imgH;
        // fundo neutro (só aparece quando não há foto)
        page.drawRectangle({ x: boxX, y: boxY, width: cardW, height: imgH, color: PHOTOBG });

        let embedded = null;
        let preencheQuadro = false; // recortada na medida exata do quadro
        const foto = fotos.get(key);
        if (foto) {
          try {
            embedded = foto.png
              ? await pdf.embedPng(foto.bytes)
              : await pdf.embedJpg(foto.bytes);
            preencheQuadro = foto.cover;
          } catch {
            embedded = null;
          }
        }
        if (embedded && preencheQuadro) {
          page.drawImage(embedded, { x: boxX, y: boxY, width: cardW, height: imgH });
        } else if (embedded) {
          // "contain": a foto inteira, centralizada; a sobra fica no fundo neutro
          const scale = Math.min(cardW / embedded.width, imgH / embedded.height);
          const w = embedded.width * scale;
          const h = embedded.height * scale;
          const ix = boxX + (cardW - w) / 2;
          const iy = boxY + (imgH - h) / 2;
          page.drawImage(embedded, { x: ix, y: iy, width: w, height: h });
        } else {
          center(page, "sem foto", boxX + cardW / 2, boxY + imgH / 2, 9, font, SOFT);
        }

        // legenda centralizada: nome inteiro (linha a linha) + preço
        const cx = boxX + cardW / 2;
        nomes[c].forEach((linha, k) => {
          center(page, linha, cx, boxY - 16 - k * NOME_LH, NOME_SIZE, bold, BLACK);
        });
        if (showPrice) {
          // preço na MESMA altura para a fileira toda (alinha pela dupla)
          const py = boxY - 16 - (maxLinhas - 1) * NOME_LH - 15;
          center(page, money(price(item.paid)), cx, py, 11.5, bold, BLACK);
        }
      }

      yTopo -= cardH + GAP;
    }

    // marca da plataforma discreta: só no rodapé da ÚLTIMA página
    drawFooter(page);

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
