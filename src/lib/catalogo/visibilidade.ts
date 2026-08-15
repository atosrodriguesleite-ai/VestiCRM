/**
 * POR QUE ESTA PEÇA NÃO APARECE NO CATÁLOGO DO CLIENTE.
 *
 * A vitrine pública esconde peça em quatro situações — e até aqui a loja não
 * tinha como saber em qual delas caiu. O selo da tela de Produtos dizia "Sem
 * estoque" (que a pessoa lê como "aparece, mas esgotado") enquanto o produto
 * simplesmente não existia no catálogo. Incidente real: a lojista passou o dia
 * achando que era erro do sistema.
 *
 * Este arquivo é a TRADUÇÃO das regras da vitrine para linguagem de loja. As
 * regras de verdade vivem em `src/app/catalogo/[slug]/page.tsx` (o filtro do
 * banco) e em `public-catalog.tsx` (um card POR COR). O teste
 * `catalogo-visibilidade.test.ts` vigia os dois arquivos: mudou a regra lá,
 * o teste cobra o ajuste aqui — senão o diagnóstico volta a mentir.
 */

/** O mínimo que precisamos saber da peça para decidir. */
export type PecaParaVitrine = {
  active: boolean;
  /** basta a QUANTIDADE de fotos: a vitrine exige `images: { some: {} }` */
  images: { id?: string }[];
  variants: { stock: number }[];
  /** produto espelhado da loja online (muda o conselho do "inativo") */
  nuvemshopId?: string | null;
};

export type CodigoOculto = "INATIVO" | "SEM_FOTO" | "SEM_GRADE" | "SEM_ESTOQUE";

export type MotivoOculto = {
  codigo: CodigoOculto;
  /** cabe no selo do card (2 a 3 palavras) */
  curto: string;
  /** a frase que a lojista lê */
  motivo: string;
  /** o próximo passo, sem jargão */
  comoResolver: string;
};

/**
 * Devolve o motivo de a peça estar fora do catálogo — ou `null` quando ela
 * está no ar. A ordem é a mesma da vitrine: primeiro o que desliga a peça
 * inteira, depois o que a deixa sem nada para mostrar.
 */
export function motivoOculto(
  peca: PecaParaVitrine,
  opcoes: { esconderSemEstoque: boolean }
): MotivoOculto | null {
  if (!peca.active) {
    return {
      codigo: "INATIVO",
      curto: "Inativo · oculto",
      motivo: "A peça está desativada, então não entra no catálogo.",
      comoResolver: peca.nuvemshopId
        ? "Reative aqui em “Ativar peça”. Atenção: se ela estiver despublicada na Nuvemshop, a próxima sincronização desativa de novo — publique lá também."
        : "Clique em “Ativar peça” para colocá-la no ar.",
    };
  }

  if (peca.images.length === 0) {
    return {
      codigo: "SEM_FOTO",
      curto: "Sem foto · oculto",
      motivo: "A peça não tem nenhuma foto, e a vitrine só mostra peça com foto.",
      comoResolver: "Adicione pelo menos uma foto — ela aparece no catálogo na hora.",
    };
  }

  // um card POR COR: peça sem nenhuma cor/tamanho cadastrado não tem card
  // nenhum para desenhar. Some da vitrine sem aviso — este era o caso mais
  // silencioso de todos (acontece muito com produto importado sem SKU).
  if (peca.variants.length === 0) {
    return {
      codigo: "SEM_GRADE",
      curto: "Sem grade · oculto",
      motivo:
        "A peça não tem nenhuma cor/tamanho cadastrado. O catálogo mostra uma foto por COR — sem grade, não há o que mostrar.",
      comoResolver:
        "Cadastre a grade em “Grade e estoque”: escolha a cor, o tamanho, a quantidade e clique no +.",
    };
  }

  const total = peca.variants.reduce((s, v) => s + Math.max(0, v.stock), 0);
  if (opcoes.esconderSemEstoque && total === 0) {
    return {
      codigo: "SEM_ESTOQUE",
      curto: "Sem estoque · oculto",
      motivo:
        "A peça está zerada e a loja escolheu esconder do catálogo o que está sem estoque.",
      comoResolver:
        "Reponha o estoque (ela volta sozinha) ou desligue a chavinha “Esconder do catálogo os produtos sem estoque”, em Produtos.",
    };
  }

  return null;
}

/**
 * Quantas peças estão fora do ar — o número que a lojista quer ver de longe,
 * antes de abrir produto por produto.
 */
export function contarOcultas(
  pecas: PecaParaVitrine[],
  opcoes: { esconderSemEstoque: boolean }
): number {
  return pecas.filter((p) => motivoOculto(p, opcoes) !== null).length;
}
