import { casaTexto, normalizarBusca } from "../busca";

/**
 * PROCURAR PEÇA NO CATÁLOGO PÚBLICO.
 *
 * A Toque Leve tem 178 produtos — e, como o catálogo mostra um card por COR,
 * isso vira centenas de cards. Não havia lupa nenhuma: para achar uma peça,
 * a pessoa rolava a página inteira. Incidente real (07/08/2026): a peça
 * estava no ar, o conferidor provou que estava, e a loja continuava dizendo
 * "não aparece" — ela simplesmente não achava no meio da vitrine.
 *
 * A busca é a MESMA do resto do sistema (`casaTexto`): sem acento, sem
 * maiúscula. "bermuda avela" acha "Bermuda Bolso Premium · Avelã".
 */

export type PecaProcuravel = {
  product: { name: string; sku: string; category: string; tags?: string | null };
  color: string;
};

/**
 * Uma peça casa com o que foi digitado?
 *
 * Procura por NOME, CÓDIGO (SKU), CATEGORIA, COR e ETIQUETAS — que é por onde
 * a cliente procura na vida real ("bermuda", "preto", "359003", "festa").
 * Cada palavra digitada precisa casar com ALGUM desses campos: assim
 * "bermuda preto" acha a bermuda na cor preta, e não toda peça preta.
 */
export function casaPeca(peca: PecaProcuravel, termo: string): boolean {
  const t = termo.trim();
  if (!t) return true;
  const palavras = normalizarBusca(t).split(/\s+/).filter(Boolean);
  const campos = [
    peca.product.name,
    peca.product.sku,
    peca.product.category,
    peca.color,
    peca.product.tags ?? "",
  ];
  return palavras.every((p) => campos.some((c) => casaTexto(c, p)));
}

/** Filtra a vitrine inteira. Termo vazio devolve tudo (a lupa não some nada). */
export function procurarPecas<T extends PecaProcuravel>(pecas: T[], termo: string): T[] {
  if (!termo.trim()) return pecas;
  return pecas.filter((p) => casaPeca(p, termo));
}
