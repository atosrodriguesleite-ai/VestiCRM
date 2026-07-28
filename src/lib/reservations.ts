/**
 * RESERVA DE ESTOQUE — a peça sai do estoque quando o orçamento é montado.
 *
 * REGRA DA LOJA: a reserva NÃO TEM PRAZO. Montou o orçamento, a peça está
 * segurada; ela só volta para o estoque quando a vendedora CANCELA o pedido.
 *
 * Antes existia uma soltura automática em 48h. Ela ia contra o jeito de
 * vender do atacado: a cliente pede na terça, paga na sexta, e no meio do
 * caminho a peça voltava para a prateleira e era vendida para outra. Quem
 * decide desistir da venda é a loja, não o relógio.
 *
 * A contrapartida é responsabilidade: orçamento esquecido segura peça para
 * sempre. Por isso a tela do pedido mostra, em cima, quantas peças aquele
 * orçamento está segurando — e que elas voltam ao cancelar.
 */

export type ItemDeEstoque = {
  variantId: string | null;
  quantity: number;
  /** nome legível da peça, para a mensagem de erro */
  label: string;
};

export type FaltaDeEstoque = { label: string; pedido: number; disponivel: number };

type ClientePrisma = {
  productVariant: {
    updateMany: (args: {
      where: { id: string; stock: { gte: number } };
      data: { stock: { decrement: number } };
    }) => Promise<{ count: number }>;
    findUnique: (args: {
      where: { id: string };
      select: { stock: true };
    }) => Promise<{ stock: number } | null>;
  };
};

/**
 * RESERVA ATÔMICA DE ESTOQUE.
 *
 * Conferir o estoque e depois baixar em dois passos separados tem uma janela
 * no meio: duas clientes fechando a última peça no mesmo segundo passam as
 * duas na conferência e as duas baixam. O `updateMany` com `stock >= pedido`
 * faz as duas coisas de uma vez — o banco garante que só uma ganha; a outra
 * volta zero linhas e o pedido é recusado com a mensagem certa.
 *
 * Devolve a lista do que FALTOU (vazia = reservou tudo). Quem chama decide
 * se recusa o pedido (catálogo/vendedora) ou se só avisa (baixa de um pedido
 * antigo que já foi pago).
 */
export async function reservarEstoque(
  tx: ClientePrisma,
  itens: ItemDeEstoque[]
): Promise<FaltaDeEstoque[]> {
  const faltas: FaltaDeEstoque[] = [];
  for (const item of itens) {
    if (!item.variantId || item.quantity <= 0) continue;
    const r = await tx.productVariant.updateMany({
      where: { id: item.variantId, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });
    if (r.count === 0) {
      const atual = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { stock: true },
      });
      faltas.push({
        label: item.label,
        pedido: item.quantity,
        disponivel: Math.max(atual?.stock ?? 0, 0),
      });
    }
  }
  return faltas;
}

/**
 * RESERVA O QUE TIVER — usada no pedido do CATÁLOGO PÚBLICO.
 *
 * Aqui recusar o pedido inteiro seria pior: a cliente monta o carrinho e o
 * WhatsApp abre com a mensagem dela no mesmo clique. Se o servidor recusasse,
 * ela mandaria o pedido e a loja não teria pedido nenhum na tela — sumiria a
 * venda. Então o sistema segura tudo o que existe, cria o pedido e AVISA na
 * cara da loja o que faltou, para a vendedora resolver com a cliente (outra
 * cor, outro tamanho, esperar reposição).
 *
 * O estoque nunca fica negativo: cada baixa é condicionada ao que há.
 */
export async function reservarOQueTiver(
  tx: ClientePrisma,
  itens: ItemDeEstoque[]
): Promise<FaltaDeEstoque[]> {
  const faltas: FaltaDeEstoque[] = [];
  for (const item of itens) {
    if (!item.variantId || item.quantity <= 0) continue;
    const cheio = await tx.productVariant.updateMany({
      where: { id: item.variantId, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });
    if (cheio.count > 0) continue; // segurou a quantidade toda

    const atual = await tx.productVariant.findUnique({
      where: { id: item.variantId },
      select: { stock: true },
    });
    const disponivel = Math.max(atual?.stock ?? 0, 0);
    if (disponivel > 0) {
      // segura o que sobrou (condicionado de novo: nunca deixa negativo)
      await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: disponivel } },
        data: { stock: { decrement: disponivel } },
      });
    }
    faltas.push({ label: item.label, pedido: item.quantity, disponivel });
  }
  return faltas;
}

/** Frase pronta para a cliente/vendedora entender o que faltou. */
export function textoDaFalta(faltas: FaltaDeEstoque[]): string {
  return faltas
    .map((f) =>
      f.disponivel > 0
        ? `${f.label}: você pediu ${f.pedido} e restam ${f.disponivel}`
        : `${f.label}: esgotado`
    )
    .join("; ");
}

