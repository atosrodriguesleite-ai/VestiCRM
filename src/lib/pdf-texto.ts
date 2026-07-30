import type { PDFPage, PDFPageDrawTextOptions } from "pdf-lib";

/**
 * TEXTO SEGURO PARA PDF.
 *
 * Incidente real (Entre Linhas, pedido #0137, 30/07/2026): abrir o romaneio
 * devolvia ERRO 500 e a loja ficava sem o papel da separação.
 *
 * Motivo: as fontes padrão do PDF (Helvetica e cia.) só sabem escrever a
 * tabela WinAnsi — o alfabeto ocidental. Emoji não está lá. E a biblioteca não
 * ignora o que não sabe desenhar: ela ESTOURA. Um 💜 no nome da cliente, no
 * nome da peça ou na observação derrubava o romaneio inteiro.
 *
 * Isso acontece justamente onde mais tem emoji: pedido que veio do WhatsApp.
 *
 * A regra aqui é simples: o que a fonte sabe escrever, passa; o que ela não
 * sabe, sai fora. Melhor um romaneio sem o coraçãozinho do que romaneio
 * nenhum.
 */

/**
 * Caracteres que a WinAnsi tem além do Latin-1 (aspas curvas, travessão,
 * reticências, bala, euro…). São comuns em texto colado do WhatsApp.
 */
const EXTRAS_WINANSI = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("")
);

function cabeNoPdf(c: string): boolean {
  const n = c.codePointAt(0) ?? 0;
  // ASCII imprimível
  if (n >= 0x20 && n <= 0x7e) return true;
  // Latin-1 (acentos do português: á é ç ã õ …)
  if (n >= 0xa0 && n <= 0xff) return true;
  return EXTRAS_WINANSI.has(c);
}

/**
 * Deixa o texto pronto para o PDF: tira o que a fonte não sabe desenhar
 * (emoji, símbolos exóticos) e troca quebra de linha por espaço.
 */
export function textoPdf(texto: string | null | undefined): string {
  if (!texto) return "";
  let saida = "";
  // percorre por PONTO DE CÓDIGO: emoji ocupa duas posições e cortar no meio
  // deixaria metade de um caractere para trás
  for (const c of texto.replace(/[\r\n\t]+/g, " ")) {
    saida += cabeNoPdf(c) ? c : "";
  }
  // emoji removido costuma deixar espaço dobrado
  return saida.replace(/ {2,}/g, " ").trim();
}

/**
 * Blinda UMA página: tudo que for escrito nela passa pelo filtro antes.
 *
 * É de propósito que a proteção fique aqui e não em cada chamada: o romaneio
 * tem mais de 30 lugares que escrevem texto, e bastava UM sem proteção para o
 * PDF inteiro cair de novo. Aqui não tem como esquecer.
 */
export function paginaSegura<T extends PDFPage>(page: T): T {
  const original = page.drawText.bind(page);
  page.drawText = (texto: string, opcoes?: PDFPageDrawTextOptions) =>
    original(textoPdf(texto), opcoes);
  return page;
}
