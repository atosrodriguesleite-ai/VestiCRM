/**
 * DANFE SIMPLIFICADO – ETIQUETA, desenhado aqui (RN-111).
 *
 * Pedido do dono (16/11/2026): a etiqueta do Melhor Envio comprada com a
 * chave da nota sai com "NF: 91", mas a página de impressão de lá NÃO oferece
 * o DANFE simplificado (ele só aparece quando a nota inteira é entregue ao
 * Melhor Envio, o que a compra pela API não faz). A loja ficava com a
 * etiqueta numa mão e o DANFE completo, em A4, na outra.
 *
 * O desenho segue a Nota Técnica 2020.004 (v1.10, lida no portal da NF-e):
 *  • largura mínima do papel 55 mm — aqui o bloco tem 100 mm;
 *  • chave de acesso e código de barras no alto do papel;
 *  • todo texto com 6 pontos ou mais; títulos em NEGRITO e CAIXA ALTA;
 *  • campos obrigatórios: a descrição "DANFE Simplificado – Etiqueta", a
 *    chave, o código de barras, o Protocolo de Autorização de Uso, emitente
 *    (nome, UF, CNPJ, IE), dados da nota (tipo de operação, série, número,
 *    data de emissão) e destinatário (nome, UF, CNPJ/CPF e IE quando existir);
 *  • o valor total PODE ser suprimido (§ 15-A do Ajuste SINIEF 07/05) — e é:
 *    valor escrito do lado de fora da caixa é convite para extravio.
 *
 * O CONTEÚDO é uma função pura (`camposDoDanfe`), testada sem abrir PDF; o
 * desenho é o pdf-lib da casa (extrato de comissão, etiquetas, catálogo).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { paginaSegura, quebrarEmLinhas, textoPdf } from "@/lib/pdf-texto";
import { barrasCode128C } from "./code128";
import {
  chaveEmBlocos,
  documentoComMascara,
  numeroDaNota,
  serieDaNota,
  type NotaParaDanfe,
} from "./xml-da-nota";

export const FORMATOS_DO_DANFE = ["a4", "etiqueta"] as const;
export type FormatoDoDanfe = (typeof FORMATOS_DO_DANFE)[number];

export function lerFormatoDoDanfe(valor: string | null | undefined): FormatoDoDanfe {
  return valor === "etiqueta" ? "etiqueta" : "a4";
}

/** o título que a norma manda imprimir */
export const TITULO_DO_DANFE = "DANFE SIMPLIFICADO - ETIQUETA";
/** menor letra permitida pela norma (NT 2020.004, 02.3) */
export const MENOR_LETRA_PT = 6;

const PT_POR_MM = 72 / 25.4;
const mm = (v: number) => v * PT_POR_MM;

/** medidas do bloco, em milímetros */
const LARGURA_MM = 100;
const MARGEM_MM = 4;
const ALTURA_DAS_BARRAS_MM = 13;
/**
 * Largura de UM módulo do código de barras: 0,25 mm. É exatamente 2 pontos
 * numa impressora térmica de 203 dpi (8 pontos por mm) e ~3 numa de 300 dpi —
 * módulo que não fecha em pontos inteiros sai com barras de larguras
 * desiguais, e é aí que o leitor da transportadora falha. A chave ocupa
 * 277 módulos = 69 mm; o resto da largura vira margem clara (o padrão pede
 * 10 módulos de cada lado, aqui sobram mais de 40).
 */
export const MODULO_MM = 0.25;

export type CampoDoDanfe = { titulo: string; valor: string };

/**
 * O que o papel diz, em ordem — títulos em caixa alta, valores prontos.
 * É o que o teste lê: cada campo obrigatório da norma tem que estar aqui.
 */
export function camposDoDanfe(nota: NotaParaDanfe): {
  chave: CampoDoDanfe;
  protocolo: CampoDoDanfe;
  emitente: CampoDoDanfe[];
  nota: CampoDoDanfe[];
  destinatario: CampoDoDanfe[];
} {
  const d = nota.destinatario;
  return {
    chave: { titulo: "CHAVE DE ACESSO", valor: chaveEmBlocos(nota.chave) },
    protocolo: {
      titulo: "PROTOCOLO DE AUTORIZAÇÃO DE USO",
      valor: nota.autorizadaEm ? `${nota.protocolo} - ${nota.autorizadaEm}` : nota.protocolo,
    },
    emitente: [
      { titulo: "NOME/RAZÃO SOCIAL", valor: nota.emitente.nome },
      {
        titulo: nota.emitente.documento.length === 11 ? "CPF" : "CNPJ",
        valor: documentoComMascara(nota.emitente.documento),
      },
      { titulo: "INSCRIÇÃO ESTADUAL", valor: nota.emitente.ie },
      { titulo: "UF", valor: nota.emitente.uf },
    ],
    nota: [
      {
        titulo: "TIPO DE OPERAÇÃO",
        valor: nota.tipoOperacao === "ENTRADA" ? "0 - ENTRADA" : "1 - SAÍDA",
      },
      { titulo: "SÉRIE", valor: serieDaNota(nota.serie) },
      { titulo: "NÚMERO", valor: numeroDaNota(nota.numero) },
      { titulo: "DATA DE EMISSÃO", valor: nota.emitidaEm },
    ],
    destinatario: [
      { titulo: "NOME/RAZÃO SOCIAL", valor: d.nome },
      {
        titulo:
          d.tipoDocumento === "CNPJ" ? "CNPJ" : d.tipoDocumento === "CPF" ? "CPF" : "ID. ESTRANGEIRO",
        valor: documentoComMascara(d.documento) || "-",
      },
      // "quando existir": sem IE o campo não aparece
      ...(d.ie ? [{ titulo: "INSCRIÇÃO ESTADUAL", valor: d.ie }] : []),
      { titulo: "UF", valor: d.uf },
    ],
  };
}

type Fontes = { normal: PDFFont; negrito: PDFFont };

const PRETO = rgb(0, 0, 0);

/** Escreve o texto na maior letra que cabe, nunca abaixo dos 6 pt da norma; só então corta com "…". */
function textoQueCabe(
  texto: string,
  fonte: PDFFont,
  larguraMax: number,
  ptDesejado: number
): { texto: string; pt: number } {
  let limpo = textoPdf(texto);
  let pt = ptDesejado;
  while (pt > MENOR_LETRA_PT && fonte.widthOfTextAtSize(limpo, pt) > larguraMax) pt -= 0.25;
  pt = Math.max(MENOR_LETRA_PT, pt);
  if (fonte.widthOfTextAtSize(limpo, pt) > larguraMax) {
    while (limpo.length > 1 && fonte.widthOfTextAtSize(`${limpo}…`, pt) > larguraMax)
      limpo = limpo.slice(0, -1);
    limpo = `${limpo.trimEnd()}…`;
  }
  return { texto: limpo, pt };
}

/** O aviso que o papel leva quando a nota é de teste (ambiente de homologação). */
export const AVISO_DE_HOMOLOGACAO = "SEM VALOR FISCAL - AMBIENTE DE HOMOLOGAÇÃO";

/** Desenha o bloco do DANFE com o canto superior esquerdo em (x, topo). */
function desenharBloco(
  page: PDFPage,
  fontes: Fontes,
  nota: NotaParaDanfe,
  x: number,
  topo: number,
  comMoldura: boolean
): void {
  const campos = camposDoDanfe(nota);
  const largura = mm(LARGURA_MM);
  const margem = mm(MARGEM_MM);
  const util = largura - 2 * margem;
  const esquerda = x + margem;
  let y = topo - margem;

  const linha = () => {
    page.drawLine({
      start: { x: esquerda, y },
      end: { x: esquerda + util, y },
      thickness: 0.5,
      color: PRETO,
    });
  };
  const titulo = (texto: string, xx: number, larguraMax: number) => {
    const t = textoQueCabe(texto, fontes.negrito, larguraMax, MENOR_LETRA_PT);
    page.drawText(t.texto, { x: xx, y, size: t.pt, font: fontes.negrito, color: PRETO });
  };
  const valor = (texto: string, xx: number, larguraMax: number, pt = 8) => {
    const t = textoQueCabe(texto, fontes.normal, larguraMax, pt);
    page.drawText(t.texto, { x: xx, y, size: t.pt, font: fontes.normal, color: PRETO });
  };

  // ── título do documento, centralizado
  y -= 9;
  const larguraTitulo = fontes.negrito.widthOfTextAtSize(TITULO_DO_DANFE, 10);
  page.drawText(TITULO_DO_DANFE, {
    x: esquerda + (util - larguraTitulo) / 2,
    y,
    size: 10,
    font: fontes.negrito,
    color: PRETO,
  });
  // nota de TESTE não pode passar por documento de verdade
  if (nota.homologacao) {
    y -= 10;
    const larguraAviso = fontes.negrito.widthOfTextAtSize(AVISO_DE_HOMOLOGACAO, 8);
    page.drawText(AVISO_DE_HOMOLOGACAO, {
      x: esquerda + (util - larguraAviso) / 2,
      y,
      size: 8,
      font: fontes.negrito,
      color: PRETO,
    });
  }
  y -= 6;

  // ── código de barras da chave (Code 128 C), com a margem clara dos lados
  const barras = barrasCode128C(nota.chave);
  if (barras) {
    const modulo = mm(MODULO_MM);
    const total = barras.reduce((a, b) => a + b, 0) * modulo;
    const altura = mm(ALTURA_DAS_BARRAS_MM);
    // centralizado: a sobra dos dois lados é a margem clara
    let bx = esquerda + (util - total) / 2;
    barras.forEach((w, i) => {
      // posições pares são BARRA, ímpares são espaço
      if (i % 2 === 0)
        page.drawRectangle({
          x: bx,
          y: y - altura,
          width: w * modulo,
          height: altura,
          color: PRETO,
        });
      bx += w * modulo;
    });
    y -= altura;
  }
  y -= 9;

  // ── chave em números
  titulo(campos.chave.titulo, esquerda, util);
  y -= 9;
  valor(campos.chave.valor, esquerda, util, 8.5);
  y -= 10;

  // ── protocolo
  titulo(campos.protocolo.titulo, esquerda, util);
  y -= 9;
  valor(campos.protocolo.valor, esquerda, util);
  y -= 5;
  linha();

  // um grupo: cabeçalho, o nome em até duas linhas, e os outros campos lado a lado
  const grupo = (cabecalho: string, itens: CampoDoDanfe[]) => {
    y -= 9;
    page.drawText(cabecalho, { x: esquerda, y, size: 7, font: fontes.negrito, color: PRETO });
    const [nome, ...resto] = itens;
    y -= 10;
    titulo(nome.titulo, esquerda, util);
    for (const l of quebrarEmLinhas(
      nome.valor,
      (t) => fontes.normal.widthOfTextAtSize(t, 8),
      util,
      2
    )) {
      y -= 9;
      valor(l, esquerda, util);
    }
    y -= 10;
    const coluna = util / resto.length;
    resto.forEach((c, i) => titulo(c.titulo, esquerda + i * coluna, coluna - 4));
    y -= 9;
    resto.forEach((c, i) => valor(c.valor, esquerda + i * coluna, coluna - 4));
    y -= 5;
  };

  grupo("EMITENTE", campos.emitente);
  linha();

  // ── dados gerais da nota: quatro campos lado a lado
  y -= 9;
  page.drawText("DADOS DA NF-E", { x: esquerda, y, size: 7, font: fontes.negrito, color: PRETO });
  y -= 10;
  const col = util / campos.nota.length;
  campos.nota.forEach((c, i) => titulo(c.titulo, esquerda + i * col, col - 4));
  y -= 9;
  campos.nota.forEach((c, i) => valor(c.valor, esquerda + i * col, col - 4));
  y -= 5;
  linha();

  grupo("DESTINATÁRIO", campos.destinatario);

  const altura = topo - y + margem - 5;
  // a moldura do bloco: é por onde se recorta no A4 (na etiqueta de 10 × 15 a
  // própria etiqueta é a moldura — a linha cairia na borda que a impressora corta)
  // (tracejada e cinza de propósito: é guia de tesoura, e uma linha preta
  // cheia na mesma altura das barras atrapalha leitor de código mais simples)
  if (comMoldura)
    page.drawRectangle({
      x,
      y: topo - altura,
      width: largura,
      height: altura,
      borderColor: rgb(0.65, 0.65, 0.65),
      borderWidth: 0.5,
      borderDashArray: [3, 3],
    });
}

/**
 * O PDF do DANFE simplificado.
 *  • "etiqueta": página de 100 × 150 mm (impressora térmica de etiqueta);
 *  • "a4": folha A4 com o bloco no canto superior direito, em tamanho real,
 *    para recortar e colar na caixa.
 */
export async function gerarDanfeSimplificado(
  nota: NotaParaDanfe,
  formato: FormatoDoDanfe
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DANFE Simplificado - NF-e ${numeroDaNota(nota.numero)}`);
  const fontes: Fontes = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    negrito: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  if (formato === "etiqueta") {
    const page = paginaSegura(pdf.addPage([mm(LARGURA_MM), mm(150)]));
    desenharBloco(page, fontes, nota, 0, mm(150), false);
  } else {
    const A4 = { w: 595.28, h: 841.89 };
    const page = paginaSegura(pdf.addPage([A4.w, A4.h]));
    const borda = mm(10);
    desenharBloco(page, fontes, nota, A4.w - borda - mm(LARGURA_MM), A4.h - borda, true);
  }
  return pdf.save();
}
