/**
 * ETIQUETA EM ZPL — a língua da Zebra (RN-059). Regra pura.
 *
 * A Zebra 220 (ZD220) tem 203 dpi: 8 pontos por milímetro. Tudo aqui é
 * convertido de mm para pontos. O texto sai em UTF-8 (`^CI28`) com os bytes
 * fora do ASCII escapados em hexadecimal (`^FH_`) — é o jeito que funciona em
 * qualquer firmware; mandar "ç" cru dependia da configuração da impressora.
 * O código de barras usa o `^BE` (EAN-13 nativo): recebe os 12 dígitos e a
 * própria impressora calcula e imprime o verificador.
 */

import {
  encaixarTexto,
  estimarLarguraMm,
  valorDoCampo,
  MM_POR_PT,
  type DadosEtiqueta,
  type Modelo,
} from "./modelo";
import { MODULOS_EAN13, ean13Valido } from "./ean13";

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

/** Uma etiqueta (com N cópias iguais) em ZPL. */
export function zplDaEtiqueta(
  modelo: Modelo,
  dados: DadosEtiqueta,
  copias = 1,
  dpi = DPI_ZEBRA_220
): string {
  const W = dots(modelo.larguraMm, dpi);
  const H = dots(modelo.alturaMm, dpi);
  const partes: string[] = [`^XA`, `^CI28`, `^PW${W}`, `^LL${H}`, `^LH0,0`];
  for (const el of modelo.elementos) {
    if (el.tipo === "texto") {
      const bruto = valorDoCampo(el, dados);
      if (!bruto) continue;
      const { texto, pt } = encaixarTexto(bruto, el.w, el.pt, estimarLarguraMm);
      const altura = dots(pt * MM_POR_PT, dpi);
      const alinhar = el.alinhar === "centro" ? "C" : el.alinhar === "dir" ? "R" : "L";
      // A Zebra tem UMA fonte escalável embutida (^A0, CG Triumvirate Bold
      // Condensed): não existe par regular/negrito. Posição, tamanho e corte
      // do texto são os mesmos do PDF e da prévia; o peso da letra é o da
      // impressora. Limite aceito e dito na documentação.
      partes.push(
        `^FO${dots(el.x, dpi)},${dots(el.y, dpi)}` +
          `^A0N,${altura},${altura}` +
          `^FB${dots(el.w, dpi)},1,0,${alinhar},0` +
          `^FH_^FD${escaparZpl(texto)}^FS`
      );
      continue;
    }
    if (!ean13Valido(dados.codigo)) continue;
    // módulo inteiro em pontos (a Zebra não desenha meio ponto): o código
    // fica com 95 módulos e é centrado na área reservada
    const larguraDots = dots(el.w, dpi);
    const modulo = Math.max(2, Math.min(4, Math.floor(larguraDots / (MODULOS_EAN13 + 18))));
    const larguraCodigo = modulo * MODULOS_EAN13;
    const x = dots(el.x, dpi) + Math.max(0, Math.round((larguraDots - larguraCodigo) / 2));
    const alturaBarras = dots(el.h, dpi);
    // a linha de interpretação da própria impressora (`Y`) tem altura que
    // ela decide e invadia o rodapé (achado da revisão): as barras saem sem
    // número (`N`) e o número é desenhado por nós, na MESMA posição e
    // tamanho do PDF e da prévia
    partes.push(
      `^FO${x},${dots(el.y, dpi)}` +
        `^BY${modulo},2,${alturaBarras}` +
        `^BEN,${alturaBarras},N,N` +
        `^FD${dados.codigo.slice(0, 12)}^FS`
    );
    if (el.numero) {
      const alturaNumero = dots(Math.min(2.2, (el.w / 13) * 0.9), dpi);
      partes.push(
        `^FO${dots(el.x, dpi)},${dots(el.y + el.h + 0.3, dpi)}` +
          `^A0N,${alturaNumero},${alturaNumero}` +
          `^FB${larguraDots},1,0,C,0` +
          `^FD${dados.codigo}^FS`
      );
    }
  }
  partes.push(`^PQ${Math.max(1, Math.min(999, Math.floor(copias)))}`, `^XZ`);
  return partes.join("\n");
}

/** Várias peças, cada uma com sua quantidade, num único envio para a impressora. */
export function zplDoLote(
  modelo: Modelo,
  lote: { dados: DadosEtiqueta; quantidade: number }[],
  dpi = DPI_ZEBRA_220
): string {
  return lote
    .filter((l) => l.quantidade > 0)
    .map((l) => zplDaEtiqueta(modelo, l.dados, l.quantidade, dpi))
    .join("\n");
}
