/**
 * CLICAR E CAVAR (RN-086): todo número do BI leva à LISTA de quem está por
 * trás dele. "12 sem resposta" não serve para nada se o dono não consegue
 * ver QUEM são as doze — é a diferença entre relatório e BI.
 *
 * A régua de cada lista é a MESMA do número que a abriu:
 * - esperando agora: a última fala é da cliente, conversa não encerrada
 *   (a SQL do painel, RN-082);
 * - sem resposta no período: as esperas abertas, pareadas pelo MESMO motor
 *   dos fatos (`parearEsperas`, RN-080), que começaram no período — por
 *   vendedora, as das conversas que ela assumiu (RN-083);
 * - contatos novos: cadastrados no período — por carteira (RN-083) ou por
 *   campanha de anúncio (RN-085);
 * - vendas: pedidos pagos pela data do pagamento, `netTotal`
 *   (RN-001/RN-002) — por vendedora (RN-005) ou por cliente da campanha;
 * - carteira: a célula da matriz R × F (RN-084), pela mesma lista da Recompra.
 *
 * Toda lista é recortada pela loja (RN-013), tem teto e DIZ quando cortou.
 * O caminho de cada linha é o de sempre: a conversa (`/whatsapp?conv=`), a
 * ficha da cliente, a ficha do pedido.
 *
 * LIMITE DITO NA TELA: o número do BI vem dos fatos do dia (o passado
 * congela, RN-082); a lista é de AGORA. O que mudou depois de o dia
 * congelar (a espera respondida ontem, o pedido cancelado hoje) está no
 * número e não na lista — e a página diz isso, em vez de fingir que batem.
 */
import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { SessionUser } from "../auth";
import { PAID_ORDER_STATUSES } from "../orders";
import { dataDoDia, diaSP } from "../dia";
import { brl, originLabel } from "../format";
import { dadosDaAbaRecompra } from "../recompra";
import { r2 } from "../tracking/insights-puro";
import { lerHorarioComercial, minutosDeAtendimentoEntre } from "./horario-comercial";
import { parearEsperas, type MensagemLeve } from "./tempo-de-resposta";
import { DIAS_DE_LEITURA_ANTES, inicioDoDiaSP } from "./fatos";
import { encaixarPeriodo, type Periodo } from "./painel";
import { FAIXAS, FREQUENCIAS, frequenciaDe, type Faixa, type Frequencia } from "./carteira";
import { ABAS_DO_BI, type AbaDoBi } from "./abas";

export const TIPOS_DE_LISTA = ["esperando-agora", "sem-resposta", "contatos", "vendas", "carteira"] as const;
export type TipoDeLista = (typeof TIPOS_DE_LISTA)[number];

export type FiltroDaLista = {
  tipo: TipoDeLista;
  de?: string;
  ate?: string;
  vendedora?: string;
  campanha?: string;
  faixa?: Faixa;
  freq?: Frequencia;
  /** a aba de onde a pessoa veio (o "voltar") */
  aba?: AbaDoBi;
};

/** teto de linhas por lista — acima disso a tela diz que cortou */
export const TETO_DA_LISTA = 300;

/** o endereço de uma lista (puro) — é o que os números do BI usam como link */
export function hrefDaLista(f: FiltroDaLista): string {
  const params = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return `/bi/lista?${params.join("&")}`;
}

/**
 * Lê os parâmetros da URL: tipo fora da lista, dia que não existe, faixa
 * torta ou parâmetro REPETIDO (`?de=a&de=b` chega como lista, e cairia num
 * `.trim()` ou num `sellerId: [...]` — achado da revisão) são recusados (puro).
 */
export function lerFiltro(bruto: Record<string, string | string[] | undefined>): FiltroDaLista | null {
  if (Object.values(bruto).some((v) => Array.isArray(v))) return null;
  const p = bruto as Record<string, string | undefined>;
  if (!TIPOS_DE_LISTA.includes(p.tipo as TipoDeLista)) return null;
  const f: FiltroDaLista = { tipo: p.tipo as TipoDeLista };
  if (p.de) {
    if (!dataDoDia(p.de)) return null;
    f.de = p.de;
  }
  if (p.ate) {
    if (!dataDoDia(p.ate)) return null;
    f.ate = p.ate;
  }
  if (p.vendedora) f.vendedora = p.vendedora.slice(0, 64);
  if (p.campanha) f.campanha = p.campanha.slice(0, 64);
  if (p.faixa) {
    if (!FAIXAS.some((x) => x.id === p.faixa)) return null;
    f.faixa = p.faixa as Faixa;
  }
  if (p.freq) {
    if (!FREQUENCIAS.some((x) => x.id === p.freq)) return null;
    f.freq = p.freq as Frequencia;
  }
  if (p.aba && ABAS_DO_BI.includes(p.aba as AbaDoBi)) f.aba = p.aba as AbaDoBi;
  return f;
}

export type LinhaDaLista = {
  id: string;
  titulo: string;
  subtitulo?: string;
  /** o que aparece à direita (um valor, um tempo) */
  destaque?: string;
  href: string;
  tom?: "neutro" | "warn" | "bad";
};

export type Lista = {
  titulo: string;
  descricao: string;
  linhas: LinhaDaLista[];
  /** quantas havia antes do teto (igual a linhas.length quando não cortou) */
  total: number;
  cortou: boolean;
  periodo: Periodo | null;
};

const PAGOS = [...PAID_ORDER_STATUSES];
const DIA_MS = 86_400_000;
/** teto de ids por consulta IN (o Postgres aceita 32.767 parâmetros) */
const LOTE_DE_IDS = 5_000;
/** teto de conversas esperando lidas de uma vez para a lista "sem resposta" */
const TETO_DE_CONVERSAS = 2_000;

const quando = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(d);
const minutos = (m: number) => (m < 60 ? `${Math.round(m)} min` : m < 60 * 24 ? `${(m / 60).toFixed(1).replace(".", ",")} h` : `${Math.round(m / 60 / 24)} d`);

/** o período do filtro, encaixado no teto (nulo quando a lista não tem período) */
function periodoDe(f: FiltroDaLista, agora: Date): Periodo | null {
  if (!f.de && !f.ate) return null;
  const hoje = diaSP(agora);
  return encaixarPeriodo({ de: f.de ?? f.ate ?? hoje, ate: f.ate ?? hoje });
}

function cortar<T>(lista: T[]): { linhas: T[]; total: number; cortou: boolean } {
  return { linhas: lista.slice(0, TETO_DA_LISTA), total: lista.length, cortou: lista.length > TETO_DA_LISTA };
}

export async function montarLista(user: SessionUser, f: FiltroDaLista, agora = new Date()): Promise<Lista> {
  const companyId = user.companyId;
  const periodo = periodoDe(f, agora);
  const inicio = periodo ? inicioDoDiaSP(periodo.de) : null;
  const fim = periodo ? new Date(inicioDoDiaSP(periodo.ate).getTime() + DIA_MS) : null;
  const nomeDaPessoa = async (id?: string) =>
    id ? (await db.user.findFirst({ where: { id, companyId }, select: { name: true } }))?.name ?? null : null;

  if (f.tipo === "esperando-agora") {
    // a MESMA cláusula do "esperando agora" do painel (RN-082), com quem é e
    // DESDE QUANDO: a espera começa na PRIMEIRA mensagem da cliente sem
    // resposta (RN-080), não na última — a cliente que insiste "oi?" não
    // parece recém-chegada (achado da revisão)
    const cru = await db.$queryRaw<{ id: string; customerId: string; assigneeId: string | null; desde: Date }[]>`
      SELECT c."id", c."customerId", c."assigneeId", MIN(m."createdAt") AS "desde"
      FROM "Conversation" c
      JOIN "Message" m ON m."conversationId" = c."id"
      WHERE c."companyId" = ${companyId}
        AND c."status" <> 'CLOSED'
        AND c."lastInboundAt" IS NOT NULL
        AND c."lastInboundAt" > COALESCE(c."lastOutboundAt", '-infinity'::timestamp)
        AND m."direction" = 'IN'
        AND m."createdAt" > COALESCE(c."lastOutboundAt", '-infinity'::timestamp)
      GROUP BY c."id"
      ORDER BY "desde" ASC
      LIMIT ${TETO_DA_LISTA + 1}
    `;
    const [clientes, pessoas, company] = await Promise.all([
      db.customer.findMany({ where: { companyId, id: { in: cru.map((c) => c.customerId) } }, select: { id: true, name: true } }),
      db.user.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.company.findUnique({ where: { id: companyId }, select: { horarioComercial: true, intakeSlaMinutes: true } }),
    ]);
    const nome = new Map(clientes.map((c) => [c.id, c.name]));
    const pessoa = new Map(pessoas.map((p) => [p.id, p.name]));
    const horario = lerHorarioComercial(company?.horarioComercial ?? null);
    const prazo = company?.intakeSlaMinutes ?? 60;
    const { linhas, total, cortou } = cortar(cru);
    return {
      titulo: "Esperando resposta agora",
      descricao: `Clientes cuja última mensagem ainda não teve resposta da loja, da espera mais antiga para a mais nova. O tempo é em minutos com a loja aberta; vermelho passou do prazo de ${prazo} min.`,
      linhas: linhas.map((c) => {
        const espera = minutosDeAtendimentoEntre(c.desde, agora, horario);
        return {
          id: c.id,
          titulo: nome.get(c.customerId) ?? "Cliente",
          subtitulo: `escreveu ${quando(c.desde)} · ${c.assigneeId ? `com ${pessoa.get(c.assigneeId) ?? "alguém"}` : "na fila"}`,
          destaque: minutos(espera),
          href: `/whatsapp?conv=${c.id}`,
          tom: espera > prazo ? "bad" : "warn",
        };
      }),
      total,
      cortou,
      periodo: null,
    };
  }

  if (f.tipo === "sem-resposta") {
    if (!periodo || !inicio || !fim) return vazia("Sem resposta", "Escolha um período.");
    const company = await db.company.findUnique({ where: { id: companyId }, select: { horarioComercial: true, intakeSlaMinutes: true } });
    // Uma espera ainda ABERTA mora numa conversa que está esperando AGORA
    // (a última fala é da cliente, conversa não encerrada): então a leitura
    // é só das mensagens DESSAS conversas, não da loja inteira — era a
    // consulta mais pesada do app a cada clique (achado da revisão). A
    // janela e o motor são os dos fatos (RN-082): 7 dias antes do período,
    // `parearEsperas`, e só a espera que COMEÇOU no período.
    const esperando = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Conversation"
      WHERE "companyId" = ${companyId}
        AND "status" <> 'CLOSED'
        AND "lastInboundAt" IS NOT NULL
        AND "lastInboundAt" > COALESCE("lastOutboundAt", '-infinity'::timestamp)
        ${f.vendedora ? Prisma.sql`AND "assigneeId" = ${f.vendedora}` : Prisma.empty}
      ORDER BY "lastInboundAt" ASC
      LIMIT ${TETO_DE_CONVERSAS + 1}
    `;
    const cortouConversas = esperando.length > TETO_DE_CONVERSAS;
    const ids = esperando.slice(0, TETO_DE_CONVERSAS).map((c) => c.id);
    const desde = new Date(inicio.getTime() - DIAS_DE_LEITURA_ANTES * DIA_MS);
    const mensagens: MensagemLeve[] = [];
    const conversas: { id: string; customerId: string; assigneeId: string | null; customer: { name: string }; assignee: { name: string } | null }[] = [];
    for (let i = 0; i < ids.length; i += LOTE_DE_IDS) {
      const lote = ids.slice(i, i + LOTE_DE_IDS);
      const [m, c] = await Promise.all([
        db.message.findMany({
          where: { conversationId: { in: lote }, createdAt: { gte: desde } },
          select: { conversationId: true, direction: true, kind: true, createdAt: true, authorId: true, automatica: true },
          orderBy: { createdAt: "asc" },
        }),
        db.conversation.findMany({
          where: { id: { in: lote }, companyId },
          select: { id: true, customerId: true, assigneeId: true, customer: { select: { name: true } }, assignee: { select: { name: true } } },
        }),
      ]);
      mensagens.push(...(m as MensagemLeve[]));
      conversas.push(...c);
    }
    const porId = new Map(conversas.map((c) => [c.id, c]));
    const esperas = parearEsperas(mensagens, {
      horario: lerHorarioComercial(company?.horarioComercial ?? null),
      prazoMin: company?.intakeSlaMinutes ?? 60,
      agora,
    }).filter((e) => !e.respostaEm && e.chegadaEm >= inicio && e.chegadaEm < fim);
    const pessoa = await nomeDaPessoa(f.vendedora);
    const { linhas, total, cortou } = cortar(esperas);
    return {
      titulo: pessoa ? `Sem resposta · conversas de ${pessoa}` : "Sem resposta no período",
      descricao: `Clientes que escreveram no período e ninguém da loja respondeu até agora (mensagem automática não conta).${
        cortouConversas ? " Há mais conversas esperando do que a lista consegue ler de uma vez: encurte o período." : ""
      }`,
      linhas: linhas.map((e) => {
        const c = porId.get(e.conversationId);
        return {
          id: e.conversationId,
          titulo: c?.customer.name ?? "Cliente",
          subtitulo: `escreveu ${quando(e.chegadaEm)} · ${c?.assignee?.name ? `com ${c.assignee.name}` : "na fila"}`,
          destaque: minutos(e.minutos),
          href: `/whatsapp?conv=${e.conversationId}`,
          tom: e.noPrazo === false ? "bad" : "warn",
        };
      }),
      total,
      cortou: cortou || cortouConversas,
      periodo,
    };
  }

  if (f.tipo === "contatos") {
    if (!periodo || !inicio || !fim) return vazia("Contatos novos", "Escolha um período.");
    const [contatos, pessoa, campanha] = await Promise.all([
      db.customer.findMany({
        where: {
          companyId,
          createdAt: { gte: inicio, lt: fim },
          ...(f.vendedora ? { ownerId: f.vendedora } : {}),
          ...(f.campanha ? { campaignId: f.campanha } : {}),
        },
        select: { id: true, name: true, createdAt: true, origin: true, owner: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: TETO_DA_LISTA + 1,
      }),
      nomeDaPessoa(f.vendedora),
      f.campanha ? db.marketingCampaign.findFirst({ where: { id: f.campanha, companyId }, select: { name: true } }) : null,
    ]);
    const { linhas, total, cortou } = cortar(contatos);
    return {
      titulo: pessoa ? `Contatos novos · carteira de ${pessoa}` : campanha ? `Contatos novos · anúncio "${campanha.name}"` : "Contatos novos no período",
      descricao: "Clientes cadastradas no período, da mais recente para a mais antiga.",
      linhas: linhas.map((c) => ({
        id: c.id,
        titulo: c.name,
        subtitulo: `${quando(c.createdAt)} · ${originLabel[c.origin] ?? c.origin}${c.owner ? ` · ${c.owner.name}` : ""}`,
        href: `/clientes/${c.id}`,
      })),
      total,
      cortou,
      periodo,
    };
  }

  if (f.tipo === "vendas") {
    if (!periodo || !inicio || !fim) return vazia("Vendas", "Escolha um período.");
    const [pedidos, pessoa, campanha] = await Promise.all([
      db.order.findMany({
        where: {
          companyId,
          status: { in: PAGOS },
          paidAt: { gte: inicio, lt: fim },
          ...(f.vendedora ? { sellerId: f.vendedora } : {}),
          ...(f.campanha ? { customer: { campaignId: f.campanha } } : {}),
        },
        select: { id: true, number: true, paidAt: true, netTotal: true, status: true, customer: { select: { name: true } }, seller: { select: { name: true } } },
        orderBy: { paidAt: "desc" },
        take: TETO_DA_LISTA + 1,
      }),
      nomeDaPessoa(f.vendedora),
      f.campanha ? db.marketingCampaign.findFirst({ where: { id: f.campanha, companyId }, select: { name: true } }) : null,
    ]);
    const { linhas, total, cortou } = cortar(pedidos);
    const soma = r2(linhas.reduce((s, p) => s + p.netTotal, 0));
    return {
      titulo: pessoa ? `Vendas de ${pessoa}` : campanha ? `Vendas · clientes do anúncio "${campanha.name}"` : "Vendas no período",
      descricao: `Pedidos pagos pela data do pagamento, valor vendido sem o frete. ${cortou ? "" : `Somam ${brl(soma)}.`}`,
      linhas: linhas.map((p) => ({
        id: p.id,
        titulo: `#${p.number} · ${p.customer?.name ?? "sem cliente"}`,
        subtitulo: `${p.paidAt ? quando(p.paidAt) : ""}${p.seller ? ` · ${p.seller.name}` : " · sem vendedora"}`,
        destaque: brl(p.netTotal),
        href: `/pedidos/${p.id}`,
      })),
      total,
      cortou,
      periodo,
    };
  }

  // carteira: a célula da matriz R × F, pela MESMA lista da Recompra (RN-084)
  const aba = await dadosDaAbaRecompra(user, { leve: true });
  // frete-ok: `ClienteDeRecompra.total` é o total COMPRADO na vida (soma de
  // netTotal, a régua da Recompra), não o `total` do pedido com frete
  const clientes = aba.clientes
    .filter((c) => (!f.faixa || c.faixa === f.faixa) && (!f.freq || frequenciaDe(c.compras) === f.freq))
    .sort((a, b) => b.total - a.total);
  const rotuloFaixa = FAIXAS.find((x) => x.id === f.faixa)?.rotulo;
  const rotuloFreq = FREQUENCIAS.find((x) => x.id === f.freq)?.rotulo;
  const { linhas, total, cortou } = cortar(clientes);
  return {
    titulo: `Carteira${rotuloFaixa ? ` · ${rotuloFaixa}` : ""}${rotuloFreq ? ` · ${rotuloFreq}` : ""}`,
    descricao: "Clientes dessa célula da matriz, da que mais comprou na vida para a que menos. A faixa é a da última compra (a régua da aba Recompra).",
    linhas: linhas.map((c) => ({
      id: c.id,
      titulo: `${c.name}${c.vip != null ? ` · VIP #${c.vip}` : ""}`,
      subtitulo: `${c.compras} compra${c.compras === 1 ? "" : "s"} · última há ${c.diasDesde} dias${c.passouDoPonto ? " · passou do ritmo" : ""}`,
      // frete-ok: idem, o total comprado da cliente (netTotal somado)
      destaque: brl(c.total),
      href: `/clientes/${c.id}`,
      tom: c.passouDoPonto ? "warn" : "neutro",
    })),
    total,
    cortou,
    periodo: null,
  };
}

function vazia(titulo: string, descricao: string): Lista {
  return { titulo, descricao, linhas: [], total: 0, cortou: false, periodo: null };
}
