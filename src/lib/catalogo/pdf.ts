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
import { temaDoCatalogo } from "@/lib/catalogo/tema";
import {
  A4_ALTURA,
  A4_LARGURA,
  LAYOUT,
  alturaDaFoto,
  alturaDoCard,
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
  /** as TRÊS cores do catálogo da loja (hex) — as mesmas do site */
  primary: string;
  secondary: string;
  bg: string;
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

/* ── as cores: as MESMAS da tela ─────────────────────────────────────────── */

const BRANCO = rgb(1, 1, 1);

/** hex → cor do pdf-lib; hex torto não derruba o arquivo */
function corDaLoja(hex: string | null | undefined, reserva: RGB): RGB {
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex.trim())) return reserva;
  const [r, g, b] = hexToRgb(hex.trim());
  return rgb(r / 255, g / 255, b / 255);
}

/**
 * A paleta da página, derivada das três cores da loja pela MESMA conta da
 * vitrine (`temaDoCatalogo`) — o PDF é o print do catálogo, então a cor dele
 * é a cor dela.
 */
type Paleta = ReturnType<typeof paletaDoPdf>;
function paletaDoPdf(cores: { primary: string; secondary: string; bg: string }) {
  const t = temaDoCatalogo(cores);
  const c = (hex: string, reserva: RGB) => corDaLoja(hex, reserva);
  return {
    primary: c(t.primary, rgb(0.584, 0.267, 0.098)),
    bg: c(t.bg, rgb(0.984, 0.969, 0.949)),
    ink: c(t.ink, rgb(0.102, 0.082, 0.137)),
    line: c(t.line, rgb(0.88, 0.85, 0.81)),
    soft: c(t.soft, rgb(0.93, 0.915, 0.895)),
    muted: c(t.muted, rgb(0.52, 0.47, 0.43)),
  };
}

/** preto ou branco por cima de uma cor — a régua de legibilidade do app */
function tintaSobre(c: RGB): RGB {
  const lum = 0.299 * c.red + 0.587 * c.green + 0.114 * c.blue;
  return lum > 0.6 ? rgb(0.102, 0.082, 0.137) : BRANCO;
}

/**
 * Retângulo de cantos arredondados — os cards da tela têm raio, e sem ele o
 * papel vira uma planilha. O pdf-lib não tem borda arredondada, então o card
 * é um caminho SVG.
 */
function caminhoArredondado(w: number, h: number, r: number): string {
  const raio = Math.min(r, w / 2, h / 2);
  return [
    `M ${raio} 0`,
    `H ${w - raio}`,
    `A ${raio} ${raio} 0 0 1 ${w} ${raio}`,
    `V ${h - raio}`,
    `A ${raio} ${raio} 0 0 1 ${w - raio} ${h}`,
    `H ${raio}`,
    `A ${raio} ${raio} 0 0 1 0 ${h - raio}`,
    `V ${raio}`,
    `A ${raio} ${raio} 0 0 1 ${raio} 0`,
    "Z",
  ].join(" ");
}

/**
 * A pontinha entre o canto quadrado e o arco. É ela que é repintada com o
 * fundo da página por cima da foto, para o card com foto também ter o topo
 * arredondado (o pdf-lib não recorta imagem).
 */
function caminhoDoCanto(r: number, direito = false): string {
  return direito
    ? [`M ${r} 0`, `V ${r}`, `A ${r} ${r} 0 0 0 0 0`, "Z"].join(" ")
    : [`M 0 0`, `V ${r}`, `A ${r} ${r} 0 0 1 ${r} 0`, "Z"].join(" ");
}

/** só os cantos de cima arredondados: a área da foto, que encosta no texto */
function caminhoTopoArredondado(w: number, h: number, r: number): string {
  const raio = Math.min(r, w / 2, h);
  return [
    `M 0 ${h}`,
    `V ${raio}`,
    `A ${raio} ${raio} 0 0 1 ${raio} 0`,
    `H ${w - raio}`,
    `A ${raio} ${raio} 0 0 1 ${w} ${raio}`,
    `V ${h}`,
    "Z",
  ].join(" ");
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
  const fotos = await lerFotosParaPdf([...idPorCard.values()], restante, LAYOUT.fotoProporcao);

  const pdf = await PDFDocument.create();
  pdf.setTitle(textoPdf(`Catálogo ${identidade.nome}`));
  pdf.setProducer("AtacadoPro");
  pdf.setCreationDate(geradoEm);

  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifIt = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  // a paleta é a DA LOJA, derivada como na tela (o PDF é o print dela)
  const P = paletaDoPdf(identidade);
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

  /*
   * A LOGO entra no documento UMA vez e é desenhada na barra de TODAS as
   * páginas (é a topbar do site). Embutir por página multiplicaria o peso
   * dela por 30.
   */
  let logoDaBarra: PDFImage | null = null;
  if (identidade.logo) {
    try {
      logoDaBarra = identidade.logo.png
        ? await pdf.embedPng(identidade.logo.bytes)
        : await pdf.embedJpg(identidade.logo.bytes);
    } catch {
      // logo ilegível: a barra mostra o NOME da loja, nunca um buraco
    }
  }

  await desenharCapa(pdf, {
    logoDaBarra,
    identidade,
    geradoEm,
    pecas: total,
    vitrine: [...new Set(escolhidas)],
    P,
    serif,
    serifIt,
    fonte,
    negrito,
  });

  let semFoto = 0;
  for (const [i, pag] of paginas.entries()) {
    const page = paginaSegura(pdf.addPage([A4_LARGURA, A4_ALTURA]));
    // o FUNDO da loja, como na tela
    page.drawRectangle({ x: 0, y: 0, width: A4_LARGURA, height: A4_ALTURA, color: P.bg });
    barraDaLoja(page, identidade, logoDaBarra, pag.categoria, P, serif, fonte);
    rodape(page, i + 2, identidade.whatsapp, fonte, P);

    for (const linha of pag.linhas) {
      if (linha.titulo) tituloDaCategoria(page, linha.titulo, linha.topoY, negrito, fonte, P);
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
          P,
          swatch,
          semCores,
        });
      }
    }
  }

  if (cortadas > 0) {
    paginaDoCorte(paginaSegura(pdf.addPage([A4_LARGURA, A4_ALTURA])), cortadas, serif, fonte, P);
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
    /** a logo já embutida (a mesma da barra de todas as páginas) */
    logoDaBarra: PDFImage | null;
    P: Paleta;
    serif: PDFFont;
    serifIt: PDFFont;
    fonte: PDFFont;
    negrito: PDFFont;
  }
) {
  const { identidade, geradoEm, pecas, vitrine, logoDaBarra, P, serif, serifIt, fonte, negrito } = o;
  const page = paginaSegura(pdf.addPage([A4_LARGURA, A4_ALTURA]));
  const tinta = tintaSobre(P.primary);
  page.drawRectangle({ x: 0, y: 0, width: A4_LARGURA, height: A4_ALTURA, color: P.primary });

  /*
   * O BLOCO DA CAPA É MEDIDO ANTES DE SER DESENHADO.
   *
   * Ele muda de altura conforme a loja: com logo ou sem, com frase ou sem,
   * com fotos ou sem. Desenhar a partir de um ponto fixo deixava a capa da
   * loja COM logo empurrada para baixo, colando o "N opções" no aviso da
   * data (visto na capa renderizada). Medindo primeiro, o bloco fica
   * centrado em qualquer combinação.
   */
  const tamanhoDoNome = escalaQueCabe(
    textoPdf(identidade.nome),
    serif,
    44,
    A4_LARGURA - 120
  );
  const tamanhoDaFrase = identidade.tagline
    ? escalaQueCabe(textoPdf(identidade.tagline), serifIt, 14, A4_LARGURA - 140)
    : 0;
  const largDaFoto = 148;
  const altDaFoto = Math.round(largDaFoto * LAYOUT.fotoProporcao);

  // a LOGO já é o nome da loja desenhado: escrever o nome embaixo dela fazia
  // "Toque Leve" aparecer DUAS vezes na capa (visto na capa renderizada)
  const cabeDaLogo = logoDaBarra ? logoDaBarra.scaleToFit(300, 110) : null;
  // só serve para dar um respiro a mais na capa enxuta (sem foto nenhuma)
  const alturaDoBloco =
    (cabeDaLogo ? cabeDaLogo.height : tamanhoDoNome) +
    (identidade.tagline ? tamanhoDaFrase + 14 : 0) +
    22 + // a réguazinha
    (vitrine.length ? altDaFoto + 34 : 0);

  /*
   * O bloco desce de um ponto fixo. Dá certo porque a logo SUBSTITUI o nome
   * (não empilha com ele): a altura muda pouco entre uma loja e outra.
   * Centrar o bloco na folha foi tentado e saiu pior — com as fotos ele
   * descia até o pé e vazava (visto na capa renderizada).
   */
  let y = A4_ALTURA - 190 + (alturaDoBloco < 300 ? 40 : 0);

  if (cabeDaLogo && logoDaBarra) {
    y -= cabeDaLogo.height;
    page.drawImage(logoDaBarra, {
      x: (A4_LARGURA - cabeDaLogo.width) / 2,
      y,
      width: cabeDaLogo.width,
      height: cabeDaLogo.height,
    });
  } else {
    const nome = textoPdf(identidade.nome);
    y -= tamanhoDoNome;
    page.drawText(nome, {
      x: (A4_LARGURA - serif.widthOfTextAtSize(nome, tamanhoDoNome)) / 2,
      y,
      size: tamanhoDoNome,
      font: serif,
      color: tinta,
    });
  }

  if (identidade.tagline) {
    const t = textoPdf(identidade.tagline);
    y -= tamanhoDaFrase + 14;
    page.drawText(t, {
      x: (A4_LARGURA - serifIt.widthOfTextAtSize(t, tamanhoDaFrase)) / 2,
      y,
      size: tamanhoDaFrase,
      font: serifIt,
      color: tinta,
      opacity: 0.85,
    });
  }

  y -= 22;
  page.drawRectangle({
    x: A4_LARGURA / 2 - 36,
    y,
    width: 72,
    height: 1.6,
    color: tinta,
    opacity: 0.5,
  });

  // AS PEÇAS: lado a lado, no mesmo recorte do card (já vêm cortadas)
  if (vitrine.length) {
    const calha = 14;
    const total = vitrine.length * largDaFoto + (vitrine.length - 1) * calha;
    let x = (A4_LARGURA - total) / 2;
    y -= altDaFoto + 34;
    for (const img of vitrine) {
      page.drawImage(img, { x, y, width: largDaFoto, height: altDaFoto });
      x += largDaFoto + calha;
    }
  }

  // o miolo: o que o catálogo tem
  const linhaDoMeio = `CATÁLOGO · ${mesPorExtenso(geradoEm).toUpperCase()}`;
  page.drawText(linhaDoMeio, {
    x: (A4_LARGURA - negrito.widthOfTextAtSize(linhaDoMeio, 12)) / 2,
    y: y - 40,
    size: 12,
    font: negrito,
    color: tinta,
    opacity: 0.9,
  });
  const quantas = `${pecas} ${pecas === 1 ? "opção" : "opções"}`;
  page.drawText(quantas, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(quantas, 11)) / 2,
    y: y - 58,
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
    y: 132,
    size: 10,
    font: fonte,
    color: tinta,
    opacity: 0.8,
  });
  const confirme = "Confirme com a loja antes de fechar o pedido.";
  page.drawText(confirme, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(confirme, 10)) / 2,
    y: 118,
    size: 10,
    font: fonte,
    color: tinta,
    opacity: 0.8,
  });

  if (identidade.whatsapp) {
    const zap = `Pedidos pelo WhatsApp ${identidade.whatsapp}`;
    page.drawText(zap, {
      x: (A4_LARGURA - negrito.widthOfTextAtSize(zap, 11)) / 2,
      y: 82,
      size: 11,
      font: negrito,
      color: tinta,
    });
  }
}

/* ── páginas de peças ───────────────────────────────────────────────────── */

/**
 * A BARRA DA LOJA — a topbar do site, em toda página.
 *
 * No catálogo web ela fica grudada no alto, na cor da marca, com a logo à
 * esquerda. É o primeiro sinal de "isto é da loja X", e sem ela o papel
 * virava um relatório qualquer (pedido do dono: o PDF tem que parecer um
 * print do catálogo).
 */
function barraDaLoja(
  page: PDFPage,
  identidade: IdentidadeDaLoja,
  logo: PDFImage | null,
  /**
   * A categoria desta página. Vai na barra porque a seção só escreve o nome
   * dela na PRIMEIRA fileira: uma categoria de 40 peças ocupa quatro folhas,
   * e sem isto as três seguintes não diziam de que categoria eram (achado da
   * revisão). Na tela quem faz esse papel são os chips fixos no alto.
   */
  categoria: string,
  P: Paleta,
  serif: PDFFont,
  fonte: PDFFont
) {
  const alt = LAYOUT.barraAltura;
  page.drawRectangle({
    x: 0,
    y: A4_ALTURA - alt,
    width: A4_LARGURA,
    height: alt,
    color: P.primary,
  });
  const tinta = tintaSobre(P.primary);
  const meio = A4_ALTURA - alt / 2;

  // a categoria à direita, como o chip aceso da barra do site
  const cat = textoPdf(categoria.toUpperCase());
  const largCat = fonte.widthOfTextAtSize(cat, 7.5);
  page.drawText(cat, {
    x: A4_LARGURA - LAYOUT.margem - largCat,
    y: meio - 2.6,
    size: 7.5,
    font: fonte,
    color: tinta,
    opacity: 0.82,
  });

  const espacoDaEsquerda = A4_LARGURA - LAYOUT.margem * 2 - largCat - 20;
  if (logo) {
    // a logo ocupa a barra como na tela, sem encostar nas bordas
    const cabe = logo.scaleToFit(Math.min(190, espacoDaEsquerda), alt - 16);
    page.drawImage(logo, {
      x: LAYOUT.margem,
      y: A4_ALTURA - alt + (alt - cabe.height) / 2,
      width: cabe.width,
      height: cabe.height,
    });
    return;
  }
  const nome = textoPdf(identidade.nome);
  const tam = escalaQueCabe(nome, serif, 17, espacoDaEsquerda);
  page.drawText(nome, {
    x: LAYOUT.margem,
    y: meio - tam * 0.34,
    size: tam,
    font: serif,
    color: tinta,
  });
}

function rodape(
  page: PDFPage,
  numero: number,
  whatsapp: string | null,
  fonte: PDFFont,
  P: Paleta
) {
  if (whatsapp) {
    page.drawText(`pedidos pelo WhatsApp ${whatsapp}`, {
      x: LAYOUT.margem,
      y: 24,
      size: 7.5,
      font: fonte,
      color: P.muted,
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
    y: 24,
    size: 8,
    font: fonte,
    color: P.muted,
  });
}

/**
 * O TÍTULO DA SEÇÃO, como no site: o nome da categoria em CAIXA ALTA e
 * negrito, "18 opções" na cor da marca à direita, e a linha PONTILHADA
 * embaixo — os três detalhes que fazem a página ser reconhecida como a
 * mesma do catálogo.
 */
function tituloDaCategoria(
  page: PDFPage,
  titulo: { categoria: string; totalDeCards: number },
  topoY: number,
  negrito: PDFFont,
  fonte: PDFFont,
  P: Paleta
) {
  // o título fica ACIMA da linha de cards: `topoY` já desceu a altura dele
  const y = topoY + LAYOUT.tituloAltura - 22;
  const n = titulo.totalDeCards;
  const contagem = `${n} ${n === 1 ? "opção" : "opções"}`;
  const largContagem = negrito.widthOfTextAtSize(textoPdf(contagem), 8);

  const nome = titulo.categoria.toUpperCase();
  const tam = escalaQueCabe(
    nome,
    negrito,
    15,
    A4_LARGURA - LAYOUT.margem * 2 - largContagem - 16
  );
  page.drawText(nome, { x: LAYOUT.margem, y, size: tam, font: negrito, color: P.ink });
  page.drawText(contagem, {
    x: A4_LARGURA - LAYOUT.margem - largContagem,
    y: y + 2,
    size: 8,
    font: negrito,
    color: P.primary,
  });
  page.drawLine({
    start: { x: LAYOUT.margem, y: y - 10 },
    end: { x: A4_LARGURA - LAYOUT.margem, y: y - 10 },
    thickness: 0.8,
    color: P.line,
    dashArray: [1.6, 2.4],
  });
}

/**
 * O CARD DA PEÇA — o do site, levado para a folha.
 *
 * Na tela ele é um retângulo do FUNDO DA LOJA com cantos arredondados e uma
 * borda fina: em cima a foto num fundo suave, embaixo o nome em maiúsculas
 * miúdas, a cor com a bolinha e o preço na cor da marca com "/ peça" ao
 * lado. Aqui é a mesma coisa, nas mesmas cores.
 */
function desenharCard(
  page: PDFPage,
  o: {
    card: CardDaVitrine<PecaDoAcervo>;
    x: number;
    topoY: number;
    imagem: PDFImage | null;
    fonte: PDFFont;
    negrito: PDFFont;
    P: Paleta;
    swatch: (cor: string) => string;
    semCores: boolean;
  }
) {
  const { card, x, topoY, imagem, fonte, negrito, P, swatch, semCores } = o;
  const larg = larguraDoCard();
  const fotoAlt = alturaDaFoto();
  const altura = alturaDoCard();

  /*
   * O CARD É DO FUNDO DA LOJA, não branco — é o que a tela faz
   * (`background: T.bg`). Branco fixo quebrava a loja de fundo ESCURO: a
   * tinta do texto é `readableOn(bg)`, ou seja branca, e dava branco sobre
   * branco (achado da revisão, reproduzido gerando o PDF com bg #101010).
   */
  page.drawSvgPath(caminhoArredondado(larg, altura, LAYOUT.raio), {
    x,
    y: topoY,
    color: P.bg,
  });
  // a área da foto, no fundo suave (cantos de cima arredondados, como lá)
  page.drawSvgPath(caminhoTopoArredondado(larg, fotoAlt, LAYOUT.raio), {
    x,
    y: topoY,
    color: P.soft,
  });

  const fotoBase = topoY - fotoAlt;
  if (imagem) {
    // a foto já chega recortada na proporção da moldura (`lerFotosParaPdf`):
    // o `object-cover object-top` da tela, feito pelo sharp — o pdf-lib não
    // recorta, e desenhar maior invadiria o card vizinho
    page.drawImage(imagem, { x, y: fotoBase, width: larg, height: fotoAlt });
    /*
     * A foto é um RETÂNGULO e cobria os cantos arredondados de cima: todo
     * card com foto saía com o topo quadrado e o pé redondo (achado da
     * revisão). O pdf-lib não recorta, então as duas pontinhas voltam a ser
     * pintadas com o fundo da PÁGINA, e a borda é redesenhada por cima.
     */
    page.drawSvgPath(caminhoDoCanto(LAYOUT.raio), { x, y: topoY, color: P.bg });
    page.drawSvgPath(caminhoDoCanto(LAYOUT.raio, true), {
      x: x + larg - LAYOUT.raio,
      y: topoY,
      color: P.bg,
    });
  }

  // a borda fina da tela, desenhada POR CIMA de tudo para fechar o contorno
  page.drawSvgPath(caminhoArredondado(larg, altura, LAYOUT.raio), {
    x,
    y: topoY,
    borderColor: P.line,
    borderWidth: 0.7,
  });

  const esgotado = card.sizes.every((s) => !s.available);
  if (esgotado) {
    // a tarja "Indisponível" do site, por cima da foto
    const texto = "INDISPONÍVEL";
    const w = negrito.widthOfTextAtSize(texto, 7);
    const alturaTarja = 15;
    page.drawRectangle({
      x,
      y: fotoBase + fotoAlt / 2 - alturaTarja / 2,
      width: larg,
      height: alturaTarja,
      color: rgb(0.17, 0.16, 0.15),
      opacity: 0.74,
    });
    page.drawText(texto, {
      x: x + (larg - w) / 2,
      y: fotoBase + fotoAlt / 2 - 2.4,
      size: 7,
      font: negrito,
      color: BRANCO,
    });
  }

  const pad = 7;
  const util = larg - pad * 2;
  let y = fotoBase - 12;

  /*
   * NOME E COR, com o MESMO destaque do site: o nome é a linha miúda em
   * maiúsculas e a COR é o negrito com a bolinha. A loja que escondeu as
   * cores (semijoias, `catalogHideColors`) inverte — lá o NOME assume o
   * negrito e a cor não aparece.
   */
  if (semCores) {
    const [linha] = quebrarEmLinhas(
      card.product.name,
      (t) => negrito.widthOfTextAtSize(t, 8.5),
      util,
      1
    );
    page.drawText(linha, { x: x + pad, y: y - 3, size: 8.5, font: negrito, color: P.ink });
    y -= 21;
  } else {
    const [linhaDoNome] = quebrarEmLinhas(
      card.product.name.toUpperCase(),
      (t) => fonte.widthOfTextAtSize(t, 6.2),
      util,
      1
    );
    page.drawText(linhaDoNome, { x: x + pad, y, size: 6.2, font: fonte, color: P.muted });
    y -= 11;

    const raio = 3.1;
    page.drawCircle({
      x: x + pad + raio,
      y: y + 2.8,
      size: raio,
      color: corDaLoja(swatch(card.color), P.soft),
      borderColor: P.line,
      borderWidth: 0.4,
    });
    const [linhaDaCor] = quebrarEmLinhas(
      card.color,
      (t) => negrito.widthOfTextAtSize(t, 8.5),
      util - raio * 2 - 4,
      1
    );
    page.drawText(linhaDaCor, {
      x: x + pad + raio * 2 + 4,
      y,
      size: 8.5,
      font: negrito,
      color: P.ink,
    });
    y -= 13;
  }

  /*
   * PREÇO — o da vitrine desta loja (RN-018/RN-041), com a unidade dela
   * (RN-068); preço cheio riscado quando um desconto de campanha está
   * valendo.
   *
   * A linha é MEDIDA INTEIRA antes de ser escrita, e encolhe até caber no
   * card. Era o único texto do card sem corte por largura, e com a coluna
   * mais estreita (quatro por folha) um preço riscado mais uma unidade
   * comprida — a RN-068 aceita 20 letras — passava da borda e escrevia por
   * cima do card vizinho (achado da revisão).
   */
  const cheio = card.product.originalRetailPrice;
  const riscado = cheio && cheio > card.product.precoCatalogo ? brl(cheio) : "";
  const preco = brl(card.product.precoCatalogo);
  const unidade = `/ ${card.product.unidade.singular}`;
  const medir = (e: number) =>
    (riscado ? fonte.widthOfTextAtSize(textoPdf(riscado), 6.5 * e) + 4 : 0) +
    negrito.widthOfTextAtSize(textoPdf(preco), 9.5 * e) +
    3 +
    fonte.widthOfTextAtSize(textoPdf(unidade), 6.2 * e);
  // nunca abaixo de 70%: menor que isso o preço deixa de ser legível, e aí
  // é melhor a unidade sair cortada pelo `quebrarEmLinhas` do que o número
  let escala = 1;
  if (medir(1) > util) escala = Math.max(0.7, util / medir(1));

  let px = x + pad;
  if (riscado) {
    const w = fonte.widthOfTextAtSize(textoPdf(riscado), 6.5 * escala);
    page.drawText(riscado, { x: px, y: y + 0.8, size: 6.5 * escala, font: fonte, color: P.muted });
    page.drawRectangle({ x: px, y: y + 3, width: w, height: 0.45, color: P.muted });
    px += w + 4;
  }
  page.drawText(preco, { x: px, y, size: 9.5 * escala, font: negrito, color: P.primary });
  px += negrito.widthOfTextAtSize(textoPdf(preco), 9.5 * escala) + 3;
  /*
   * O respiro antes de "/ peça" é um AFASTAMENTO, nunca um espaço no texto:
   * o `paginaSegura` apara as pontas de tudo que é escrito (ele existe para
   * limpar emoji, RN-038) e comia o espaço — saía "R$ 44,90/ peça" colado.
   */
  const [linhaDaUnidade] = quebrarEmLinhas(
    unidade,
    (t) => fonte.widthOfTextAtSize(t, 6.2 * escala),
    Math.max(0, x + larg - pad - px),
    1
  );
  page.drawText(linhaDaUnidade, {
    x: px,
    y: y + 0.4,
    size: 6.2 * escala,
    font: fonte,
    color: P.muted,
  });
  y -= 10;

  /*
   * TAMANHOS E MÍNIMO — a ÚNICA coisa que o papel tem e o card da tela não.
   * Lá a cliente TOCA no card para abrir a grade; no papel não há toque, e
   * sem esta linha ela teria que perguntar "tem no M?" peça por peça. O
   * esgotado não entra: listá-lo faria ela pedir o que não existe (RN-067).
   */
  if (esgotado) return;
  const tamanhos = textoDosTamanhos(card.sizes);
  const minimo = card.product.minQuantity;
  const direita = minimo > 1 ? `mín. ${contar(minimo, card.product.unidade)}` : "";
  let espacoDosTamanhos = util;
  if (direita) {
    const w = fonte.widthOfTextAtSize(textoPdf(direita), 6);
    page.drawText(direita, { x: x + larg - pad - w, y, size: 6, font: fonte, color: P.muted });
    espacoDosTamanhos = util - w - 6;
  }
  if (tamanhos) {
    const [linha] = quebrarEmLinhas(
      tamanhos,
      (t) => fonte.widthOfTextAtSize(t, 6.4),
      espacoDosTamanhos,
      1
    );
    page.drawText(linha, { x: x + pad, y, size: 6.4, font: fonte, color: P.muted });
  }
}

/** A página final, quando o acervo não coube inteiro. */
function paginaDoCorte(
  page: PDFPage,
  cortadas: number,
  serif: PDFFont,
  fonte: PDFFont,
  P: Paleta
) {
  page.drawRectangle({ x: 0, y: 0, width: A4_LARGURA, height: A4_ALTURA, color: P.bg });
  const titulo = "Tem mais no catálogo";
  page.drawText(titulo, {
    x: (A4_LARGURA - serif.widthOfTextAtSize(titulo, 22)) / 2,
    y: A4_ALTURA / 2 + 20,
    size: 22,
    font: serif,
    color: P.ink,
  });
  const texto = `Outras ${cortadas} ${cortadas === 1 ? "opção não coube" : "opções não couberam"} neste arquivo.`;
  page.drawText(texto, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(textoPdf(texto), 11)) / 2,
    y: A4_ALTURA / 2 - 8,
    size: 11,
    font: fonte,
    color: P.muted,
  });
  const caminho = "Peça à loja o catálogo da categoria que você procura.";
  page.drawText(caminho, {
    x: (A4_LARGURA - fonte.widthOfTextAtSize(textoPdf(caminho), 11)) / 2,
    y: A4_ALTURA / 2 - 26,
    size: 11,
    font: fonte,
    color: P.muted,
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
