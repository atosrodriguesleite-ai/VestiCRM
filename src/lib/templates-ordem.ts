/**
 * ORDEM DAS RESPOSTAS RÁPIDAS — regra pura (sem banco, sem tela).
 *
 * A lista de respostas tem uma ordem única (MessageTemplate.order), e o
 * painel do chat as mostra AGRUPADAS por categoria. Por isso existem dois
 * jeitos de mover:
 *
 *   • dentroDaCategoria = true  (painel ⚡ do chat): a resposta troca de
 *     lugar com a vizinha DA MESMA categoria — pulando as das outras, para o
 *     movimento visual corresponder ao toque.
 *   • dentroDaCategoria = false (tela Configurações, filtro "Todos"): troca
 *     com a vizinha imediata da lista completa.
 *
 * Devolve a lista NOVA (ou a mesma referência quando não há o que mover —
 * item na ponta ou id desconhecido; quem chama usa isso para não gravar à
 * toa).
 */

export type TemplateOrdenavel = { id: string; category: string };

export function moverTemplate<T extends TemplateOrdenavel>(
  lista: T[],
  id: string,
  direcao: "subir" | "descer",
  dentroDaCategoria: boolean
): T[] {
  const de = lista.findIndex((t) => t.id === id);
  if (de < 0) return lista;

  const passo = direcao === "subir" ? -1 : 1;
  let para = de + passo;
  if (dentroDaCategoria) {
    // procura a vizinha DA MESMA categoria na direção pedida
    while (para >= 0 && para < lista.length && lista[para].category !== lista[de].category) {
      para += passo;
    }
  }
  if (para < 0 || para >= lista.length) return lista; // já está na ponta

  const nova = [...lista];
  // troca de posição: o efeito visual é "subiu/desceu um degrau" no grupo
  [nova[de], nova[para]] = [nova[para], nova[de]];
  return nova;
}
