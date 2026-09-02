import { db } from "./db";
import { formatPhone, originLabel } from "./format";
import { consolidateOpenConversations } from "./merge-contacts";
import { Prisma } from "@prisma/client";
import type { Origin, Customer, Conversation, Opportunity, Task } from "@prisma/client";

/**
 * Lead Intake Engine — camada ÚNICA de entrada de leads (omnichannel).
 *
 * Toda integração (WhatsApp, catálogo público, Instagram, Facebook, site,
 * Nuvemshop, Bling, marketplace, cadastro manual...) DEVE passar por aqui.
 * Nenhum canal cria clientes diretamente — isso garante:
 *   • deduplicação por telefone (nenhum cliente duplicado);
 *   • conversa criada/reaproveitada;
 *   • oportunidade na etapa configurada para a origem;
 *   • tarefa de primeiro atendimento dentro do SLA;
 *   • distribuição automática (vendedor fixo ou rodízio);
 *   • evento na timeline com total rastreabilidade.
 */

export type IntakePayload = {
  phone: string;
  name?: string;
  origin: Origin;
  message?: string; // primeira mensagem recebida (vira mensagem IN na conversa)
  /**
   * RN-043: em vez de criar a mensagem, REAPROVEITA a bolha que o OUTRO
   * caminho já criou para este mesmo texto, desta cliente, há pouco — é o que
   * faz o pedido do catálogo virar UMA bolha só, e não uma por caminho. O
   * webhook pede `do-catalogo`; o catálogo pede `do-whatsapp`. Sem a opção:
   * cria sempre.
   */
  reaproveitarBolha?: BolhaAlvo;
  /**
   * RN-043: o id da mensagem no WhatsApp, quando vem do webhook. Carimbado
   * DENTRO da trava — fora dela, duas mensagens iguais em paralelo (a cliente
   * reenviando o pedido) reaproveitavam a MESMA bolha e a segunda apagava o
   * id da primeira.
   */
  externalId?: string;
  city?: string;
  state?: string;
  opportunityTitle?: string;
  value?: number;
  ownerId?: string; // força o responsável (ex.: cadastro manual pelo vendedor)
  campaignId?: string; // campanha de aquisição (módulo Marketing) — atribuição
  skipTask?: boolean;
  skipOpportunity?: boolean; // quando a oportunidade será criada manualmente em seguida
};

export type IntakeResult = {
  customer: Customer;
  conversation: Conversation | null;
  opportunity: Opportunity | null;
  task: Task | null;
  isNewLead: boolean;
  /**
   * A mensagem criada nesta entrada (null quando não veio texto). Quem chama
   * completa ela depois — mídia, id do WhatsApp, status — e precisa saber
   * EXATAMENTE qual é: procurar "a mais recente da conversa" errava o alvo
   * quando duas mensagens chegavam juntas.
   */
  message: { id: string } | null;
  /** RN-043: `message` é uma bolha que já existia (não foi criada agora) */
  mensagemReaproveitada: boolean;
};

/** Normaliza telefone para o formato de armazenamento (dígitos, com DDI 55). */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}

/**
 * Variações do MESMO número brasileiro para dedup, tolerando o "9º dígito":
 * um celular pode aparecer com 9 (55 DD 9XXXXXXXX) ou sem (55 DD XXXXXXXX) —
 * o WhatsApp costuma mandar com 9, e cadastros antigos ficam sem. Assim a
 * mesma pessoa não vira dois contatos/duas conversas.
 */
import { nomeProvisorio } from "./nome-provisorio";
import { escolherBolha, JANELA_DA_BOLHA_MS, type BolhaAlvo } from "./comm/bolha-do-pedido";
export { nomeProvisorio };

export function phoneMatchVariants(raw: string): string[] {
  const d = normalizePhone(raw);
  const set = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const sub = d.slice(4); // parte após DDI+DDD
    const subs = new Set<string>([sub]);
    if (sub.length === 9 && sub.startsWith("9")) subs.add(sub.slice(1)); // tira o 9
    if (sub.length === 8) subs.add(`9${sub}`); // põe o 9
    for (const s of subs) {
      set.add(`55${ddd}${s}`);
      set.add(`${ddd}${s}`); // cadastros legados salvos SEM o DDI 55
    }
  }
  return [...set];
}

/**
 * Encontra o cliente pelo telefone tolerando TODAS as formas já vistas em
 * produção: com/sem 9º dígito, com/sem DDI 55 e cadastros antigos salvos COM
 * formatação ("(73) 99134-7878"). Primeiro o caminho rápido (igualdade exata,
 * usa índice); se não achar, compara só os DÍGITOS direto no banco — telefone
 * formatado no cadastro era o furo que fazia a mesma pessoa virar dois
 * contatos e a conversa nascer duplicada, sem histórico.
 */
/** A conversa em curso da cliente: a aberta (ou aguardando) mais recente. */
async function conversaAtualDe(companyId: string, customerId: string) {
  return db.conversation.findFirst({
    where: { companyId, customerId, status: { not: "CLOSED" } },
    orderBy: { lastMessageAt: "desc" },
  });
}

export async function findCustomerByPhone(
  companyId: string,
  raw: string
): Promise<Customer | null> {
  const variants = phoneMatchVariants(raw);
  const direto = await db.customer.findFirst({
    where: { companyId, phone: { in: variants } },
    orderBy: { createdAt: "asc" },
  });
  if (direto) return direto;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer"
    WHERE "companyId" = ${companyId}
      AND regexp_replace(phone, '[^0-9]', '', 'g') IN (${Prisma.join(variants)})
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  if (!rows.length) return null;
  return db.customer.findUnique({ where: { id: rows[0].id } });
}

/** Rodízio: próximo vendedor ativo depois do último que recebeu lead. */
export function pickRoundRobin<T extends { id: string }>(
  sellers: T[],
  lastId: string | null
): T | null {
  if (sellers.length === 0) return null;
  const idx = sellers.findIndex((s) => s.id === lastId);
  return sellers[(idx + 1) % sellers.length];
}

async function resolveOwner(companyId: string, forced?: string) {
  if (forced) return forced;
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return null;

  if (company.intakeDistribution === "FIXED" && company.intakeDefaultUserId) {
    const fixed = await db.user.findFirst({
      where: { id: company.intakeDefaultUserId, companyId, active: true },
    });
    if (fixed) return fixed.id;
  }

  const sellers = await db.user.findMany({
    where: { companyId, active: true, role: "SELLER" },
    orderBy: { createdAt: "asc" },
  });
  const pool = sellers.length
    ? sellers
    : await db.user.findMany({
        where: { companyId, active: true, role: { not: "SUPERADMIN" } },
        orderBy: { createdAt: "asc" },
      });
  const next = pickRoundRobin(pool, company.intakeLastUserId);
  if (next) {
    await db.company.update({
      where: { id: companyId },
      data: { intakeLastUserId: next.id },
    });
  }
  return next?.id ?? null;
}

async function resolveStage(companyId: string, origin: Origin) {
  const rule = await db.originRule.findUnique({
    where: { companyId_origin: { companyId, origin } },
    include: { stage: true },
  });
  if (rule?.stage) return rule.stage;
  return db.stage.findFirst({
    where: { pipeline: { companyId } },
    orderBy: { order: "asc" },
  });
}

export async function intakeLead(
  companyId: string,
  payload: IntakePayload
): Promise<IntakeResult> {
  const phone = normalizePhone(payload.phone);
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error("Empresa não encontrada");

  // dedup tolerante a 9º dígito, DDI e formatação — evita cliente/conversa duplicados
  const existing = await findCustomerByPhone(companyId, payload.phone);

  const channelLabel = originLabel[payload.origin];
  let customer: Customer;
  let isNewLead = false;

  if (existing) {
    // ---- Cliente já existe: reutiliza cadastro e registra a interação ----
    customer = await db.customer.update({
      where: { id: existing.id },
      data: {
        lastContactAt: new Date(),
        // NOME DE VERDADE SUBSTITUI O PROVISÓRIO — e só ele.
        //
        // Antes a condição era `!existing.name`, que NUNCA é verdade: o nome
        // do cliente é obrigatório no banco, então sempre tem alguma coisa
        // escrita. Resultado: o nome que a cliente digitava no catálogo era
        // jogado fora em silêncio.
        //
        // Foi o que aconteceu no pedido #0146 da Entre Linhas: a mensagem do
        // WhatsApp chegou primeiro e criou a cliente como "Contato (77)
        // 8101-4696"; quando o pedido do catálogo chegou com o nome digitado,
        // ele foi ignorado e o painel ficou com o telefone no lugar do nome.
        //
        // Agora: nome digitado por gente NUNCA é sobrescrito; só o apelido que
        // o próprio sistema inventou é que dá lugar ao nome de verdade.
        ...(payload.name?.trim() && nomeProvisorio(existing.name)
          ? { name: payload.name.trim() }
          : {}),
        // atribuição "primeiro contato": só grava a campanha se ainda não há
        ...(payload.campaignId && !existing.campaignId
          ? { campaignId: payload.campaignId }
          : {}),
      },
    });
    await db.customerEvent.create({
      data: {
        companyId,
        customerId: customer.id,
        type: "NOVA_INTERACAO",
        channel: payload.origin,
        description: `Nova interação via ${channelLabel}`,
      },
    });
  } else {
    // ---- Lead novo: cria com origem e responsável distribuído ----
    isNewLead = true;
    const ownerId = await resolveOwner(companyId, payload.ownerId);
    try {
      customer = await db.customer.create({
        data: {
          companyId,
          // CRACHÁ PROVISÓRIO COM O NÚMERO INTEIRO.
          //
          // Antes era "Lead 9621" (só os 4 últimos dígitos). Na tela isso parece
          // erro do sistema — a lojista da Toque Leve estranhou —, não diz de
          // quem é a conversa e ainda embaralha duas clientes de DDDs
          // diferentes que terminem igual. "Contato (82) 9664-9621" identifica
          // a pessoa na hora e continua sendo provisório (`nomeProvisorio`):
          // some sozinho quando o nome de verdade aparecer.
          name: payload.name?.trim() || `Contato ${formatPhone(phone)}`,
          phone,
          city: payload.city,
          state: payload.state,
          origin: payload.origin,
          campaignId: payload.campaignId ?? null,
          ownerId,
          lastContactAt: payload.message ? new Date() : null,
        },
      });
    } catch (e) {
      // CORRIDA (incidente #0146): WhatsApp e catálogo chegando no MESMO
      // instante passavam os dois pela busca lá de cima e criavam a mesma
      // cliente duas vezes. Com o índice único de telefone, o segundo cai
      // aqui (P2002) — e em vez de estourar, RE-BUSCA e segue com o cadastro
      // que o primeiro criou (auditoria 07/08/2026).
      const corrida =
        typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
      if (!corrida) throw e;
      const criadoPeloOutro = await findCustomerByPhone(companyId, payload.phone);
      if (!criadoPeloOutro) throw e;
      isNewLead = false;
      customer = await db.customer.update({
        where: { id: criadoPeloOutro.id },
        data: {
          lastContactAt: new Date(),
          ...(payload.name?.trim() && nomeProvisorio(criadoPeloOutro.name)
            ? { name: payload.name.trim() }
            : {}),
        },
      });
    }
    // na corrida (isNewLead virou false ali em cima), o LEAD_CRIADO fica por
    // conta de quem ganhou — este caminho registra só uma nova interação
    await db.customerEvent.create({
      data: {
        companyId,
        customerId: customer.id,
        type: isNewLead ? "LEAD_CRIADO" : "NOVA_INTERACAO",
        channel: payload.origin,
        description: isNewLead
          ? payload.origin === "MANUAL"
            ? "Lead criado manualmente"
            : `Lead criado via ${channelLabel}`
          : `Nova interação via ${channelLabel}`,
      },
    });
  }

  // ---- Conversa: reutiliza a aberta ou cria uma nova ----
  // antes, junta eventuais conversas abertas duplicadas deste cliente numa só
  // (auto-cura: a mesma pessoa nunca mostra dois chats abertos na fila)
  await consolidateOpenConversations(companyId, customer.id);
  let conversation = await conversaAtualDe(companyId, customer.id);
  // HISTÓRICO É SAGRADO: cliente que volta depois de um atendimento
  // encerrado REABRE a mesma conversa (com todo o histórico) e cai na fila.
  // Antes nascia um chat NOVO vazio e o histórico ficava "escondido" na
  // conversa encerrada — parecia que a conversa tinha sumido.
  if (!conversation && (payload.message || isNewLead)) {
    const encerrada = await db.conversation.findFirst({
      where: { companyId, customerId: customer.id, status: "CLOSED" },
      orderBy: { lastMessageAt: "desc" },
    });
    if (encerrada) {
      conversation = await db.conversation.update({
        where: { id: encerrada.id },
        data: { status: "OPEN", assigneeId: payload.ownerId ?? null },
      });
    }
  }
  if (!conversation && (payload.message || isNewLead)) {
    // Central de Atendimento (modelo Digisac): o chamado NÃO nasce com dono —
    // entra na FILA do setor (assigneeId null) para um vendedor "assumir".
    // O dono do CLIENTE (customer.ownerId) continua existindo para o CRM;
    // quem atende ESTA conversa é decidido na fila. Se o próprio vendedor
    // criou o lead manualmente (payload.ownerId), já assume o atendimento.
    conversation = await db.conversation.create({
      data: {
        companyId,
        customerId: customer.id,
        assigneeId: payload.ownerId ?? null,
        status: "OPEN",
      },
    });
  }
  // Guarda QUAL mensagem foi criada. Quem chama precisa completá-la depois
  // (mídia, id do WhatsApp, status) e, sem esta referência, tinha que
  // adivinhar pegando "a mensagem IN mais recente da conversa" — com duas
  // mensagens chegando no mesmo instante, a foto de uma colava na outra.
  let message: { id: string } | null = null;
  let mensagemReaproveitada = false;
  if (conversation && payload.message) {
    const conversaAtual = conversation;
    const texto = payload.message;
    const alvo = payload.reaproveitarBolha;
    const resultado = await db.$transaction(async (tx) => {
      if (alvo) {
        // TRAVA POR CLIENTE (RN-043): o catálogo grava o pedido e o navegador
        // abre o wa.me no MESMO instante — os dois caminhos chegam juntos. A
        // conferência da gêmea e a criação ficam na mesma transação, e a
        // trava faz o segundo a chegar ENXERGAR a bolha do primeiro. Sem ela
        // (conferência separada da criação, em cada caminho), o duplicado
        // voltava de vez em quando — achado da revisão de 01/09/2026.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customer.id}))`;
        // A MENSAGEM DO WHATSAPP SÓ É DESTE PEDIDO SE CHEGOU DEPOIS DO ÚLTIMO
        // PEDIDO DELA. O catálogo chama o intake ANTES de criar o pedido, então
        // "o último pedido" aqui é sempre o anterior: a mensagem que já foi a
        // bolha dele não serve para o que está nascendo. Sem isto, a cliente
        // que repetisse o mesmo pedido minutos depois — sem apertar enviar —
        // reaproveitava a mensagem do pedido anterior e o segundo pedido não
        // aparecia no chat (reprodução ponta a ponta, 01/09/2026).
        const ultimoPedido =
          alvo === "do-whatsapp"
            ? await tx.order.findFirst({
                where: { companyId, customerId: customer.id },
                orderBy: { createdAt: "desc" },
                select: { createdAt: true },
              })
            : null;
        const candidatas = await tx.message.findMany({
          where: {
            conversation: { companyId, customerId: customer.id },
            direction: "IN",
            kind: "TEXT",
            mediaType: "TEXT",
            revoked: false,
            // a JANELA é o recorte, não um "últimas N": conversa animada
            // depois do pedido empurrava a bolha para fora de um teto fixo
            createdAt: {
              gte: new Date(Date.now() - JANELA_DA_BOLHA_MS),
              ...(ultimoPedido ? { gt: ultimoPedido.createdAt } : {}),
            },
            // filtrar pelo alvo aqui faz a lista chegar quase sempre vazia,
            // em vez de carregar a conversa inteira da janela para o JS
            // descartar (o webhook quer bolha SEM id; o catálogo, COM id)
            externalId: alvo === "do-catalogo" ? null : { not: null },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, body: true, externalId: true, conversationId: true },
        });
        const gemea = escolherBolha(candidatas, texto, alvo);
        if (gemea) {
          // o id do WhatsApp entra AQUI, sob a trava: a segunda mensagem igual
          // que chegar em paralelo já encontra a bolha com id e cria a dela
          if (payload.externalId) {
            await tx.message.update({
              where: { id: gemea.id },
              data: { externalId: payload.externalId },
            });
          }
          // a gêmea já contou como não lida e já tocou lastMessageAt: nada a
          // somar. Mas a conversa DELA precisa reagir como a qualquer
          // mensagem que chega — voltar a OPEN se estava encerrada ou
          // aguardando a cliente; senão a mensagem de verdade ficava
          // invisível na fila (achado da revisão de 01/09/2026). E ela pode
          // morar em OUTRA conversa desta cliente (cliente nova com os dois
          // caminhos chegando juntos cria duas conversas): quem chama carimba
          // lastInboundAt, canal e setor na conversa da BOLHA, não numa vazia.
          // updateMany, nunca update: o consolidate do OUTRO caminho (ele
          // roda antes da trava) pode ter acabado de fundir e apagar esta
          // conversa — um P2025 aqui abortaria o intake inteiro e a
          // mensagem da cliente se perderia (revisão de 01/09/2026). A
          // conversa que sobreviveu é relida logo abaixo.
          await tx.conversation.updateMany({
            where: { id: gemea.conversationId, companyId },
            data: { status: "OPEN" },
          });
          return {
            message: { id: gemea.id },
            conversation: null,
            reaproveitada: true,
          };
        }
      }
      const criada = await tx.message.create({
        data: {
          conversationId: conversaAtual.id,
          direction: "IN",
          body: texto,
          ...(payload.externalId ? { externalId: payload.externalId } : {}),
        },
        select: { id: true },
      });
      const tocada = await tx.conversation.update({
        where: { id: conversaAtual.id },
        data: {
          lastMessageAt: new Date(),
          unreadCount: { increment: 1 },
          status: "OPEN",
        },
      });
      return { message: criada, conversation: tocada, reaproveitada: false };
    }, {
      // MESMOS tempos das outras transações do repo. Os padrões do Prisma
      // (2s/5s) num Neon lento ou numa rajada de webhooks estouravam P2028 —
      // e falha AQUI é mensagem da cliente perdida para sempre: o webhook
      // responde 200 e o WhatsApp não reenvia (revisão de 01/09/2026).
      maxWait: 10_000,
      timeout: 20_000,
    });
    message = resultado.message;
    mensagemReaproveitada = resultado.reaproveitada;
    if (resultado.reaproveitada) {
      // A CORRIDA DEIXAVA UMA CONVERSA VAZIA: com os dois caminhos chegando
      // juntos para cliente nova, cada um criou a sua conversa; a bolha ficou
      // numa e a outra sobrava ABERTA e vazia na fila até o próximo contato.
      // Junta agora (é o mesmo consolidate de sempre, que move o que houver
      // e apaga a que sobrou) e segue com a que sobreviveu — é nela que quem
      // chama carimba lastInboundAt, canal e setor.
      await consolidateOpenConversations(companyId, customer.id);
      conversation = (await conversaAtualDe(companyId, customer.id)) ?? conversation;
    } else {
      conversation = resultado.conversation;
    }
  }

  // ---- Oportunidade conforme a política da empresa ----
  let opportunity: Opportunity | null = null;
  const policy = company.intakeOppPolicy;
  const hasOpen = await db.opportunity.findFirst({
    where: { companyId, customerId: customer.id, status: "OPEN" },
  });
  const shouldCreateOpp =
    !payload.skipOpportunity &&
    (policy === "SEMPRE" || (policy === "SE_NAO_HOUVER_ABERTA" && !hasOpen));
  if (shouldCreateOpp) {
    const stage = await resolveStage(companyId, payload.origin);
    if (stage) {
      opportunity = await db.opportunity.create({
        data: {
          companyId,
          customerId: customer.id,
          stageId: stage.id,
          title:
            payload.opportunityTitle ??
            `Novo contato via ${channelLabel}`,
          value: payload.value ?? 0,
          ownerId: customer.ownerId,
          status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        },
      });
      await db.customerEvent.create({
        data: {
          companyId,
          customerId: customer.id,
          type: "OPORTUNIDADE",
          channel: payload.origin,
          description: `Oportunidade criada na etapa "${stage.name}"`,
        },
      });
    }
  }

  // ---- Tarefa de primeiro atendimento dentro do SLA ----
  let task: Task | null = null;
  if (isNewLead && !payload.skipTask) {
    task = await db.task.create({
      data: {
        companyId,
        customerId: customer.id,
        opportunityId: opportunity?.id,
        title: `Primeiro atendimento — ${customer.name}`,
        type: "LIGAR",
        priority: "ALTA",
        dueAt: new Date(Date.now() + company.intakeSlaMinutes * 60 * 1000),
        assigneeId: customer.ownerId,
        autoRule: `intake:${customer.id}`,
      },
    });
  }

  return { customer, conversation, opportunity, task, isNewLead, message, mensagemReaproveitada };
}
