/**
 * QUEM MANDA NO ESTOQUE DE CADA PEÇA (RN-050) — regra pura, sem banco.
 *
 * Pedido do dono ao desenhar o módulo Estoque (09/09/2026): "caso o cliente
 * tenha Nuvemshop ou outro sistema de e-commerce ou marketplace, esse outro
 * sistema continua mandando no estoque, e deve respeitar as integrações".
 *
 * Já era a régua da RN-014 (a Nuvemshop é a DONA do estoque), mas a tela
 * Produtos não a respeitava: deixava digitar um número novo numa variação
 * vinculada, gravava aqui e NÃO mandava para a Nuvemshop — na sincronização
 * seguinte o número de lá voltava por cima, e a lojista achava que o sistema
 * "perdia" o ajuste dela. Pior: entre o ajuste e a sync, o catálogo aqui
 * vendia uma peça que a loja online já tinha vendido.
 *
 * A regra é UMA, e vale nas duas telas (Inventário e Produtos):
 *   • peça vinculada a um sistema de fora → o número é DELE. Aqui só se lê,
 *     com o aviso "controlado pela Nuvemshop" e o caminho para sincronizar;
 *   • peça sem vínculo → edita-se aqui, sempre com motivo, e cada mexida
 *     vira uma linha do livro de movimentos (`InventoryMovement`).
 *
 * O que NÃO muda: venda (RN-003) e produção (`lancaNoEstoque`) continuam
 * baixando/subindo o estoque de peça vinculada — são movimentos REAIS, e o
 * espelho para a Nuvemshop (`pushStockToNuvemshop`) sai junto. O que a regra
 * barra é o AJUSTE DIGITADO por cima do número de outro sistema.
 */

/** Sistema de fora que é o dono do número desta peça. */
export type DonoExterno = "NUVEMSHOP" | "JUERI";

export const NOME_DO_DONO: Record<DonoExterno, string> = {
  NUVEMSHOP: "Nuvemshop",
  JUERI: "Jueri",
};

/** O que precisa saber de uma variação para decidir quem manda nela. */
export type PecaParaDono = {
  /** id da variação na Nuvemshop — é o vínculo que faz o espelho existir */
  nuvemshopId: string | null;
  product: {
    /** produto importado do Jueri: o estoque vem de lá, por produto */
    jueriId: string | null;
  };
};

/**
 * Quem manda no estoque desta variação.
 *
 * Nuvemshop vale por VARIAÇÃO: é o `ProductVariant.nuvemshopId` que a sync
 * preenche ao casar o SKU e que o espelho de estoque usa. Produto vindo da
 * Nuvemshop com uma cor/tamanho que NÃO existe lá fica sem vínculo — e sem
 * vínculo o número é nosso (a sync não o toca, o espelho não o manda).
 *
 * Jueri vale por PRODUTO: a integração grava o estoque por produto
 * (`Product.jueriId`), então toda variação dele é do Jueri.
 */
export function donoDoEstoque(v: PecaParaDono): DonoExterno | null {
  if (v.nuvemshopId) return "NUVEMSHOP";
  if (v.product.jueriId) return "JUERI";
  return null;
}

/** Tamanho máximo do motivo (vai para o livro de movimentos, com o nome). */
export const TETO_DO_MOTIVO = 120;

export type PedidoDeAjuste = {
  /** quem manda nesta peça (null = nós) */
  dono: DonoExterno | null;
  /** quem pede tem o papel de ajustar? (gerência) */
  podeAjustar: boolean;
  estoqueAtual: number;
  novoEstoque: number;
  motivo: string;
};

export type DecisaoDeAjuste =
  | { tipo: "RECUSADO"; porque: "SEM_PERMISSAO" | "DONO_EXTERNO" | "SEM_MOTIVO" | "NUMERO_INVALIDO"; dono?: DonoExterno }
  | { tipo: "NADA" }
  | {
      tipo: "AJUSTAR";
      /** sempre positivo: o sinal está em `de`/`para` */
      quantidade: number;
      de: number;
      para: number;
      motivo: string;
    };

/**
 * A decisão pura do ajuste digitado. A ORDEM das recusas importa: a
 * permissão vem antes de tudo (vendedora não descobre pelo erro se a peça é
 * da Nuvemshop), o dono externo vem antes do motivo (não adianta pedir
 * motivo para um ajuste que não vai acontecer), e "mesmo número" NÃO é
 * recusa — a tela Produtos manda a grade inteira a cada salvamento, e a
 * variação vinculada que não mudou tem que passar em silêncio.
 */
export function decidirAjuste(p: PedidoDeAjuste): DecisaoDeAjuste {
  if (!p.podeAjustar) return { tipo: "RECUSADO", porque: "SEM_PERMISSAO" };
  if (!Number.isInteger(p.novoEstoque) || p.novoEstoque < 0)
    return { tipo: "RECUSADO", porque: "NUMERO_INVALIDO" };
  if (p.novoEstoque === p.estoqueAtual) return { tipo: "NADA" };
  if (p.dono) return { tipo: "RECUSADO", porque: "DONO_EXTERNO", dono: p.dono };
  const motivo = p.motivo.trim().slice(0, TETO_DO_MOTIVO);
  if (!motivo) return { tipo: "RECUSADO", porque: "SEM_MOTIVO" };
  return {
    tipo: "AJUSTAR",
    quantidade: Math.abs(p.novoEstoque - p.estoqueAtual),
    de: p.estoqueAtual,
    para: p.novoEstoque,
    motivo,
  };
}

/** A frase da recusa, em português de loja. */
export function fraseDaRecusa(
  d: Extract<DecisaoDeAjuste, { tipo: "RECUSADO" }>,
  rotuloDaPeca: string
): string {
  switch (d.porque) {
    case "SEM_PERMISSAO":
      return "Só gerente ou admin ajusta estoque.";
    case "DONO_EXTERNO":
      return `O estoque de ${rotuloDaPeca} é controlado ${d.dono === "JUERI" ? "pelo" : "pela"} ${NOME_DO_DONO[d.dono!]}. Ajuste lá e sincronize aqui.`;
    case "SEM_MOTIVO":
      return `Diga o motivo do ajuste de ${rotuloDaPeca} (contagem, avaria, devolução…).`;
    case "NUMERO_INVALIDO":
      return `Estoque de ${rotuloDaPeca} tem que ser um número inteiro, zero ou mais.`;
  }
}

/**
 * O texto que vai para o livro de movimentos. O formato "(antes → depois)"
 * é o MESMO que a tela Produtos sempre gravou e que a sincronização usa —
 * quem lê o histórico vê o número de onde saiu e onde parou.
 */
export function motivoDoLivro(
  quem: string,
  d: Extract<DecisaoDeAjuste, { tipo: "AJUSTAR" }>
): string {
  return `Ajuste manual por ${quem}: ${d.motivo} (${d.de} → ${d.para})`;
}

/** O que a tela diz ao lado do cadeado — cada dono tem o SEU caminho. */
export const DICA_DO_DONO: Record<DonoExterno, string> = {
  NUVEMSHOP: "Estoque controlado pela Nuvemshop. Ajuste lá e clique em Sincronizar.",
  JUERI: "Estoque controlado pelo Jueri. Ajuste lá — ele sincroniza sozinho, duas vezes por dia.",
};

/** Rótulo curto da peça para frases e histórico: "Vestido Lia · Azul · M". */
export function rotuloDaPeca(v: { color: string; size: string; product: { name: string } }): string {
  return [v.product.name, v.color, v.size].filter((x) => x && x.trim()).join(" · ");
}
