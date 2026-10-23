/**
 * O CATÁLOGO EM PDF (RN-094).
 *
 * Pedido do dono (23/10/2026): *"alguns clientes estão reclamando que o
 * catálogo não abre… converter o catálogo que a gente tem online em PDF,
 * como se fosse a página mesmo do website, só que estático"*.
 *
 * O que o PDF resolve que a página não resolve: é UM arquivo. A vitrine são
 * dezenas de idas à internet (uma por foto) e basta uma falhar para a cliente
 * ver tela branca; o PDF baixa de uma vez, fica no aparelho, abre sem
 * internet, sem navegador e sem JavaScript — e ela repassa para a amiga.
 *
 * Três decisões sustentam o arquivo:
 *
 * 1. **O acervo é o MESMO da vitrine** (`acervoDaVitrine` + `secoesDaVitrine`):
 *    as mesmas peças, na mesma ordem, pelo mesmo preço. Copiar a regra faria
 *    o papel divergir do site — e o preço é dinheiro.
 *
 * 2. **O PDF é uma FOTOGRAFIA DO MOMENTO.** Preço e estoque congelam no dia
 *    em que ele foi gerado, e a cliente ainda vai estar com ele daqui a dois
 *    meses. Por isso a capa leva a DATA e a frase de confirmar no WhatsApp —
 *    sem isso alguém pede pelo preço velho e a loja descobre no fechamento.
 *
 * 3. **Tem ORÇAMENTO DE TEMPO.** A função da Vercel morre em 60s e as fotos
 *    moram como data-URL no banco (dívida nº 1). O que não couber no tempo
 *    sai sem foto, e o PDF diz quantas peças ficaram de fora — nunca uma
 *    função morta sem resposta.
 *
 * Desenhado com o pdf-lib, sem navegador — a mesma peça do extrato de
 * comissão (RN-038) e das etiquetas (RN-059). Só as 14 fontes padrão do PDF
 * estão disponíveis (não há fontkit no projeto), então TODO texto passa pelo
 * `paginaSegura` (RN-038: um emoji no nome da peça derruba o arquivo inteiro).
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { paginaSegura, quebrarEmLinhas, textoPdf } from "@/lib/pdf-texto";
import { hexToRgb, makeSwatch } from "@/lib/color";
import { brl } from "@/lib/format";
import { diaSP } from "@/lib/dia";
import { fotoDaCor } from "@/lib/capa-por-cor";
import { contar } from "@/lib/catalogo/unidade";
import { lerFotosParaPdf } from "@/lib/catalogo/foto-do-pdf";
import {
  A4_ALTURA,
  A4_LARGURA,
  LAYOUT,
  larguraDoCard,
  paginar,
  textoDosTamanhos,
  xDaColuna,
} from "@/lib/catalogo/pdf-layout";
import type { PecaDoAcervo } from "@/lib/catalogo/acervo";
import type { CardDaVitrine, SecaoDaVitrine } from "@/lib/catalogo/secoes";

/**
 * Teto de peças num PDF. Acima disso o arquivo passa de ~10 MB e a geração
 * não cabe no relógio da função — a loja grande filtra por categoria (é o
 * mesmo caminho da galeria de fotos, RN-071). O PDF diz quando cortou.
 */
export const TETO_DE_CARDS = 600;

export type IdentidadeDaLoja = {
  nome: string;
  tagline: string | null;
  whatsapp: string | null;
  /** cor principal do catálogo da loja (hex) — a mesma do site */
  primary: string;
  secondary: string;
  /** a logo, já lida e encolhida por quem chama (PNG ou JPEG) */
  logo?: { bytes: Buffer; png: boolean } | null;
  /** cores cadastradas pela loja: nome → hex, para a bolinha da cor */
  cores: { name: string; hex: string }[];
};

export type OpcoesDoPdf = {
  identidade: IdentidadeDaLoja;
  /** o dia em que o catálogo foi gerado (a capa o escreve) */
  geradoEm: Date;
  /**
   * `Company.catalogHideColors` — a loja sem variação de cor (semijoias).
   * O card inverte o destaque, como no site.
   */
  semCores: boolean;
  /** quantos milissegundos ainda há para trabalhar */
  restante: () => number;
};

export type ResultadoDoPdf = {
  bytes: Uint8Array;
  paginas: number;
  pecas: number;
  /** peças que ficaram de fora por causa do teto */
  cortadas: number;
  /** peças que entraram sem foto (o tempo acabou ou a imagem não abriu) */
  semFoto: number;
};

/* ── paleta ─────────────────────────────────────────────────────────────── */

const CREME = rgb(0.98, 0.965, 0.945);
const TINTA = rgb(0.169, 0.141, 0.125);
const SUAVE = rgb(0.52, 0.47, 0.43);
const LINHA = rgb(0.88, 0.85, 0.81);
const MOLDURA = rgb(0.93, 0.915, 0.895);

/** hex da loja → cor do pdf-lib; hex torto não derruba o arquivo */
function corDaLoja(hex: string | null | undefined, reserva: RGB): RGB {
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex.trim())) return reserva;
  const [r, g, b] = hexToRgb(hex.trim());
  return rgb(r / 255, g / 255, b / 255);
}

/** preto ou branco por cima de uma cor — a mesma régua de legibilidade do app */
function tintaSobre(c: RGB): RGB {
  const lum = 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue;
  return lum > 0.6 ? TINTA : rgb(1, 1, 1);
}

/* ── o arquivo ──────────────────────────────────────────────────────────── */

export async function gerarCatalogoPdf(
  secoes: SecaoDaVitrine<PecaDoAcervo>[],
  opcoes: OpcoesDoPdf
): Promise<ResultadoDoPdf> {
  const { identidade, geradoEm, semCores, restante } = opcoes;

  // TETO: corta pelas últimas seções (a loja ordena o catálogo por
  // importância, então o começo é o que ela quer mostrar primeiro)
  let total = 0;
  let cortadas = 0;
  const dentro: SecaoDaVitrine<PecaDoAcervo>[] = [];
  for (const s of secoes) {
    const cabe = Math.max(0, TETO_DE_CARDS - total);
    if (cabe === 0) {
      cortadas += s.cards.length;
      continue;
    }
    const cards = s.cards.slice(0, cabe);
    cortadas += s.cards.length - cards.length;
    total += cards.length;
    dentro.push({ ...s, cards });
  }

  const paginas = paginar(dentro, LAYOUT);

  // as fotos: UMA por card, deduplicadas (o modelo de 4 cores com uma foto
  // só é lido uma vez). O `fotoDaCor` é a MESMA escolha do site
  const idPorCard = new Map<string, string>();
  for (const s of dentro) {
    for (const c of s.cards) {
      const url = fotoDaCor(
        c.product.images.map((i) => ({ url: i.id, color: i.color })),
        c.color
      );
      if (url) idPorCard.set(c.key, url);
    }
  }
  const fotos = await lerFotosParaPdf(
    [...idPorCard.values()],
    restante,
    LAYOUT.fotoAltura / larguraDoCard()
  );

  const pdf = await PDFDocument.create();
  pdf.setTitle(textoPdf(`Catálogo ${identidade.nome}`));
  pdf.setProducer("AtacadoPro");
  pdf.setCreationDate(geradoEm);

  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifIt = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  const primaria = corDaLoja(identidade.primary, rgb(0.584, 0.267, 0.098));
  const swatch = makeSwatch(identidade.cores);

  // as fotos entram no documento UMA vez cada, mesmo usadas em vários cards
  // (o modelo de 4 cores com uma foto só pesaria 4× sem isto)
  const embutidas = new Map<string, PDFImage>();
  const embutir = async (id: string, jpeg: Buffer): Promise<PDFImage> => {
    const pronta = embutidas.get(id);
    if (pronta) return pronta;
    const nova = await pdf.embedJpg(jpeg);
    embutidas.set(id, nova);
    return nova;
  };

  /*
   * TRÊS PEÇAS NA CAPA. Capa só com o nome fica com um vazio no meio da
   * folha (visto na página renderizada) — e o catálogo de moda se vende
   * pela foto. Pegamos uma peça do começo, uma do meio e uma do fim do
   * acervo, para a capa dar uma amostra do que tem dentro.
   */
  const todosOsCards = dentro.flatMap((s) => s.cards);
  const escolhidas: PDFImage[] = [];
  for (const i of [0, Math.floor(todosOsCards.length / 2), todosOsCards.length - 1]) {
    const card = todosOsCards[i];
    const id = card ? idPorCard.get(card.key) : undefined;
    const foto = id ? fotos.get(id) : undefined;
    if (id && foto) escolhidas.push(await embutir(id, foto.jpeg));
  }

  await desenharCapa(pdf, {
    identidade,
    geradoEm,
    pecas: total,
    vitrine: [...new Set(escolhidas)],
    primaria,
    serif,
    serifIt,
    fonte,
    negrito,
  });

  let semFoto = 0;
  for (const [i, pag] of paginas.entries()) {
    const page = paginaSegura(pdf.addPage([A4_LARGURA, A4_ALTURA]));
    page.drawRectangle({
      x: 0,
      y: 0,
      width: A4_LARGURA,
      height: A4_ALTURA,
      color: CREME,
    });
    cabecalhoCorrido(page, identidade.nome, pag.categoria, fonte, primaria);
    rodape(page, i + 2, identidade.whatsapp, fonte);

    for (const linha of pag.linhas) {
      if (linha.titulo) tituloDaCategoria(page, linha.titulo, linha.topoY, serif, fonte);
      for (const [coluna, card] of linha.cards.entries()) {
        const id = idPorCard.get(card.key);
        const foto = id ? fotos.get(id) : undefined;
        if (!foto) semFoto++;
        desenharCard(page, {
          card,
          x: xDaColuna(coluna),
          topoY: linha.topoY,
          imagem: id && foto ? await embutir(id, foto.jpeg) : null,
          fonte,
          negrito,
          primaria,
          swatch,
          semCores,
        });
      }
    }
  }

  if (cortadas > 0) {
    paginaDoCorte(paginaSegura(pdf.addPage([A4_LARGURA, A4_ALTURA])), cortadas, serif, fonte);
  }

  return {
    bytes: await pdf.save(),
    paginas: pdf.getPageCount(),
    pecas: total,
    cortadas,
    semFoto,
  };
}

/* ── capa ───────────────────────────────────────────────────────────────── */

async function desenharCapa(
  pdf: PDFDocument,
  o: {
    identidade: IdentidadeDaLoja;
    geradoEm: Date;
    pecas: number;
    /** até três peças do acervo, para a capa mostrar o que tem dentro */
    vitrine: PDFImage[];
    primaria: RGB;
    serif: PDFFont;
    serifIt: PDFFont;
    fonte: PDFFont;
    negrito: PDFFont;
  }
) {
  const { identidade, geradoEm, pecas, vitrine, primaria, serif, serifIt, fonte, negrito } = o;
  const page = paginaSegura(pdf.addPage([A4_LARGURA, A4_ALTURA]));
  const tinta = tintaSobre(primaria);
  page.drawRectangle({ x: 0, y: 0, width: A4_LARGURA, height: A4_ALTURA, color: primaria });

  // começa mais baixo para o bloco inteiro (nome → peças → data) cair perto
  // do meio da folha: a 150 ele ficava todo na metade de cima, com um vazio
  // grande embaixo (visto na capa renderizada)
  let y = A4_ALTURA - 196;

  // A LOGO, quando a loja tem uma que o servidor conseguiu ler. Loja sem logo
  // (ou com uma que não abre) mostra o NOME grande — nunca um buraco
  if (identidade.logo) {
    try {
      const img = identidade.logo.png
        ? await pdf.embedPng(identidade.logo.bytes)
        : await pdf.embedJpg(identidade.logo.bytes);
      const cabe = img.scaleToFit(280, 110);
      page.drawImage(img, {
        x: (A4_LARGURA - cabe.width) / 2,
        y: y - cabe.height,
        width: cabe.width,
        height: cabe.height,
      });
      y -= cabe.height + 34;
    } catch {
      // logo ilegível: segue sem ela
    }
  }

  const nome = textoPdf(identidade.nome);
  const tamanhoDoNome = escalaQueCabe(nome, serif, 44, A4_LARGURA - 120);
  page.drawText(nome, {
    x: (A4_LARGURA - serif.widthOfTextAtSize(nome, tamanhoDoNome)) / 2,
    y,
    size: tamanhoDoNome,
    font: serif,
    color: tinta,
  });
  y -= 30;

  if (identidade.tagline) {
    const t = textoPdf(identidade.tagline);
    const tam = escalaQueCabe(t, serifIt, 14, A4_LARGURA - 140);
    page.drawText(t, {
      x: (A4_LARGURA - serifIt.widthOfTextAtSize(t, tam)) / 2,
      y,
      size: tam,
      font: serifIt,
      color: tinta,
      opacity: 0.85,
    });
    y -= 26;
  }

  page.drawRectangle({ x: A4_LARGURA / 2 - 36, y: y - 6, width: 72, height: 2, color: tinta, opacity: 0.5 });
  y -= 40;

  // AS PEÇAS: lado a lado, no mesmo recorte do card (já vêm cortadas)
  if (vitrine.length) {
    const larg = 148;
    const alt = Math.round(larg * (LAYOUT.fotoAltura / larguraDoCard()));
    const calha = 14;
    const total = vitrine.length * larg + (vitrine.length - 1) * calha;
    let x = (A4_LARGURA - total) / 2;
    for (const img of vitrine) {
      page.drawImage(img, { x, y: y - alt, width: larg, height: alt });
      x += larg + calha;
    }
    y -= alt + 46;
  } else {
    y -= 60;
  }

  // o miolo: o que o catálogo tem
  const linhaDoMeio = `CATÁLOGO · ${mesPorExtenso(geradoEm).toUpperCase()}`;
  page.drawText(linhaDoMeio, {
    x: (A4_LARGURA - negrito.widthOfTextAtSize(linhaDoMeio, 12)) / 2,
    y,
    size: 12,
    font: negrito,
    color: tinta,
    opacity: 0.9,
  });
  const quantas = `${pecas} ${pecas === 1 ? "opção" : "opções"}`;
  page.drawText(quantas, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(quantas, 11)) / 2,
    y: y - 20,
    size: 11,
    font: fonte,
    color: tinta,
    opacity: 0.75,
  });

  /*
   * O AVISO DA FOTOGRAFIA DO MOMENTO. A cliente vai estar com este arquivo
   * daqui a dois meses — sem a data e sem o "confirme", ela pede pelo preço
   * velho e a loja só descobre no fechamento.
   */
  const aviso = `Preços e disponibilidade de ${diaMesAno(geradoEm)}.`;
  page.drawText(aviso, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(aviso, 10)) / 2,
    y: 148,
    size: 10,
    font: fonte,
    color: tinta,
    opacity: 0.8,
  });
  const confirme = "Confirme com a loja antes de fechar o pedido.";
  page.drawText(confirme, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(confirme, 10)) / 2,
    y: 134,
    size: 10,
    font: fonte,
    color: tinta,
    opacity: 0.8,
  });

  if (identidade.whatsapp) {
    const zap = `Pedidos pelo WhatsApp ${identidade.whatsapp}`;
    page.drawText(zap, {
      x: (A4_LARGURA - negrito.widthOfTextAtSize(zap, 11)) / 2,
      y: 98,
      size: 11,
      font: negrito,
      color: tinta,
    });
  }
}

/* ── páginas de peças ───────────────────────────────────────────────────── */

function cabecalhoCorrido(
  page: PDFPage,
  loja: string,
  categoria: string,
  fonte: PDFFont,
  primaria: RGB
) {
  const y = A4_ALTURA - 40;
  page.drawText(loja.toUpperCase(), {
    x: LAYOUT.margem,
    y,
    size: 7.5,
    font: fonte,
    color: SUAVE,
  });
  const dir = categoria.toUpperCase();
  const larg = fonte.widthOfTextAtSize(textoPdf(dir), 7.5);
  page.drawText(dir, {
    x: A4_LARGURA - LAYOUT.margem - larg,
    y,
    size: 7.5,
    font: fonte,
    color: primaria,
  });
  page.drawRectangle({
    x: LAYOUT.margem,
    y: y - 9,
    width: A4_LARGURA - LAYOUT.margem * 2,
    height: 0.6,
    color: LINHA,
  });
}

function rodape(page: PDFPage, numero: number, whatsapp: string | null, fonte: PDFFont) {
  if (whatsapp) {
    page.drawText(`pedidos pelo WhatsApp ${whatsapp}`, {
      x: LAYOUT.margem,
      y: 28,
      size: 7.5,
      font: fonte,
      color: SUAVE,
    });
  }
  /*
   * Só o NÚMERO, sem "de N". O "1 / 41" contava as páginas de peças e o
   * leitor de PDF mostrava 42 (a capa), então os dois números discordavam na
   * mesma tela — visto na página renderizada.
   */
  const n = String(numero);
  page.drawText(n, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(n, 8)) / 2,
    y: 28,
    size: 8,
    font: fonte,
    color: SUAVE,
  });
}

function tituloDaCategoria(
  page: PDFPage,
  titulo: { categoria: string; totalDeCards: number },
  topoY: number,
  serif: PDFFont,
  fonte: PDFFont
) {
  // o título fica ACIMA da linha de cards: `topoY` já desceu a altura dele
  const y = topoY + LAYOUT.tituloAltura - 26;
  const nome = textoPdf(titulo.categoria);
  const tam = escalaQueCabe(nome, serif, 20, A4_LARGURA - LAYOUT.margem * 2 - 90);
  page.drawText(nome, { x: LAYOUT.margem, y, size: tam, font: serif, color: TINTA });

  // "6 opções" — a mesma palavra que o site usa na seção
  const n = titulo.totalDeCards;
  const texto = `${n} ${n === 1 ? "opção" : "opções"}`;
  const larg = fonte.widthOfTextAtSize(texto, 9);
  page.drawText(texto, {
    x: A4_LARGURA - LAYOUT.margem - larg,
    y: y + 3,
    size: 9,
    font: fonte,
    color: SUAVE,
  });
}

function desenharCard(
  page: PDFPage,
  o: {
    card: CardDaVitrine<PecaDoAcervo>;
    x: number;
    topoY: number;
    imagem: PDFImage | null;
    fonte: PDFFont;
    negrito: PDFFont;
    primaria: RGB;
    swatch: (cor: string) => string;
    semCores: boolean;
  }
) {
  const { card, x, topoY, imagem, fonte, negrito, primaria, swatch, semCores } = o;
  const larg = larguraDoCard();
  const fotoTopo = topoY;
  const fotoBase = fotoTopo - LAYOUT.fotoAltura;

  // moldura da foto: existe mesmo sem imagem, para a grade não "furar"
  page.drawRectangle({
    x,
    y: fotoBase,
    width: larg,
    height: LAYOUT.fotoAltura,
    color: MOLDURA,
  });

  if (imagem) {
    /*
     * A foto já CHEGA recortada na proporção da moldura (o `object-cover
     * object-top` do site, feito pelo sharp em `lerFotosParaPdf`) — numa foto
     * de corpo inteiro o corte come o pé, nunca o rosto e a peça. Desenhar
     * maior que a moldura e tapar as sobras foi a primeira versão e estava
     * errada: a sobra lateral invadia o card vizinho.
     */
    page.drawImage(imagem, { x, y: fotoBase, width: larg, height: LAYOUT.fotoAltura });
  }

  const esgotado = card.sizes.every((s) => !s.available);
  let y = fotoBase - 12;

  /*
   * NOME E COR, com o MESMO destaque do site: normalmente o nome é a linha
   * miúda em maiúsculas e a COR é o negrito com a bolinha. A loja que
   * escondeu as cores (semijoias, `catalogHideColors`) inverte: lá o NOME
   * assume o negrito e a cor não aparece — sem isso o PDF dela destacava
   * "Único" e deixava o nome da peça no texto miúdo (achado da revisão).
   */
  if (semCores) {
    const [linha] = quebrarEmLinhas(
      card.product.name,
      (t) => negrito.widthOfTextAtSize(t, 9.5),
      larg,
      1
    );
    page.drawText(linha, { x, y: y - 4, size: 9.5, font: negrito, color: TINTA });
    y -= 24;
  } else {
    const nome = card.product.name.toUpperCase();
    const [linhaDoNome] = quebrarEmLinhas(
      nome,
      (t) => fonte.widthOfTextAtSize(t, 6.8),
      larg,
      1
    );
    page.drawText(linhaDoNome, { x, y, size: 6.8, font: fonte, color: SUAVE });
    y -= 11;

    const raio = 3.4;
    const cor = corDaLoja(swatch(card.color), rgb(0.79, 0.75, 0.69));
    page.drawCircle({
      x: x + raio,
      y: y + 3,
      size: raio,
      color: cor,
      borderColor: LINHA,
      borderWidth: 0.4,
    });
    const [linhaDaCor] = quebrarEmLinhas(
      card.color,
      (t) => negrito.widthOfTextAtSize(t, 9.5),
      larg - raio * 2 - 5,
      1
    );
    page.drawText(linhaDaCor, {
      x: x + raio * 2 + 5,
      y,
      size: 9.5,
      font: negrito,
      color: TINTA,
    });
    y -= 13;
  }

  // PREÇO — o da vitrine desta loja (RN-018/RN-041), com a unidade dela
  // (RN-068). Preço cheio riscado quando um desconto de campanha está valendo
  let px = x;
  const cheio = card.product.originalRetailPrice;
  if (cheio && cheio > card.product.precoCatalogo) {
    const t = brl(cheio);
    const w = fonte.widthOfTextAtSize(t, 7.5);
    page.drawText(t, { x: px, y: y + 1, size: 7.5, font: fonte, color: SUAVE });
    page.drawRectangle({ x: px, y: y + 3.6, width: w, height: 0.5, color: SUAVE });
    px += w + 5;
  }
  const preco = brl(card.product.precoCatalogo);
  page.drawText(preco, { x: px, y, size: 11, font: negrito, color: primaria });
  /*
   * O respiro antes de "/ peça" é um AFASTAMENTO, nunca um espaço no texto:
   * o `paginaSegura` apara as pontas de tudo que é escrito (ele existe para
   * limpar emoji, RN-038) e comia o espaço — saía "R$ 44,90/ peça" colado,
   * visto na página renderizada.
   */
  page.drawText(`/ ${card.product.unidade.singular}`, {
    x: px + negrito.widthOfTextAtSize(preco, 11) + 4,
    y: y + 0.5,
    size: 7.5,
    font: fonte,
    color: SUAVE,
  });
  y -= 11;

  /*
   * TAMANHOS E MÍNIMO NA MESMA LINHA.
   *
   * Os tamanhos são o que o PDF ganha e o site não tem no card: lá a cliente
   * TOCA no card para abrir a grade, no papel não há toque — sem eles ela
   * pergunta "tem no M?" peça por peça. O mínimo vem junto porque numa linha
   * própria o bloco de texto passava da altura reservada e a última fileira
   * encostava no rodapé (visto na página renderizada).
   */
  if (esgotado) {
    page.drawText("Indisponível — consulte reposição", {
      x,
      y,
      size: 7,
      font: negrito,
      color: rgb(0.7, 0.22, 0.22),
    });
    return;
  }
  const tamanhos = textoDosTamanhos(card.sizes);
  const minimo = card.product.minQuantity;
  const direita = minimo > 1 ? `mín. ${contar(minimo, card.product.unidade)}` : "";
  if (direita) {
    const w = fonte.widthOfTextAtSize(textoPdf(direita), 7);
    page.drawText(direita, { x: x + larg - w, y, size: 7, font: fonte, color: SUAVE });
    // os tamanhos param antes do mínimo: sobrepor os dois seria ilegível
    if (tamanhos) {
      const [linha] = quebrarEmLinhas(
        tamanhos,
        (t) => fonte.widthOfTextAtSize(t, 7.5),
        larg - w - 8,
        1
      );
      page.drawText(linha, { x, y, size: 7.5, font: fonte, color: SUAVE });
    }
  } else if (tamanhos) {
    const [linha] = quebrarEmLinhas(tamanhos, (t) => fonte.widthOfTextAtSize(t, 7.5), larg, 1);
    page.drawText(linha, { x, y, size: 7.5, font: fonte, color: SUAVE });
  }
}

/** A página final, quando o acervo não coube inteiro. */
function paginaDoCorte(page: PDFPage, cortadas: number, serif: PDFFont, fonte: PDFFont) {
  page.drawRectangle({ x: 0, y: 0, width: A4_LARGURA, height: A4_ALTURA, color: CREME });
  const titulo = "Tem mais no catálogo";
  page.drawText(titulo, {
    x: (A4_LARGURA - serif.widthOfTextAtSize(titulo, 22)) / 2,
    y: A4_ALTURA / 2 + 20,
    size: 22,
    font: serif,
    color: TINTA,
  });
  const texto = `Outras ${cortadas} ${cortadas === 1 ? "opção não coube" : "opções não couberam"} neste arquivo.`;
  page.drawText(texto, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(textoPdf(texto), 11)) / 2,
    y: A4_ALTURA / 2 - 8,
    size: 11,
    font: fonte,
    color: SUAVE,
  });
  const caminho = "Peça à loja o catálogo da categoria que você procura.";
  page.drawText(caminho, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(textoPdf(caminho), 11)) / 2,
    y: A4_ALTURA / 2 - 26,
    size: 11,
    font: fonte,
    color: SUAVE,
  });
}

/**
 * `catalogo-toque-leve-2026-10-23.pdf` — só letra, número e hífen.
 *
 * Mora aqui, e não na rota: um arquivo de rota do Next só exporta os
 * handlers e a configuração dele (o build recusa qualquer outra exportação).
 */
export function nomeDoArquivo(slug: string, geradoEm: Date): string {
  const limpo = slug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `catalogo-${limpo || "loja"}-${diaSP(geradoEm)}.pdf`;
}

/* ── utilidades ─────────────────────────────────────────────────────────── */

/** o tamanho de letra que faz o texto caber na largura (nunca abaixo de 60%) */
function escalaQueCabe(texto: string, font: PDFFont, ideal: number, largura: number): number {
  const t = textoPdf(texto);
  if (!t) return ideal;
  const w = font.widthOfTextAtSize(t, ideal);
  if (w <= largura) return ideal;
  return Math.max(ideal * 0.6, (ideal * largura) / w);
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/*
 * A DATA DA CAPA é a de SÃO PAULO, a mesma régua do resto da casa
 * (`diaSP`, RN-030). Pelo relógio do servidor, o catálogo gerado às 22h de
 * uma terça sairia com a data de quarta — e é essa data que decide até
 * quando a cliente confia no preço.
 */
function mesPorExtenso(d: Date): string {
  const [ano, mes] = diaSP(d).split("-");
  return `${MESES[Number(mes) - 1]} ${ano}`;
}

function diaMesAno(d: Date): string {
  const [ano, mes, dia] = diaSP(d).split("-");
  return `${dia}/${mes}/${ano}`;
}
