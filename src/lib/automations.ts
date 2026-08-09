import { db } from "./db";
import { ownedScope } from "./scope";
import type { SessionUser } from "./auth";
import type { TaskType, TaskPriority } from "@prisma/client";
import { daysSince } from "./format";
import { clientesNaHoraDeComprar, aniversariantes } from "./recompra";

export type AutomationSuggestion = {
  /** chave estável: regra + entidade — usada para não duplicar tarefas */
  key: string;
  rule: string;
  title: string;
  description: string;
  customerId: string;
  customerName: string;
  opportunityId?: string;
  taskType: TaskType;
  priority: TaskPriority;
};

/**
 * Motor de automação comercial (item 7 do produto).
 * As regras rodam sobre os dados atuais e geram sugestões de tarefa.
 * Ao "aplicar", criamos uma Task com autoRule = key (idempotente).
 */
export async function computeAutomations(
  user: SessionUser
): Promise<AutomationSuggestion[]> {
  const scope = ownedScope(user);
  const suggestions: AutomationSuggestion[] = [];
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

  // Regra 1 — cliente sem resposta há 2+ dias em conversa aguardando cliente
  const staleConvs = await db.conversation.findMany({
    where: {
      companyId: user.companyId,
      status: "WAITING_CLIENT",
      lastMessageAt: { lt: days(2) },
      ...(scope.ownerId ? { assigneeId: user.id } : {}),
    },
    include: { customer: true },
  });
  for (const c of staleConvs) {
    suggestions.push({
      key: `sem-resposta:${c.id}`,
      rule: "Cliente sem resposta há 2+ dias",
      title: `Fazer follow-up com ${c.customer.name}`,
      description: `Última mensagem ${daysSince(c.lastMessageAt)} dias atrás. Retome a conversa antes de esfriar.`,
      customerId: c.customerId,
      customerName: c.customer.name,
      taskType: "FOLLOW_UP",
      priority: "ALTA",
    });
  }

  // Regra 2 — catálogo enviado e sem avanço há 3+ dias
  const catalogOpps = await db.opportunity.findMany({
    where: {
      ...scope,
      status: "OPEN",
      stage: { name: "Catálogo enviado" },
      lastInteractionAt: { lt: days(3) },
    },
    include: { customer: true },
  });
  for (const o of catalogOpps) {
    suggestions.push({
      key: `catalogo-parado:${o.id}`,
      rule: "Recebeu catálogo e não comprou",
      title: `Retomar negociação com ${o.customer.name}`,
      description: `Catálogo enviado há ${daysSince(o.lastInteractionAt)} dias sem resposta. Pergunte o que achou das peças.`,
      customerId: o.customerId,
      customerName: o.customer.name,
      opportunityId: o.id,
      taskType: "FOLLOW_UP",
      priority: "MEDIA",
    });
  }

  // Regra 3 — PASSOU DO RITMO DELA (não é mais prazo fixo para todo mundo).
  //
  // O prazo fixo de 30 dias errava dos dois lados: a lojista que repõe a cada
  // 3 semanas era chamada tarde (a concorrente já vendeu) e a que compra de 3
  // em 3 meses era incomodada cedo — jeito mais rápido de queimar a relação.
  // Agora o ritmo sai do histórico de compras de cada uma.
  const naHora = await clientesNaHoraDeComprar(user.companyId, {
    ownerId: scope.ownerId ?? null,
  });
  if (naHora.length) {
    const semNegociacaoAberta = await db.customer.findMany({
      where: {
        ...scope,
        id: { in: naHora.map((c) => c.customerId) },
        opportunities: { none: { status: "OPEN" } },
      },
      select: { id: true, name: true },
    });
    const nomePorId = new Map(semNegociacaoAberta.map((c) => [c.id, c.name]));
    for (const c of naHora) {
      const nome = nomePorId.get(c.customerId);
      if (!nome) continue; // já tem negociação aberta: não precisa de empurrão
      suggestions.push({
        key: `recompra:${c.customerId}`,
        rule: c.ritmoProprio ? "Passou do ritmo de compra" : "Tempo sem comprar",
        title: `Oferecer novidades para ${nome}`,
        description: c.ritmoProprio
          ? `Não compra há ${c.diasSemComprar} dias e costuma comprar a cada ${c.cicloDias}. Passou da hora — mande os lançamentos.`
          : `Última compra há ${c.diasSemComprar} dias (a loja gira a cada ${c.cicloDias}). Envie os lançamentos e sugira recompra.`,
        customerId: c.customerId,
        customerName: nome,
        taskType: "ENVIAR_NOVIDADES",
        priority: c.ritmoProprio ? "ALTA" : "MEDIA",
      });
    }
  }

  // Regra 7 — ANIVERSÁRIO (hoje e nos próximos 3 dias).
  // É o disparo de maior conversão do ano numa loja de moda, e o campo nem
  // existia. Prioridade máxima: data que passou não volta.
  const fazendoAniversario = await aniversariantes(user.companyId, {
    ownerId: scope.ownerId ?? null,
    ateDias: 3,
  });
  for (const a of fazendoAniversario) {
    const quando =
      a.emQuantosDias === 0
        ? "é HOJE"
        : a.emQuantosDias === 1
          ? "é amanhã"
          : `é em ${a.emQuantosDias} dias`;
    suggestions.push({
      key: `aniversario:${a.customerId}:${new Date().getUTCFullYear()}`,
      rule: "Aniversário da cliente",
      title: `Parabenizar ${a.name}`,
      description: `O aniversário ${quando}${a.idade ? ` (${a.idade} anos)` : ""}. Mande os parabéns — e, se a loja quiser, um mimo com prazo para ela voltar.`,
      customerId: a.customerId,
      customerName: a.name,
      taskType: "LIGAR",
      priority: a.emQuantosDias === 0 ? "ALTA" : "MEDIA",
    });
  }

  // Regra 4 — negociação perdida há 30-180 dias: campanha de reativação.
  // (Antes pegava perdas dos ÚLTIMOS 60 dias — sugeria "reativar" cliente
  // que acabou de dizer não, e parava de sugerir justamente quando o tempo
  // de reaproximação chegava.)
  const lostOpps = await db.opportunity.findMany({
    where: {
      ...scope,
      status: "LOST",
      closedAt: { lt: days(30), gt: days(180) },
    },
    include: { customer: true },
  });
  for (const o of lostOpps) {
    suggestions.push({
      key: `reativar-perdido:${o.id}`,
      rule: "Negociação perdida",
      title: `Reativar ${o.customer.name}`,
      description: `Negociação "${o.title}" foi perdida${o.lostReason ? ` (${o.lostReason})` : ""}. Inclua em campanha de reativação.`,
      customerId: o.customerId,
      customerName: o.customer.name,
      opportunityId: o.id,
      taskType: "REATIVAR",
      priority: "BAIXA",
    });
  }

  // Regra 5 — cliente novo sem primeiro contato
  const newCustomers = await db.customer.findMany({
    where: {
      ...scope,
      createdAt: { gt: days(3) },
      lastContactAt: null,
      tasks: { none: {} },
    },
  });
  for (const c of newCustomers) {
    suggestions.push({
      key: `primeiro-contato:${c.id}`,
      rule: "Cliente novo",
      title: `Primeiro contato com ${c.name}`,
      description: "Lead novo sem nenhum contato registrado. Faça a primeira abordagem hoje.",
      customerId: c.id,
      customerName: c.name,
      taskType: "LIGAR",
      priority: "ALTA",
    });
  }

  // Regra 6 — pedido fechado sem pós-venda.
  //
  // SÓ DEPOIS DE 5 DIAS: pedido fechado HOJE nem saiu da loja — sugerir
  // "confirme se chegou bem" no mesmo dia não fazia sentido nenhum (a
  // lojista estranhou, com razão). A janela é 5–14 dias após o fechamento:
  // tempo de o pedido chegar, e ainda quente para pedir o feedback.
  const wonOpps = await db.opportunity.findMany({
    where: {
      ...scope,
      status: "WON",
      closedAt: { gt: days(14), lt: days(5) },
      tasks: { none: { type: "POS_VENDA" } },
    },
    include: { customer: true },
  });
  for (const o of wonOpps) {
    suggestions.push({
      key: `pos-venda:${o.id}`,
      rule: "Pedido fechado",
      title: `Pós-venda com ${o.customer.name}`,
      description: `Pedido "${o.title}" fechado. Confirme se chegou bem e peça feedback das peças.`,
      customerId: o.customerId,
      customerName: o.customer.name,
      opportunityId: o.id,
      taskType: "POS_VENDA",
      priority: "MEDIA",
    });
  }

  /**
   * SUGESTÃO JÁ APLICADA SAI DA LISTA — MAS SÓ POR UM TEMPO.
   *
   * Antes, bastava EXISTIR uma tarefa com aquela chave para a regra calar
   * PARA SEMPRE. Uma vez concluída "recompra:Maria", a Maria nunca mais era
   * lembrada — nem seis meses depois. O motor ia emudecendo sozinho, cliente
   * a cliente, e ninguém percebia porque o silêncio não aparece na tela.
   *
   * Isso ficou crítico agora que a agenda fecha tarefa sozinha (a vida
   * resolveu): sem janela, cada conclusão automática apagaria a regra de vez.
   *
   * Regra nova: some enquanto a tarefa está ABERTA e por mais 30 dias depois
   * de criada. Passou disso, se a condição continuar valendo, o sistema
   * lembra de novo. As condições de cada regra continuam mandando — esta
   * janela só evita cobrar a mesma coisa todo dia.
   */
  const JANELA_SILENCIO_MS = 30 * 24 * 60 * 60 * 1000;
  const applied = await db.task.findMany({
    where: {
      companyId: user.companyId,
      autoRule: { in: suggestions.map((s) => s.key) },
      OR: [
        { status: "PENDENTE" },
        { createdAt: { gte: new Date(Date.now() - JANELA_SILENCIO_MS) } },
      ],
    },
    select: { autoRule: true },
  });
  const appliedSet = new Set(applied.map((t) => t.autoRule));
  const vivas = suggestions.filter((s) => !appliedSet.has(s.key));

  // CONTATO FEITO HOJE ENCERRA A SUGESTÃO (pedido do dono, 05/08/2026):
  // chamou a cliente — pela Central ou pelo aplicativo (o eco registra) —
  // e a recomendação sai de TODAS as listas (Dashboard, Agenda, Automações)
  // até o dia virar. O filtro mora AQUI para nenhuma tela contar diferente.
  if (vivas.length === 0) return vivas;
  const hojeSP = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const inicioHoje = new Date(`${hojeSP}T03:00:00Z`); // meia-noite de SP
  const chamadasHoje = await db.conversation.findMany({
    where: {
      companyId: user.companyId,
      customerId: { in: [...new Set(vivas.map((s) => s.customerId))] },
      lastOutboundAt: { gte: inicioHoje },
    },
    select: { customerId: true },
  });
  const jaChamadas = new Set(chamadasHoje.map((c) => c.customerId));
  return vivas.filter((s) => !jaChamadas.has(s.customerId));
}
