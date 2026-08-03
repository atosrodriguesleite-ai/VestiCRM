import { db } from "./db";
import { PAID_ORDER_STATUSES } from "./orders";
import { inicioDoMesSP } from "./recompra-painel";
import type { SessionUser } from "./auth";

/**
 * IA DE VENDAS — Entrega 1: a fundação que funciona SEM chave de API.
 *
 * Três peças moram aqui:
 *
 * 1. O CÉREBRO — o que a loja ensina para a IA (tom de marca, roteiro,
 *    políticas). É gravado desde já: quando a IA começar a responder
 *    (Entrega 2+), ela nasce treinada.
 * 2. A TRAVA DE USO — cada loja tem um plano de conversas/mês. Bateu o teto,
 *    a IA para e o atendimento volta para as humanas. É o que garante a
 *    margem do módulo: a loja que contratou 1.000 e usou 3.000 vira conversa
 *    de upgrade, nunca prejuízo silencioso.
 * 3. O MONITOR DE EQUIPE — leitura determinística da operação por vendedora
 *    (tempo de resposta, clientes esperando, conversão). Nenhuma frase é
 *    inventada: tudo sai de conta verificável sobre dados que já existem.
 */

// ---------------------------------------------------------------------------
// Mês no calendário de São Paulo — a mesma régua das telas de dinheiro.
// ---------------------------------------------------------------------------

/** "2026-08" no fuso de SP (o servidor roda em UTC). */
export function mesSP(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(d);
}

// ---------------------------------------------------------------------------
// O cérebro (configuração da loja)
// ---------------------------------------------------------------------------

/** Configuração da IA da loja — cria com os padrões (tudo desligado) se não existir. */
export async function configDaIa(companyId: string) {
  return db.aiSettings.upsert({
    where: { companyId },
    create: { companyId },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// A trava de uso
// ---------------------------------------------------------------------------

/** Em 80% do plano o painel avisa — a loja compra upgrade ANTES de travar. */
export const ALERTA_TRAVA_PCT = 0.8;

export type EstadoDaTrava = {
  limite: number;
  usadas: number;
  restantes: number;
  /** 0..1+ (pode passar de 1 quando o mês já estourou) */
  pct: number;
  /** passou do teto: a IA NÃO pode iniciar conversa nova */
  estourou: boolean;
  /** cruzou 80%: hora de avisar e vender upgrade */
  alerta: boolean;
};

/** Conta pura da trava — separada do banco para o teste travar a regra. */
export function estadoDaTrava(limite: number, usadas: number): EstadoDaTrava {
  const teto = Math.max(limite, 0);
  const uso = Math.max(usadas, 0);
  const pct = teto > 0 ? uso / teto : 1;
  return {
    limite: teto,
    usadas: uso,
    restantes: Math.max(teto - uso, 0),
    pct,
    estourou: uso >= teto,
    alerta: pct >= ALERTA_TRAVA_PCT,
  };
}

/** Uso da IA no mês corrente (calendário de SP). */
export async function usoDoMes(companyId: string, agora = new Date()) {
  const u = await db.aiUsage.findUnique({
    where: { companyId_mes: { companyId, mes: mesSP(agora) } },
    select: { conversas: true, respostas: true, custoUsd: true },
  });
  return u ?? { conversas: 0, respostas: 0, custoUsd: 0 };
}

/**
 * O portão que as Entregas 2/3 vão consultar antes de a IA abrir a boca:
 * módulo ligado pelo Super Admin + comportamento ligado pela loja + trava.
 */
export async function travaDaIa(companyId: string, agora = new Date()) {
  const [empresa, config, uso] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { aiSalesEnabled: true } }),
    configDaIa(companyId),
    usoDoMes(companyId, agora),
  ]);
  const trava = estadoDaTrava(config.limiteConversasMes, uso.conversas);
  return {
    config,
    uso,
    trava,
    // conversa NOVA só com módulo ativo, atendente ligado e dentro do plano
    podeAtenderNova: Boolean(empresa?.aiSalesEnabled) && config.atendente && !trava.estourou,
    podeCopilot: Boolean(empresa?.aiSalesEnabled) && config.copilot,
  };
}

/**
 * Registra uso da IA no mês (chamado pelas Entregas 2/3 a cada participação).
 * Upsert com incremento: a corrida de duas mensagens simultâneas cai no
 * índice único (companyId, mes) e a segunda tentativa vira update.
 */
export async function registrarUsoDaIa(
  companyId: string,
  delta: { conversas?: number; respostas?: number; custoUsd?: number },
  agora = new Date()
) {
  const mes = mesSP(agora);
  const data = {
    conversas: { increment: delta.conversas ?? 0 },
    respostas: { increment: delta.respostas ?? 0 },
    custoUsd: { increment: delta.custoUsd ?? 0 },
  };
  try {
    await db.aiUsage.upsert({
      where: { companyId_mes: { companyId, mes } },
      create: {
        companyId,
        mes,
        conversas: delta.conversas ?? 0,
        respostas: delta.respostas ?? 0,
        custoUsd: delta.custoUsd ?? 0,
      },
      update: data,
    });
  } catch {
    // corrida no create (P2002): o registro do mês acabou de nascer — soma nele
    await db.aiUsage.update({ where: { companyId_mes: { companyId, mes } }, data });
  }
}

// ---------------------------------------------------------------------------
// Monitor de Equipe — determinístico, sobre dados que já existem
// ---------------------------------------------------------------------------

/** Resposta que demora mais de 24h não entra na média (cliente de madrugada
 *  ou de fim de semana viraria "demora" injusta na conta). */
export const TETO_RESPOSTA_MIN = 24 * 60;

export type MetricasVendedora = {
  userId: string;
  nome: string;
  color: string;
  /** conversas em que ELA respondeu no mês */
  conversas: number;
  /** mensagens que ela mandou para clientes no mês */
  respostas: number;
  /** minutos, em média, entre a fala da cliente e a resposta dela */
  mediaRespostaMin: number | null;
  /** clientes esperando resposta dela NESTE momento */
  aguardandoAgora: number;
  /** a espera mais antiga (minutos) — o incêndio a apagar primeiro */
  maiorEsperaMin: number | null;
  /** pedidos pagos no mês (régua oficial: PAID + netTotal) */
  pedidos: number;
  vendido: number;
  /** pedidos ÷ conversas atendidas (null sem conversa) */
  conversaoPct: number | null;
  tarefasAtrasadas: number;
};

export type Monitor = {
  vendedoras: MetricasVendedora[];
  /** conversas na fila (sem dona) esperando alguém assumir */
  fila: { aguardando: number; maiorEsperaMin: number | null };
};

type MsgLeve = {
  conversationId: string;
  direction: "IN" | "OUT";
  createdAt: Date;
  authorId: string | null;
};

type ConvLeve = {
  id: string;
  assigneeId: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
};

/**
 * A CONTA do monitor, pura (sem banco) — é o que o teste unitário trava.
 *
 * Regras:
 * - resposta = mensagem OUT depois de uma IN pendente na MESMA conversa; o
 *   tempo é atribuído a quem ESCREVEU (authorId; sem autor, à dona da
 *   conversa). Acima de 24h a amostra é descartada.
 * - "aguardando agora" = conversa cuja última fala é da CLIENTE.
 * - venda/conversão usam a régua oficial (pedido pago, netTotal).
 */
export function calcularMonitor(
  vendedores: { id: string; name: string; color: string }[],
  mensagens: MsgLeve[], // só kind TEXT, ordem cronológica
  conversas: ConvLeve[],
  pedidosPagos: { sellerId: string | null; netTotal: number }[],
  tarefasAtrasadas: { assigneeId: string | null }[],
  agora = new Date()
): Monitor {
  const donaDaConversa = new Map(conversas.map((c) => [c.id, c.assigneeId]));

  const porVendedora = new Map(
    vendedores.map((v) => [
      v.id,
      {
        userId: v.id,
        nome: v.name,
        color: v.color,
        conversas: new Set<string>(),
        respostas: 0,
        somaRespostaMin: 0,
        amostrasResposta: 0,
        aguardandoAgora: 0,
        maiorEsperaMin: null as number | null,
        pedidos: 0,
        vendido: 0,
        tarefasAtrasadas: 0,
      },
    ])
  );

  // ---- tempos de resposta: caminha a conversa em ordem ----
  const pendenteIn = new Map<string, Date>(); // conversationId → IN aguardando resposta
  for (const m of mensagens) {
    if (m.direction === "IN") {
      // a PRIMEIRA fala sem resposta é a que conta (a cliente que manda 5
      // mensagens seguidas não zera o cronômetro)
      if (!pendenteIn.has(m.conversationId)) pendenteIn.set(m.conversationId, m.createdAt);
      continue;
    }
    const autora = m.authorId ?? donaDaConversa.get(m.conversationId) ?? null;
    const v = autora ? porVendedora.get(autora) : undefined;
    if (v) {
      v.respostas += 1;
      v.conversas.add(m.conversationId);
    }
    const inicio = pendenteIn.get(m.conversationId);
    if (inicio) {
      pendenteIn.delete(m.conversationId);
      const min = (m.createdAt.getTime() - inicio.getTime()) / 60_000;
      if (v && min >= 0 && min <= TETO_RESPOSTA_MIN) {
        v.somaRespostaMin += min;
        v.amostrasResposta += 1;
      }
    }
  }

  // ---- quem está esperando AGORA ----
  const fila = { aguardando: 0, maiorEsperaMin: null as number | null };
  for (const c of conversas) {
    const esperando =
      c.lastInboundAt &&
      (!c.lastOutboundAt || c.lastInboundAt.getTime() > c.lastOutboundAt.getTime());
    if (!esperando || !c.lastInboundAt) continue;
    const espera = Math.floor((agora.getTime() - c.lastInboundAt.getTime()) / 60_000);
    const alvo = c.assigneeId ? porVendedora.get(c.assigneeId) : undefined;
    if (alvo) {
      alvo.aguardandoAgora += 1;
      if (alvo.maiorEsperaMin == null || espera > alvo.maiorEsperaMin)
        alvo.maiorEsperaMin = espera;
    } else if (!c.assigneeId) {
      fila.aguardando += 1;
      if (fila.maiorEsperaMin == null || espera > fila.maiorEsperaMin)
        fila.maiorEsperaMin = espera;
    }
  }

  // ---- vendas e tarefas ----
  for (const p of pedidosPagos) {
    const v = p.sellerId ? porVendedora.get(p.sellerId) : undefined;
    if (v) {
      v.pedidos += 1;
      v.vendido += p.netTotal;
    }
  }
  for (const t of tarefasAtrasadas) {
    const v = t.assigneeId ? porVendedora.get(t.assigneeId) : undefined;
    if (v) v.tarefasAtrasadas += 1;
  }

  const vendedoras = [...porVendedora.values()]
    .map((v) => ({
      userId: v.userId,
      nome: v.nome,
      color: v.color,
      conversas: v.conversas.size,
      respostas: v.respostas,
      mediaRespostaMin:
        v.amostrasResposta > 0 ? Math.round(v.somaRespostaMin / v.amostrasResposta) : null,
      aguardandoAgora: v.aguardandoAgora,
      maiorEsperaMin: v.maiorEsperaMin,
      pedidos: v.pedidos,
      vendido: v.vendido,
      conversaoPct:
        v.conversas.size > 0 ? Math.round((v.pedidos / v.conversas.size) * 100) : null,
      tarefasAtrasadas: v.tarefasAtrasadas,
    }))
    // quem vendeu mais primeiro; sem venda, quem mais conversou
    .sort((a, b) => b.vendido - a.vendido || b.conversas - a.conversas);

  return { vendedoras, fila };
}

/** Busca os dados do mês (calendário de SP) e entrega o monitor pronto. */
export async function monitorDeEquipe(user: SessionUser, agora = new Date()) {
  const companyId = user.companyId;
  const inicioMes = inicioDoMesSP(agora);

  const [vendedores, mensagens, conversas, pedidos, tarefas] = await Promise.all([
    db.user.findMany({
      where: { companyId, role: { in: ["SELLER", "MANAGER", "ADMIN"] } },
      select: { id: true, name: true, color: true },
      orderBy: { createdAt: "asc" },
    }),
    db.message.findMany({
      where: {
        conversation: { companyId },
        kind: "TEXT",
        createdAt: { gte: inicioMes },
      },
      select: { conversationId: true, direction: true, createdAt: true, authorId: true },
      orderBy: { createdAt: "asc" },
      take: 50_000,
    }),
    db.conversation.findMany({
      where: { companyId, status: { not: "CLOSED" } },
      select: { id: true, assigneeId: true, lastInboundAt: true, lastOutboundAt: true },
    }),
    db.order.findMany({
      where: {
        companyId,
        status: { in: [...PAID_ORDER_STATUSES] },
        paidAt: { gte: inicioMes },
      },
      select: { sellerId: true, netTotal: true },
    }),
    db.task.findMany({
      where: { companyId, status: "PENDENTE", dueAt: { lt: agora } },
      select: { assigneeId: true },
    }),
  ]);

  // as donas das conversas do mês entram no pareamento mesmo que a conversa
  // esteja encerrada (o tempo de resposta é histórico, não estado atual)
  const idsDoMes = [...new Set(mensagens.map((m) => m.conversationId))];
  const conhecidas = new Set(conversas.map((c) => c.id));
  const faltantes = idsDoMes.filter((id) => !conhecidas.has(id));
  const extras = faltantes.length
    ? await db.conversation.findMany({
        where: { id: { in: faltantes }, companyId },
        select: { id: true, assigneeId: true, lastInboundAt: true, lastOutboundAt: true },
      })
    : [];

  return calcularMonitor(
    vendedores,
    mensagens as MsgLeve[],
    // as encerradas entram SÓ para o pareamento de resposta: sem
    // lastInbound/lastOutbound elas nunca contam como "aguardando agora"
    [...conversas, ...extras.map((e) => ({ ...e, lastInboundAt: null, lastOutboundAt: null }))],
    pedidos,
    tarefas,
    agora
  );
}
