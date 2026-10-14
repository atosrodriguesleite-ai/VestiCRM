/**
 * FATOS DIÁRIOS DO BI DE VENDAS (RN-082, ADR-019).
 *
 * O painel do dono precisa de números que a tabela de mensagens (a maior do
 * banco) não devolve em tempo de tela. Então os números nascem AQUI, uma
 * linha por loja × dia (`BiDia`), de carona no tráfego com trava por loja —
 * nunca um 3º cron (ADR-002) —, e o painel só soma linhas prontas.
 *
 * Duas partes:
 * - `calcularFatos`: a conta PURA (sem banco), o que o teste trava. Recebe
 *   as mensagens da janela, as conversas delas, os contatos novos e os
 *   pedidos, e devolve uma linha por dia pedido.
 * - `atualizarFatosDoBi`: carrega a janela do banco, chama a conta e grava.
 *
 * A JANELA: os últimos 8 dias são refeitos a cada rodada (a espera que
 * começou ontem pode ser respondida hoje; o lead de anteontem pode virar
 * resposta amanhã), e os dias mais velhos são congelados — o que ficou sem
 * resposta por 7 dias ficou sem resposta. Dias que faltam nos últimos 90
 * (loja nova no BI, histórico) entram aos poucos, 22 por rodada, até o
 * passado estar preenchido.
 *
 * COLETA PARA TODA LOJA: a chave `biEnabled` só abre a tela (ADR-019). A
 * loja que contratar o BI daqui a três meses já encontra três meses de
 * história.
 */
import { db } from "../db";
import { logServerError } from "../health";
import { PAID_ORDER_STATUSES } from "../orders";
import { diaSP } from "../dia";
import { lerHorarioComercial } from "./horario-comercial";
import { parearEsperas, respostaHumana, type MensagemLeve, type Regua } from "./tempo-de-resposta";

/** Intervalo mínimo entre duas rodadas da mesma loja. */
export const INTERVALO_DOS_FATOS_MS = 30 * 60_000;
/** dias refeitos em toda rodada (hoje e os 7 anteriores) */
export const DIAS_VIVOS = 8;
/** até onde o histórico é preenchido */
export const DIAS_DE_HISTORICO = 90;
/** dias faltantes preenchidos por rodada (além dos vivos) */
export const DIAS_FALTANTES_POR_RODADA = 22;
/** teto de mensagens lidas por rodada — acima disso a rodada só grava os dias completos */
export const TETO_DE_MENSAGENS = 60_000;
/**
 * Dias ANTES do primeiro dia calculado que entram na leitura: a espera que
 * começou num dia já congelado não pode renascer como espera nova pela
 * mensagem seguinte da cliente, e a resposta de hoje à pergunta de ontem
 * precisa ver a pergunta (achado da revisão). Só esperas que COMEÇAM nos
 * dias pedidos são contadas.
 */
export const DIAS_DE_LEITURA_ANTES = 7;
/** teto de ids por consulta IN (o Postgres aceita 32.767 parâmetros) */
const LOTE_DE_IDS = 5_000;
/** limites dos baldes da distribuição do tempo de resposta (min de atendimento) */
export const BALDES_MIN = [5, 15, 30, 60, 120, 240] as const;

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** "2026-10-13" → instante da 0h de São Paulo daquele dia */
export function inicioDoDiaSP(dia: string): Date {
  return new Date(`${dia}T00:00:00.000-03:00`);
}

/** os N dias até `hoje` (inclusive), do mais antigo ao mais novo */
export function ultimosDias(hoje: string, n: number): string[] {
  const fim = inicioDoDiaSP(hoje).getTime() + SP_OFFSET_MS; // meia-noite "UTC" do dia SP
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(fim - i * DIA_MS).toISOString().slice(0, 10));
  return out;
}

export type ContatoLeve = { id: string; createdAt: Date; origin: string };
export type ConversaLeve = { id: string; customerId: string; status: string };
export type PedidoLeve = {
  customerId: string | null;
  createdAt: Date;
  paidAt: Date | null;
  status: string;
  netTotal: number;
};

export type EntradaDosFatos = {
  mensagens: MensagemLeve[];
  conversas: ConversaLeve[];
  contatos: ContatoLeve[];
  pedidos: PedidoLeve[];
  regua: Omit<Regua, "encerradas">;
};

export type FatoDoDia = {
  dia: string;
  leads: number;
  origens: Record<string, number>;
  leadsRespondidos: number;
  leadsComPedido: number;
  leadsPagaram: number;
  esperas: number;
  respondidas: number;
  noPrazo: number;
  foraDoPrazo: number;
  semResposta: number;
  encerradasSemResposta: number;
  medianaMin: number | null;
  p90Min: number | null;
  hist: number[];
  pedidos: number;
  pedidosPagos: number;
  vendido: number;
};

const PAGOS: readonly string[] = PAID_ORDER_STATUSES;

/** em qual balde cai um tempo de resposta (índice em `hist`) */
export function baldeDoTempo(minutos: number): number {
  const i = BALDES_MIN.findIndex((teto) => minutos <= teto);
  return i === -1 ? BALDES_MIN.length : i;
}

function vazio(dia: string): FatoDoDia {
  return {
    dia,
    leads: 0,
    origens: {},
    leadsRespondidos: 0,
    leadsComPedido: 0,
    leadsPagaram: 0,
    esperas: 0,
    respondidas: 0,
    noPrazo: 0,
    foraDoPrazo: 0,
    semResposta: 0,
    encerradasSemResposta: 0,
    medianaMin: null,
    p90Min: null,
    hist: Array(BALDES_MIN.length + 1).fill(0),
    pedidos: 0,
    pedidosPagos: 0,
    vendido: 0,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A CONTA. `dias` são os dias a devolver (AAAA-MM-DD de SP); tudo que cair
 * fora deles é ignorado. As mensagens devem cobrir do primeiro dia até agora
 * — a espera que começou no dia D e foi respondida em D+3 precisa ver D+3.
 */
export function calcularFatos(entrada: EntradaDosFatos, dias: string[]): FatoDoDia[] {
  const porDia = new Map<string, FatoDoDia>(dias.map((d) => [d, vazio(d)]));
  const pega = (instante: Date) => porDia.get(diaSP(instante));

  // conversas encerradas: a espera aberta nelas não é cliente esperando
  const encerradas = new Set(entrada.conversas.filter((c) => c.status === "CLOSED").map((c) => c.id));
  const esperas = parearEsperas(entrada.mensagens, { ...entrada.regua, encerradas });
  const temposPorDia = new Map<string, number[]>();
  for (const e of esperas) {
    const f = pega(e.chegadaEm);
    if (!f) continue;
    f.esperas += 1;
    if (e.respostaEm) {
      f.respondidas += 1;
      if (e.noPrazo) f.noPrazo += 1;
      else f.foraDoPrazo += 1;
      f.hist[baldeDoTempo(e.minutos)] += 1;
      const lista = temposPorDia.get(f.dia) ?? [];
      lista.push(e.minutos);
      temposPorDia.set(f.dia, lista);
    } else if (e.encerrada) {
      f.encerradasSemResposta += 1;
    } else {
      f.semResposta += 1;
      if (e.noPrazo === false) f.foraDoPrazo += 1;
    }
  }
  for (const [dia, tempos] of temposPorDia) {
    const f = porDia.get(dia)!;
    tempos.sort((a, b) => a - b);
    const meio = Math.floor(tempos.length / 2);
    f.medianaMin = r1(tempos.length % 2 ? tempos[meio] : (tempos[meio - 1] + tempos[meio]) / 2);
    f.p90Min = r1(tempos[Math.max(1, Math.ceil(0.9 * tempos.length)) - 1]);
  }

  // leads: contatos novos do dia, por origem, e quantos tiveram resposta humana
  const ultimaHumanaPorConversa = new Map<string, number>();
  for (const m of entrada.mensagens) {
    if (!respostaHumana(m)) continue;
    const t = m.createdAt.getTime();
    if ((ultimaHumanaPorConversa.get(m.conversationId) ?? -1) < t)
      ultimaHumanaPorConversa.set(m.conversationId, t);
  }
  const ultimaHumanaPorCliente = new Map<string, number>();
  for (const c of entrada.conversas) {
    const t = ultimaHumanaPorConversa.get(c.id);
    if (t == null) continue;
    if ((ultimaHumanaPorCliente.get(c.customerId) ?? -1) < t) ultimaHumanaPorCliente.set(c.customerId, t);
  }
  // funil por fatos: o contato novo fez pedido? pagou? (pedido cancelado não conta)
  const comPedido = new Set<string>();
  const pagaram = new Set<string>();
  for (const p of entrada.pedidos) {
    if (!p.customerId || p.status === "CANCELADO") continue;
    comPedido.add(p.customerId);
    if (PAGOS.includes(p.status)) pagaram.add(p.customerId);
  }
  for (const c of entrada.contatos) {
    const f = pega(c.createdAt);
    if (!f) continue;
    f.leads += 1;
    f.origens[c.origin] = (f.origens[c.origin] ?? 0) + 1;
    const t = ultimaHumanaPorCliente.get(c.id);
    if (t != null && t >= c.createdAt.getTime()) f.leadsRespondidos += 1;
    if (comPedido.has(c.id)) f.leadsComPedido += 1;
    if (pagaram.has(c.id)) f.leadsPagaram += 1;
  }

  // pedidos: criados no dia (fora cancelados) e pagos no dia (RN-001/002)
  for (const p of entrada.pedidos) {
    if (p.status !== "CANCELADO") {
      const f = pega(p.createdAt);
      if (f) f.pedidos += 1;
    }
    if (p.paidAt && PAGOS.includes(p.status)) {
      const f = pega(p.paidAt);
      if (f) {
        f.pedidosPagos += 1;
        f.vendido += p.netTotal;
      }
    }
  }
  for (const f of porDia.values()) f.vendido = Math.round(f.vendido * 100) / 100;
  return dias.map((d) => porDia.get(d)!);
}

/**
 * Quais dias esta rodada calcula: os vivos (hoje e os 7 anteriores) mais os
 * que faltam nos últimos 90, do mais recente para o mais antigo, com teto
 * por rodada. Puro.
 */
export function diasDaRodada(hoje: string, jaGravados: Set<string>): string[] {
  const vivos = ultimosDias(hoje, DIAS_VIVOS);
  const historico = ultimosDias(hoje, DIAS_DE_HISTORICO);
  const faltam = historico
    .filter((d) => !jaGravados.has(d) && !vivos.includes(d))
    .reverse()
    .slice(0, DIAS_FALTANTES_POR_RODADA);
  return [...new Set([...faltam, ...vivos])].sort();
}

/**
 * Quando a leitura bateu no teto, só os dias DEPOIS do primeiro dia lido
 * (que veio pela metade) têm a janela completa — os outros ficam para a
 * próxima rodada. Puro.
 */
export function diasComJanelaCompleta(dias: string[], primeiroDiaLido: string | null, cortou: boolean): string[] {
  if (!cortou || !primeiroDiaLido) return dias;
  return dias.filter((d) => d > primeiroDiaLido);
}

export type OpcoesDaRodada = {
  /** só os dias vivos (hoje e os 7 anteriores) — a abertura do painel; o histórico fica para a carona */
  soVivos?: boolean;
};

/** Carrega a janela, calcula e grava. Lança se o banco falhar (quem chama decide). */
export async function atualizarFatosDoBi(
  companyId: string,
  agora = new Date(),
  opcoes: OpcoesDaRodada = {}
): Promise<{ dias: number; cortou: boolean }> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { horarioComercial: true, intakeSlaMinutes: true },
  });
  if (!company) return { dias: 0, cortou: false };
  const hoje = diaSP(agora);
  let dias: string[];
  if (opcoes.soVivos) {
    dias = ultimosDias(hoje, DIAS_VIVOS);
  } else {
    const gravados = await db.biDia.findMany({
      where: { companyId, dia: { gte: ultimosDias(hoje, DIAS_DE_HISTORICO)[0] } },
      select: { dia: true },
    });
    dias = diasDaRodada(hoje, new Set(gravados.map((g) => g.dia)));
  }
  const inicio = inicioDoDiaSP(dias[0]);
  const inicioDaLeitura = new Date(inicio.getTime() - DIAS_DE_LEITURA_ANTES * DIA_MS);

  // as MAIS NOVAS primeiro: se o teto cortar, quem fica de fora é o passado
  // (que só perde dias de histórico), nunca o presente — e a rodada grava só
  // os dias cuja janela veio inteira (achado da revisão)
  const lidasDesc = await db.message.findMany({
    where: { conversation: { companyId }, createdAt: { gte: inicioDaLeitura } },
    select: { conversationId: true, direction: true, kind: true, createdAt: true, authorId: true, automatica: true },
    orderBy: { createdAt: "desc" },
    take: TETO_DE_MENSAGENS,
  });
  const cortou = lidasDesc.length >= TETO_DE_MENSAGENS;
  const mensagens = lidasDesc.reverse();
  const primeiroDiaLido = mensagens.length ? diaSP(mensagens[0].createdAt) : null;
  dias = diasComJanelaCompleta(dias, primeiroDiaLido, cortou);
  if (!dias.length) return { dias: 0, cortou };

  const idsDeConversa = [...new Set(mensagens.map((m) => m.conversationId))];
  const conversas: ConversaLeve[] = [];
  for (let i = 0; i < idsDeConversa.length; i += LOTE_DE_IDS) {
    conversas.push(
      ...(await db.conversation.findMany({
        where: { id: { in: idsDeConversa.slice(i, i + LOTE_DE_IDS) }, companyId },
        select: { id: true, customerId: true, status: true },
      }))
    );
  }
  const [contatos, pedidos] = await Promise.all([
    db.customer.findMany({
      where: { companyId, createdAt: { gte: inicio } },
      select: { id: true, createdAt: true, origin: true },
    }),
    db.order.findMany({
      where: { companyId, OR: [{ createdAt: { gte: inicio } }, { paidAt: { gte: inicio } }] },
      select: { customerId: true, createdAt: true, paidAt: true, status: true, netTotal: true },
    }),
  ]);

  const fatos = calcularFatos(
    {
      mensagens: mensagens as MensagemLeve[],
      conversas,
      contatos,
      pedidos,
      regua: {
        horario: lerHorarioComercial(company.horarioComercial),
        prazoMin: company.intakeSlaMinutes,
        agora,
      },
    },
    dias
  );
  // tudo numa transação: metade dos dias gravada seria um painel mentindo
  await db.$transaction(
    fatos.map((f) => {
      const data = {
        leads: f.leads,
        origens: JSON.stringify(f.origens),
        leadsRespondidos: f.leadsRespondidos,
        leadsComPedido: f.leadsComPedido,
        leadsPagaram: f.leadsPagaram,
        esperas: f.esperas,
        respondidas: f.respondidas,
        noPrazo: f.noPrazo,
        foraDoPrazo: f.foraDoPrazo,
        semResposta: f.semResposta,
        encerradasSemResposta: f.encerradasSemResposta,
        medianaMin: f.medianaMin,
        p90Min: f.p90Min,
        hist: JSON.stringify(f.hist),
        pedidos: f.pedidos,
        pedidosPagos: f.pedidosPagos,
        vendido: f.vendido,
      };
      return db.biDia.upsert({
        where: { companyId_dia: { companyId, dia: f.dia } },
        create: { companyId, dia: f.dia, ...data },
        update: data,
      });
    })
  );
  if (cortou) {
    await logServerError({
      source: "server",
      path: "/bi/fatos",
      message: `BI: a leitura de mensagens bateu no teto de ${TETO_DE_MENSAGENS} (loja ${companyId}); gravados só os dias com janela completa (${dias.length})`,
      alarme: false,
    }).catch(() => null);
  }
  return { dias: fatos.length, cortou };
}

/** Freio em memória por instância, antes da trava do banco (o padrão da RN-051). */
const ultimaTentativa = new Map<string, number>();

/**
 * A carona: confere a trava e roda. Nunca lança — é carona, não pode derrubar
 * a rota que a chamou. Roda para TODA loja (coleta sempre, ADR-019).
 */
export async function atualizarFatosDoBiSeDevido(companyId: string, opcoes: OpcoesDaRodada = {}): Promise<void> {
  const ms = Date.now();
  if (ms - (ultimaTentativa.get(companyId) ?? 0) < INTERVALO_DOS_FATOS_MS) return;
  ultimaTentativa.set(companyId, ms);
  try {
    const agora = new Date();
    const claimed = await db.company.updateMany({
      where: {
        id: companyId,
        OR: [
          { biFatosRunAt: null },
          { biFatosRunAt: { lt: new Date(agora.getTime() - INTERVALO_DOS_FATOS_MS) } },
        ],
      },
      data: { biFatosRunAt: agora },
    });
    if (claimed.count === 0) return;
    await atualizarFatosDoBi(companyId, agora, opcoes);
  } catch (e) {
    // A TRAVA FICA: devolvê-la faria o sync de 3s repetir a consulta mais
    // pesada do app a cada batida enquanto a causa não some (achado da
    // revisão) — a próxima tentativa é daqui a 30 min. E SEM alarme: o canal
    // "🚨 Erro em produção" é das emergências (régua da RN-066); o caso fica
    // no painel de Saúde.
    await logServerError({
      source: "server",
      path: "/bi/fatos",
      message: `BI: rodada de fatos falhou (loja ${companyId})`,
      detail: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
      alarme: false,
    }).catch(() => null);
  }
}
