/**
 * CAPA POR COR — pedido da Entre Linhas (03/08/2026).
 *
 * O catálogo mostra 1 card por cor, mas a foto era sempre a capa geral do
 * produto: o card da Avelã aparecia com a foto da peça preta. Agora cada
 * foto pode carregar a etiqueta da cor que ela mostra, e o card usa a foto
 * DA COR. Sem foto etiquetada, cai na capa geral — nenhum produto quebra.
 *
 * O casamento de cor é EXATO (normalizado): etiqueta "Azul" NÃO serve para o
 * card "Azul Serenity" — com "Azul Marinho" na grade, o "contém" erraria a
 * foto. As opções de etiqueta vêm da própria grade do produto, então bater
 * exato é o comportamento previsível.
 */

export type FotoComCor = { url: string; color: string | null };

/** compara cores sem pegadinha de acento/caixa/espaço */
export const corIgual = (a: string | null | undefined, b: string | null | undefined) => {
  const n = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();
  const x = n(a);
  const y = n(b);
  return x.length > 0 && x === y;
};

/** A capa do card desta cor: 1ª foto etiquetada com ela; senão, a capa geral. */
export function fotoDaCor(fotos: FotoComCor[], color: string): string | undefined {
  return (fotos.find((f) => corIgual(f.color, color)) ?? fotos[0])?.url;
}

/**
 * O carrossel da ficha aberto numa cor: as fotos DELA primeiro, depois as
 * sem etiqueta (servem para todas), depois as das outras cores — nada some.
 */
export function ordenarFotosDaCor(fotos: FotoComCor[], color: string): string[] {
  const peso = (f: FotoComCor) => (corIgual(f.color, color) ? 0 : f.color ? 2 : 1);
  return [...fotos]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => peso(a.f) - peso(b.f) || a.i - b.i)
    .map(({ f }) => f.url);
}
