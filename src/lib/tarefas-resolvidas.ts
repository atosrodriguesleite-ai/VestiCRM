import { db } from "./db";
import { PAID_ORDER_STATUSES } from "./orders";
import { fimDeHojeSP } from "./contato-feito";

/**
 * A TAREFA QUE A VIDA JÁ RESOLVEU.
 *
 * Pedido do dono (07/08/2026), com dois exemplos que dizem tudo:
 *
 *  1. "Aparece 'chamar fulano'. Só que antes de ver a tarefa eu já tinha
 *      chamado o cliente."
 *  2. "'Gabriel pendente de pagamento'. O Gabriel pagou, eu marquei o pedido
 *      como PAGO — e a tarefa continuava lá dizendo que ele deve."
 *
 * O sistema criava a tarefa e depois nunca mais olhava para o MOTIVO dela.
 * Só duas coisas fechavam uma tarefa: alguém clicar, ou sair uma mensagem
 * enquanto a tarefa estava aberta. Se a realidade mudasse por qualquer outro
 * caminho — o pagamento entrou, o pedido foi entregue, a cliente comprou de
 * novo, a oportunidade fechou — a tarefa virava mentira na tela. E lista que
 * mente é lista que a lojista para de olhar.
 *
 * Aqui a tarefa passa a ser CONFERIDA contra a realidade. A conferência roda
 * quando a agenda é aberta (é quando a verdade importa) e não depende de
 * nenhum evento ter sido capturado na hora certa — justamente porque evento
 * perdido já causou incidente nesta casa.
 *
 * REGRA DE OURO: a prova tem que ser MAIS NOVA que a tarefa. Cliente que
 * pagou mês passado não fecha a cobrança de hoje.
 */

/** Por que a tarefa se fechou sozinha (aparece na tela, para dar confiança). */
export type MotivoResolvido =
  | "PAGAMENTO_CONFIRMADO"
  | "PEDIDO_CANCELADO"
  | "PEDIDO_ENTREGUE"
  | "CLIENTE_JA_CHAMADO"
  | "CLIENTE_JA_COMPROU"
  | "OPORTUNIDADE_FECHADA";

export const TEXTO_RESOLVIDO: Record<MotivoResolvido, string> = {
  PAGAMENTO_CONFIRMADO: "o pagamento entrou",
  PEDIDO_CANCELADO: "o pedido foi cancelado",
  PEDIDO_ENTREGUE: "o pedido foi entregue",
  CLIENTE_JA_CHAMADO: "você já falou com a cliente",
  CLIENTE_JA_COMPROU: "a cliente comprou de novo",
  OPORTUNIDADE_FECHADA: "a negociação foi fechada",
};

/** Tarefas cujo trabalho é COBRAR. Só o dinheiro entrando as encerra. */
const TIPOS_DE_COBRANCA = ["COBRAR_PAGAMENTO"];
/** Tarefas cujo trabalho é a ENTREGA chegar. */
const TIPOS_DE_ENTREGA = ["CONFIRMAR_ENTREGA"];
/**
 * Tarefas cujo trabalho é o próprio CONTATO. Mandar mensagem já é fazer.
 * Cobrança e entrega ficam de fora de propósito: mandar mensagem não faz o
 * dinheiro entrar nem a encomenda chegar. "OUTRO" também fica de fora — é o
 * balde do trabalho que NÃO é contato ("separar a troca da Maria"): fechar
 * essas por mensagem apagaria lembretes de trabalho não feito (mesma régua
 * de `contato-feito.ts`, que também exclui OUTRO).
 */
const TIPOS_DE_CONTATO = [
  "LIGAR",
  "FOLLOW_UP",
  "REATIVAR",
  "ENVIAR_CATALOGO",
  "ENVIAR_NOVIDADES",
  "POS_VENDA",
];

/** O retrato da realidade daquela cliente, no momento da conferência. */
export type RetratoDaCliente = {
  /** último momento em que SAIU mensagem nossa para ela */
  ultimaMensagemNossa: Date | null;
  /** quando um pedido dela passou a estar pago (o mais recente, por `paidAt`) */
  pagouEm: Date | null;
  /** quando um pedido dela foi entregue (o mais recente) */
  entregueEm: Date | null;
  /** quando um pedido dela foi cancelado (o mais recente) */
  canceladoEm: Date | null;
  /**
   * AINDA existe pedido dela aguardando pagamento?
   *
   * É o que impede o pagamento do pedido B de fechar a cobrança do pedido A
   * (a tarefa não sabe de qual pedido é — não existe `Task.orderId`). Se
   * sobrou QUALQUER pedido esperando dinheiro, a cobrança fica de pé.
   */
  aindaDevendo: boolean;
  /** AINDA existe pedido dela na rua (ENVIADO)? Segura a confirmação de entrega. */
  aindaACaminho: boolean;
};

export type TarefaParaConferir = {
  id: string;
  type: string;
  createdAt: Date;
  /** quando a tarefa vence — compromisso FUTURO não se fecha por mensagem */
  dueAt: Date;
  customerId: string | null;
  /** a oportunidade ligada já foi fechada (ganha ou perdida)? */
  oportunidadeFechadaEm?: Date | null;
};

const depois = (prova: Date | null | undefined, tarefa: Date) =>
  !!prova && prova.getTime() > tarefa.getTime();

/**
 * A realidade já resolveu esta tarefa? Devolve o motivo, ou `null`.
 *
 * Função PURA: recebe a tarefa, o retrato da cliente e o agora. É aqui que
 * mora a inteligência — e é por isso que dá para testar cada caso.
 */
export function motivoResolvido(
  tarefa: TarefaParaConferir,
  retrato: RetratoDaCliente,
  agora = new Date()
): MotivoResolvido | null {
  const nasceu = tarefa.createdAt;

  // COBRAR: só fecha quando NÃO SOBROU pedido esperando dinheiro E algo
  // aconteceu depois da tarefa. Mandar mensagem não fecha; pagar OUTRO
  // pedido também não (a dívida de A não se paga com o dinheiro de B).
  if (TIPOS_DE_COBRANCA.includes(tarefa.type)) {
    if (retrato.aindaDevendo) return null;
    if (depois(retrato.pagouEm, nasceu)) return "PAGAMENTO_CONFIRMADO";
    if (depois(retrato.canceladoEm, nasceu)) return "PEDIDO_CANCELADO";
    return null;
  }

  // CONFIRMAR ENTREGA: só fecha quando não há mais pedido na rua E uma
  // entrega (ou cancelamento) aconteceu depois da tarefa.
  if (TIPOS_DE_ENTREGA.includes(tarefa.type)) {
    if (retrato.aindaACaminho) return null;
    if (depois(retrato.entregueEm, nasceu)) return "PEDIDO_ENTREGUE";
    if (depois(retrato.canceladoEm, nasceu)) return "PEDIDO_CANCELADO";
    return null;
  }

  // CONTATO: falar com a cliente É o trabalho. Comprar de novo também
  // encerra — "reativar quem sumiu" perde o sentido quando ela voltou.
  if (TIPOS_DE_CONTATO.includes(tarefa.type)) {
    // Mensagem só fecha tarefa de HOJE ou atrasada. O compromisso marcado
    // para semana que vem ("a cliente pediu para voltar dia 20") continua de
    // pé mesmo que outra conversa aconteça hoje — mesma régua do
    // `contato-feito.ts`, que o adiar da agenda depende para funcionar.
    const compromissoFuturo = tarefa.dueAt.getTime() >= fimDeHojeSP(agora).getTime();
    if (!compromissoFuturo && depois(retrato.ultimaMensagemNossa, nasceu)) {
      return "CLIENTE_JA_CHAMADO";
    }
    if (depois(retrato.pagouEm, nasceu)) return "CLIENTE_JA_COMPROU";
    if (depois(tarefa.oportunidadeFechadaEm, nasceu)) return "OPORTUNIDADE_FECHADA";
    return null;
  }

  return null;
}

/**
 * Confere as tarefas em aberto contra a realidade e fecha as já resolvidas.
 *
 * Barato: três consultas indexadas, todas presas às clientes que aparecem nas
 * tarefas. Nunca lança — conferência que derruba a agenda é pior do que
 * conferência nenhuma.
 *
 * Devolve quantas fechou (o chamador decide se avisa).
 */
export async function fecharTarefasResolvidas(companyId: string): Promise<number> {
  try {
    const abertas = await db.task.findMany({
      where: { companyId, status: "PENDENTE", customerId: { not: null } },
      select: {
        id: true,
        type: true,
        createdAt: true,
        dueAt: true,
        customerId: true,
        opportunity: { select: { closedAt: true, status: true } },
      },
      // teto de segurança: agenda gigante não pode travar a abertura da tela.
      // A ordem é fixa (mais antiga primeiro) para o teto não deixar um
      // resto aleatório de tarefas nunca conferidas.
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    if (abertas.length === 0) return 0;

    const clientes = [
      ...new Set(abertas.map((t) => t.customerId).filter((v): v is string => !!v)),
    ];

    const [conversas, pedidos] = await Promise.all([
      db.conversation.findMany({
        where: { companyId, customerId: { in: clientes } },
        select: { customerId: true, lastOutboundAt: true },
      }),
      db.order.findMany({
        where: { companyId, customerId: { in: clientes } },
        select: {
          customerId: true,
          status: true,
          paidAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const retratos = new Map<string, RetratoDaCliente>();
    const pega = (id: string) => {
      let r = retratos.get(id);
      if (!r) {
        r = {
          ultimaMensagemNossa: null,
          pagouEm: null,
          entregueEm: null,
          canceladoEm: null,
          aindaDevendo: false,
          aindaACaminho: false,
        };
        retratos.set(id, r);
      }
      return r;
    };
    const maisNovo = (a: Date | null, b: Date | null) =>
      !a ? b : !b ? a : a > b ? a : b;

    for (const c of conversas) {
      if (!c.customerId) continue;
      const r = pega(c.customerId);
      r.ultimaMensagemNossa = maisNovo(r.ultimaMensagemNossa, c.lastOutboundAt);
    }
    for (const o of pedidos) {
      const r = pega(o.customerId);
      if (PAID_ORDER_STATUSES.includes(o.status)) {
        // SÓ `paidAt` (a data do dinheiro). `updatedAt` mexe em QUALQUER
        // edição do pedido — usar como prova faria um ajuste de observação
        // num pedido velho "pagar" a cobrança de hoje.
        r.pagouEm = maisNovo(r.pagouEm, o.paidAt);
      }
      if (o.status === "ENTREGUE") r.entregueEm = maisNovo(r.entregueEm, o.updatedAt);
      if (o.status === "CANCELADO") r.canceladoEm = maisNovo(r.canceladoEm, o.updatedAt);
      // pendências que SEGURAM a tarefa aberta (o que impede o pagamento do
      // pedido B de esconder a dívida do pedido A)
      if (o.status === "AGUARDANDO_PAGAMENTO") r.aindaDevendo = true;
      if (o.status === "ENVIADO") r.aindaACaminho = true;
    }

    const porMotivo = new Map<MotivoResolvido, string[]>();
    for (const t of abertas) {
      const retrato = retratos.get(t.customerId!);
      if (!retrato) continue;
      const motivo = motivoResolvido(
        {
          id: t.id,
          type: t.type,
          createdAt: t.createdAt,
          dueAt: t.dueAt,
          customerId: t.customerId,
          oportunidadeFechadaEm:
            t.opportunity && t.opportunity.status !== "OPEN"
              ? t.opportunity.closedAt
              : null,
        },
        retrato
      );
      if (!motivo) continue;
      porMotivo.set(motivo, [...(porMotivo.get(motivo) ?? []), t.id]);
    }

    let total = 0;
    for (const [motivo, ids] of porMotivo) {
      const r = await db.task.updateMany({
        where: { id: { in: ids }, status: "PENDENTE" },
        // o motivo fica gravado: sem isso a tarefa "some" e a lojista
        // desconfia do sistema em vez de confiar
        data: { status: "CONCLUIDA", autoDoneReason: motivo },
      });
      total += r.count;
    }
    return total;
  } catch {
    // conferência NUNCA pode derrubar a tela que a carregou
    return 0;
  }
}
