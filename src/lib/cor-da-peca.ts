/**
 * PEÇA SEM COR SE CHAMA "Único" (RN-078, 09/10/2026).
 *
 * É o nome que a casa inteira já usa para "não tem cor": a Nuvemshop sem
 * atributo de cor, a importação de catálogo e o tamanho único da grade. Só a
 * sincronização da Jueri gravava a cor VAZIA ("") — e cor vazia derrubava o
 * pedido do catálogo público: a vitrine mandava `color: ""` e a porta do
 * pedido recusava como "dados inválidos" (a mensagem chegava no WhatsApp e o
 * pedido não entrava na aba Pedidos — relato da Sutilli Semijoias). A ficha
 * da peça também não salvava, pelo mesmo motivo.
 *
 * Função pura e sem banco: a porta do pedido usa a MESMA régua dos dois lados
 * (o que chega e o que está no cadastro), então o pedido antigo que ficou na
 * fila do aparelho com `color: ""` (RN-010) ainda casa com a peça renomeada.
 */
export const SEM_COR = "Único";

export function corOuUnica(cor: string | null | undefined): string {
  const t = (cor ?? "").trim();
  return t || SEM_COR;
}

/**
 * A variação que a vitrine pediu. O casamento EXATO vem primeiro — sempre foi
 * assim, e "Preto" e "Preto " seguem sendo cores diferentes. Só a cor vazia
 * ganha a ponte para "Único" (e vice-versa): é o pedido antigo da fila do
 * aparelho depois da renomeação. Com as duas na mesma peça (a migração deixa
 * a vazia quando o produto já tinha "Único" naquele tamanho), o exato decide
 * — a ponte nunca escolhe a variação errada por ordem de leitura.
 */
export function acharVariacao<V extends { color: string; size: string }>(
  variacoes: readonly V[],
  cor: string,
  tamanho: string
): V | undefined {
  const exata = variacoes.find((v) => v.color === cor && v.size === tamanho);
  if (exata || corOuUnica(cor) !== SEM_COR) return exata;
  return variacoes.find((v) => v.size === tamanho && corOuUnica(v.color) === SEM_COR);
}
