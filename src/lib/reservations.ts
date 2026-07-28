import { Prisma } from "@prisma/client";

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

/** O que a reserva PARCIAL (catálogo) precisa do banco. */
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

/** O que a reserva ATÔMICA em lote precisa do banco. */
type ClienteEmLote = {
  productVariant: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; stock: true };
    }) => Promise<{ id: string; stock: number }[]>;
  };
  $queryRaw: (...args: never[]) => Promise<unknown>;
};

/**
 * Junta o pedido por PEÇA antes de mexer no estoque.
 *
 * A mesma variação pode aparecer em duas linhas (duas linhas da mensagem do
 * WhatsApp que apontam para a mesma peça, ou a vendedora que adicionou o
 * mesmo item duas vezes). Somando antes, a conferência de estoque é feita
 * sobre o TOTAL — senão duas linhas de 1 peça passariam com 1 peça em
 * estoque, e o estoque ficaria negativo.
 */
export function juntarPorVariacao(itens: ItemDeEstoque[]): {
  variantId: string;
  quantity: number;
  label: string;
}[] {
  const mapa = new Map<string, { variantId: string; quantity: number; label: string }>();
  for (const i of itens) {
    if (!i.variantId || i.quantity <= 0) continue;
    const atual = mapa.get(i.variantId);
    if (atual) atual.quantity += i.quantity;
    else mapa.set(i.variantId, { variantId: i.variantId, quantity: i.quantity, label: i.label });
  }
  return [...mapa.values()];
}

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
/**
 * A BAIXA CONDICIONAL, isolada de quem a executa.
 *
 * Recebe o que precisa sair do estoque e devolve as peças que CONSEGUIRAM
 * sair (as demais não tinham saldo). Separar isso permite testar a regra
 * sem banco, e trocar o jeito de falar com o banco sem tocar na regra.
 */
export type BaixaCondicional = (
  pedidos: { variantId: string; quantity: number }[]
) => Promise<string[]>;

/** Quanto ainda existe de cada peça (só consultado quando algo faltou). */
export type ConsultaEstoque = (ids: string[]) => Promise<Map<string, number>>;

/**
 * A REGRA da reserva atômica, sem banco nenhum: junta por peça, manda baixar
 * de uma vez e relata o que não coube.
 */
export async function reservarCom(
  baixar: BaixaCondicional,
  consultar: ConsultaEstoque,
  itens: ItemDeEstoque[]
): Promise<FaltaDeEstoque[]> {
  const pedidos = juntarPorVariacao(itens);
  if (pedidos.length === 0) return [];

  const reservadas = new Set(
    await baixar(pedidos.map((p) => ({ variantId: p.variantId, quantity: p.quantity })))
  );
  const faltando = pedidos.filter((p) => !reservadas.has(p.variantId));
  if (faltando.length === 0) return [];

  const estoque = await consultar(faltando.map((f) => f.variantId));
  return faltando.map((f) => ({
    label: f.label,
    pedido: f.quantity,
    disponivel: Math.max(estoque.get(f.variantId) ?? 0, 0),
  }));
}

/**
 * RESERVA ATÔMICA — TUDO NUMA IDA SÓ AO BANCO.
 *
 * Antes era um comando por peça. Com o banco na mesma máquina isso é
 * instantâneo, mas em produção o banco fica na nuvem e cada comando é uma
 * viagem de ida e volta: um pedido de 29 linhas virava ~30 viagens dentro da
 * transação, estourava o tempo limite e a vendedora via só "não foi possível
 * criar o pedido", sem explicação nenhuma. Foi o que aconteceu com o pedido
 * de 31 peças da LOJA DA GABI.
 *
 * A condição "stock >= pedido" continua DENTRO do comando, linha por linha:
 * o banco segue garantindo que duas vendas simultâneas da última peça não
 * passem as duas, e que o estoque nunca fique negativo.
 */
export async function reservarEstoque(
  tx: ClienteEmLote,
  itens: ItemDeEstoque[]
): Promise<FaltaDeEstoque[]> {
  return reservarCom(
    async (pedidos) => {
      const linhas = Prisma.join(
        pedidos.map((p) => Prisma.sql`(${p.variantId}::text, ${p.quantity}::int)`)
      );
      const ok = (await tx.$queryRaw(
        Prisma.sql`
          UPDATE "ProductVariant" AS v
             SET stock = v.stock - d.qty
            FROM (VALUES ${linhas}) AS d(id, qty)
           WHERE v.id = d.id AND v.stock >= d.qty
          RETURNING v.id
        ` as never
      )) as { id: string }[];
      return ok.map((r) => r.id);
    },
    async (ids) => {
      const atuais = await tx.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true, stock: true },
      });
      return new Map(atuais.map((a) => [a.id, a.stock]));
    },
    itens
  );
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

