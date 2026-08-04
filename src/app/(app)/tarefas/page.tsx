import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { taskScope, ownedScope } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { computeAutomations } from "@/lib/automations";
import {
  montarMensagem,
  tipoDaRegra,
  CAMPO_DA_CHAMADA,
  type TipoChamada,
} from "@/lib/mensagens-chamada";
import { TaskBoard, type TaskItem, type SugestaoItem } from "./task-board";
import type { TaskType } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Quando a tarefa não veio de automação, o tipo dela é a melhor pista do que
 * a vendedora vai falar — assim o botão "Chamar no WhatsApp" nunca abre a
 * conversa em branco.
 */
const TIPO_POR_TAREFA: Record<TaskType, TipoChamada> = {
  LIGAR: "PARADA",
  ENVIAR_CATALOGO: "PARADA",
  COBRAR_PAGAMENTO: "PARADA",
  POS_VENDA: "POS_VENDA",
  REATIVAR: "RECOMPRA",
  ENVIAR_NOVIDADES: "RECOMPRA",
  CONFIRMAR_ENTREGA: "POS_VENDA",
  FOLLOW_UP: "PARADA",
  OUTRO: "PARADA",
};

export default async function TasksPage() {
  const user = await requireUser();

  const [tasks, customers, team, sugestoes, textos] = await Promise.all([
    db.task.findMany({
      where: taskScope(user),
      include: { customer: true, assignee: true },
      orderBy: { dueAt: "asc" },
    }),
    db.customer.findMany({
      where: ownedScope(user),
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { companyId: user.companyId, active: true },
      select: { id: true, name: true, color: true },
    }),
    // A AGENDA E AS TAREFAS SÃO A MESMA COISA. Antes, as sugestões do motor
    // viviam numa tela separada (/automacoes) que ninguém abria, e esta aqui
    // só mostrava o que alguém tinha digitado à mão. Duas listas competindo
    // pelo mesmo trabalho — nenhuma vencia.
    computeAutomations(user),
    db.commSettings.findUnique({
      where: { companyId: user.companyId },
      select: {
        msgAniversario: true,
        msgRecompra: true,
        msgPosVenda: true,
        msgPrimeiroContato: true,
        msgConversaParada: true,
      },
    }),
  ]);

  const textoDe = (tipo: TipoChamada, nome: string) =>
    montarMensagem(
      tipo,
      { nome: nome.split(" ")[0] },
      textos ? (textos as Record<string, string | null>)[CAMPO_DA_CHAMADA[tipo]] : null
    );

  // telefone de todo mundo que aparece na tela (tarefas + sugestões)
  const idsNaTela = [
    ...new Set([
      ...tasks.map((t) => t.customerId).filter((v): v is string => !!v),
      ...sugestoes.map((s) => s.customerId),
    ]),
  ];
  const fichas = idsNaTela.length
    ? await db.customer.findMany({
        where: { companyId: user.companyId, id: { in: idsNaTela } },
        select: { id: true, phone: true },
      })
    : [];
  const telefoneDe = new Map(fichas.map((f) => [f.id, f.phone]));

  const items: TaskItem[] = tasks.map((t) => {
    const tipo = t.autoRule
      ? tipoDaRegra(t.autoRule.split(":")[0])
      : TIPO_POR_TAREFA[t.type];
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type,
      dueAt: t.dueAt.toISOString(),
      priority: t.priority,
      status: t.status,
      autoRule: t.autoRule,
      customer: t.customer
        ? {
            id: t.customer.id,
            name: t.customer.name,
            phone: telefoneDe.get(t.customer.id) ?? "",
            mensagem: textoDe(tipo, t.customer.name),
          }
        : null,
      assignee: t.assignee
        ? { name: t.assignee.name, color: t.assignee.color }
        : null,
    };
  });

  // SUGESTÃO CUMPRIDA SOME SOZINHA (pedido do dono, 04/08/2026): quem já
  // recebeu mensagem da loja HOJE sai da lista — a vendedora conversou, a
  // Agenda não pode continuar cobrando o mesmo contato no mesmo dia.
  const hojeSP = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const inicioHoje = new Date(`${hojeSP}T03:00:00Z`); // meia-noite de SP
  const chamadasHoje = sugestoes.length
    ? await db.conversation.findMany({
        where: {
          companyId: user.companyId,
          customerId: { in: sugestoes.map((s) => s.customerId) },
          lastOutboundAt: { gte: inicioHoje },
        },
        select: { customerId: true },
      })
    : [];
  const jaChamadas = new Set(chamadasHoje.map((c) => c.customerId));

  const sugestoesItens: SugestaoItem[] = sugestoes
    .filter((s) => !jaChamadas.has(s.customerId))
    .map((s) => {
      const tipo = tipoDaRegra(s.key.split(":")[0]);
      return {
        key: s.key,
        rule: s.rule,
        title: s.title,
        description: s.description,
        customerId: s.customerId,
        customerName: s.customerName,
        phone: telefoneDe.get(s.customerId) ?? "",
        mensagem: textoDe(tipo, s.customerName),
      };
    });

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Minha agenda"
        subtitle="Quem precisa de contato hoje — e o que já ficou combinado."
      />
      <TaskBoard
        initialTasks={items}
        sugestoes={sugestoesItens}
        customers={customers}
        team={team}
      />
    </div>
  );
}
