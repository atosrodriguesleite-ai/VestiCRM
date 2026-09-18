/**
 * ETIQUETA EM ZPL — a língua da Zebra (RN-059). Regra pura.
 *
 * A Zebra 220 (ZD220) tem 203 dpi: 8 pontos por milímetro. Tudo aqui é
 * convertido de mm para pontos. O texto sai em UTF-8 (`^CI28`) com os bytes
 * fora do ASCII escapados em hexadecimal (`^FH_`) — é o jeito que funciona em
 * qualquer firmware; mandar "ç" cru dependia da configuração da impressora.
 * O código de barras usa o `^BE` (EAN-13 nativo): recebe os 12 dígitos e a
 * própria impressora calcula o verificador; o número embaixo é desenhado
 * por nós (a linha de interpretação da impressora tem altura própria e
 * invadia o rodapé). Imagem vai como `^GF` (bitmap preto e branco que o
 * navegador rasterizou ao salvar o modelo — no servidor não há canvas).
 *
 * ROLO COM COLUNAS: uma "etiqueta" ZPL é uma LINHA do rolo (`^PW` = largura
 * de todas as colunas), e cada coluna recebe os campos deslocados. Linhas
 * iguais em sequência viram uma só com `^PQ` (cópias).
 *
 * ETIQUETA GIRADA: os campos saem com orientação R (90° horário) e o `^FO`
 * é o canto superior esquerdo da caixa já girada — é a convenção do `^FO`
 * documentada para campos rotacionados; a prévia e o PDF são exatos, e o
 * ajuste fino da Zebra se confere na impressão de teste.
 */

import {
  alturaDaLinhaMm,
  areaDeDesenho,
  estimarLarguraMm,
  expandirLote,
  larguraDaLinha,
  linhasDoElemento,
  linhasDoRolo,
  paraFisico,
  xDaColuna,
  MM_POR_PT,
  type DadosEtiqueta,
  type Modelo,
} from "./modelo";
import { MODULOS_EAN13, ean13Valido } from "./ean13";
import { TETO_ETIQUETAS_POR_PDF } from "./pdf";

export const DPI_ZEBRA_220 = 203;

const dots = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

/**
 * Escapa para `^FH_`: qualquer byte que não seja letra, número ou pontuação
 * segura vira `_XX` (UTF-8). Cobre `^`, `~`, `_` e todo acento.
 */
export function escaparZpl(texto: string): string {
  const seguro = /[A-Za-z0-9 .,:;/()#+*'"!?=%$@&\-]/;
  let saida = "";
  for (const c of texto) {
    if (seguro.test(c)) {
      saida += c;
      continue;
    }
    for (const b of new TextEncoder().encode(c)) saida += "_" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return saida;
}

/** Os campos de UMA etiqueta, deslocados para a coluna `c`. */
function camposDaEtiqueta(modelo: Modelo, dados: DadosEtiqueta, c: number, dpi: number): string[] {
  const partes: string[] = [];
  const x0 = xDaColuna(modelo, c);
  const orient = modelo.girada ? "R" : "N";
  const texto = (r: { x: number; y: number; w: number; h: number }, t: string, pt: number, alinhar: "L" | "C" | "R") => {
    const f = paraFisico(modelo, r);
    const altura = dots(pt * MM_POR_PT, dpi);
    return (
      `^FO${dots(x0 + f.x, dpi)},${dots(f.y, dpi)}` +
      `^A0${orient},${altura},${altura}` +
      `^FB${dots(r.w, dpi)},1,0,${alinhar},0` +
      `^FH_^FD${escaparZpl(t)}^FS`
    );
  };
  for (const el of modelo.elementos) {
    if (el.tipo === "texto") {
      const { linhas, pt } = linhasDoElemento(el, dados, estimarLarguraMm);
      const alinhar = el.alinhar === "centro" ? "C" : el.alinhar === "dir" ? "R" : "L";
      // A Zebra tem UMA fonte escalável embutida (^A0): não existe par
      // regular/negrito. Posição, tamanho e corte são os do PDF e da prévia.
      // Uma linha por campo: as quebras são as MESMAS do PDF e da prévia.
      linhas.forEach((t, i) =>
        partes.push(texto({ x: el.x, y: el.y + i * alturaDaLinhaMm(pt), w: el.w, h: alturaDaLinhaMm(pt) }, t, pt, alinhar))
      );
      continue;
    }
    if (el.tipo === "imagem") {
      if (!el.bitmap) continue;
      const f = paraFisico(modelo, el);
      const porLinha = Math.ceil(el.bitmap.w / 8);
      const total = porLinha * el.bitmap.h;
      // o bitmap já vem na orientação FÍSICA (o navegador gira ao rasterizar
      // quando a etiqueta é girada, `bitmapDaImagem`): a caixa física é onde
      // ele entra, e o ^GF não precisa girar nada
      partes.push(`^FO${dots(x0 + f.x, dpi)},${dots(f.y, dpi)}^GFA,${total},${total},${porLinha},${el.bitmap.hex}^FS`);
      continue;
    }
    if (!ean13Valido(dados.codigo)) continue;
    // módulo inteiro em pontos (a Zebra não desenha meio ponto): o código
    // fica com 95 módulos e é centrado na área reservada. 1 ponto (0,125 mm)
    // só quando não cabe mais — é o limite do que um leitor comum lê.
    const larguraDots = dots(el.w, dpi);
    const modulo = Math.max(1, Math.min(4, Math.floor(larguraDots / (MODULOS_EAN13 + 18))));
    const larguraCodigoMm = ((modulo * MODULOS_EAN13) / dpi) * 25.4;
    const caixa = { x: el.x + Math.max(0, (el.w - larguraCodigoMm) / 2), y: el.y, w: larguraCodigoMm, h: el.h };
    const f = paraFisico(modelo, caixa);
    const alturaBarras = dots(el.h, dpi);
    partes.push(
      `^FO${dots(x0 + f.x, dpi)},${dots(f.y, dpi)}` +
        `^BY${modulo},2,${alturaBarras}` +
        `^BE${orient},${alturaBarras},N,N` +
        `^FD${dados.codigo.slice(0, 12)}^FS`
    );
    if (el.numero) {
      const ptNumero = Math.min(2.2, (el.w / 13) * 0.9) / MM_POR_PT;
      partes.push(texto({ x: el.x, y: el.y + el.h + 0.3, w: el.w, h: 2.2 }, dados.codigo, ptNumero, "C"));
    }
  }
  return partes;
}

/** Uma LINHA do rolo (até `colunas` etiquetas), com N cópias iguais. */
export function zplDaLinha(modelo: Modelo, linha: DadosEtiqueta[], copias = 1, dpi = DPI_ZEBRA_220): string {
  const partes: string[] = [
    `^XA`,
    `^CI28`,
    `^PW${dots(larguraDaLinha(modelo), dpi)}`,
    `^LL${dots(modelo.alturaMm, dpi)}`,
    `^LH0,0`,
  ];
  linha.slice(0, modelo.colunas).forEach((dados, c) => partes.push(...camposDaEtiqueta(modelo, dados, c, dpi)));
  partes.push(`^PQ${Math.max(1, Math.min(999, Math.floor(copias)))}`, `^XZ`);
  return partes.join("\n");
}

/** Uma etiqueta sozinha (rolo de uma coluna), com N cópias. */
export function zplDaEtiqueta(modelo: Modelo, dados: DadosEtiqueta, copias = 1, dpi = DPI_ZEBRA_220): string {
  return zplDaLinha({ ...modelo, colunas: 1 }, [dados], copias, dpi);
}

/**
 * O lote inteiro: cada peça pela quantidade, agrupado em linhas do rolo;
 * linhas iguais em sequência saem uma vez com `^PQ`.
 */
export function zplDoLote(
  modelo: Modelo,
  lote: { dados: DadosEtiqueta; quantidade: number }[],
  dpi = DPI_ZEBRA_220
): string {
  const linhas = linhasDoRolo(expandirLote(lote, TETO_ETIQUETAS_POR_PDF), modelo.colunas);
  const blocos: string[] = [];
  let i = 0;
  while (i < linhas.length) {
    const chave = linhas[i].map((d) => JSON.stringify(d)).join("|");
    let n = 1;
    while (i + n < linhas.length && linhas[i + n].map((d) => JSON.stringify(d)).join("|") === chave) n++;
    blocos.push(zplDaLinha(modelo, linhas[i], n, dpi));
    i += n;
  }
  return blocos.join("\n");
}

export { areaDeDesenho };
