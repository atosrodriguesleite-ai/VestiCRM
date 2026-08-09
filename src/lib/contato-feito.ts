import { db } from "./db";
import type { TaskType } from "@prisma/client";

/**
 * CONTATO FEITO FECHA O CICLO — pedido do dono (05/08/2026): "se está
 * recomendando e eu chamo o cliente no WhatsApp, essa tarefa deve ser
 * concluída".
 *
 * Quando sai mensagem para a cliente — pela Central OU pelo aplicativo do
 * celular (o eco do WhatsApp registra igual) — as tarefas de CONTATO dela
 * que estavam para hoje (ou atrasadas) se concluem sozinhas, e as sugestões
 * ("clientes para chamar") somem de todas as listas até o dia virar.
 */

/**
 * Só tarefa cujo TRABALHO é o próprio contato se conclui sozinha. Cobrança e
 * confirmação de entrega ficam de fora: mandar mensagem não garante que o
 * pagamento entrou nem que a encomenda chegou — concluir essas no automático
 * esconderia dinheiro e entrega pendentes.
 */
export const TIPOS_DE_CONTATO: TaskType[] = [
  "LIGAR",
  "FOLLOW_UP",
  "REATIVAR",
  "ENVIAR_CATALOGO",
  "ENVIAR_NOVIDADES",
  "POS_VENDA",
];

/** Fim de HOJE no calendário de São Paulo (o servidor roda em UTC). */
export function fimDeHojeSP(agora = new Date()): Date {
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  // meia-noite de SP = 03:00Z; o fim de hoje é a meia-noite seguinte
  return new Date(new Date(`${dia}T03:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Conclui as tarefas de contato da cliente que estavam para hoje ou
 * atrasadas. Idempotente e barato (um updateMany indexado); tarefas com data
 * futura ficam — o compromisso de semana que vem continua de pé.
 */
export async function concluirTarefasDeContato(
  companyId: string,
  customerId: string,
  agora = new Date()
): Promise<number> {
  const r = await db.task.updateMany({
    where: {
      companyId,
      customerId,
      status: "PENDENTE",
      dueAt: { lt: fimDeHojeSP(agora) },
      OR: [
        { type: { in: TIPOS_DE_CONTATO } },
        // SÓ as tarefas automáticas DE CONTATO (lista fechada de regras):
        // "qualquer automática" concluiria também uma futura automação de
        // outra natureza — ex.: cobrança — por um simples "oi" (auditoria
        // 07/08/2026)
        ...[
          "intake:",
          "ns-checkout:",
          "sem-resposta:",
          "catalogo-parado:",
          "recompra:",
          "aniversario:",
          "reativar-perdido:",
          "primeiro-contato:",
          "pos-venda:",
        ].map((p) => ({ autoRule: { startsWith: p } })),
      ],
    },
    // o motivo aparece na agenda ("Concluída pelo sistema — você já falou com
    // a cliente") — as DUAS portas de fechamento automático explicam igual
    data: { status: "CONCLUIDA", autoDoneReason: "CLIENTE_JA_CHAMADO" },
  });
  return r.count;
}
