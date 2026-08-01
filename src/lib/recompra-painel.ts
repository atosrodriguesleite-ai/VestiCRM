import { db } from "./db";
import { PAID_ORDER_STATUSES } from "./orders";
import { brl } from "./format";
import type { SessionUser } from "./auth";
import {
  dadosDaAbaRecompra,
  type ClienteDeRecompra,
  type Faixa,
  TOP_VIPS,
} from "./recompra";
import { placarDeRecuperacao } from "./recuperacao";

/**
 * PAINEL DE RECOMPRA — os indicadores do controle de recompra, com o
 * Monitor IA por cima.
 *
 * REGRA DE OURO: este painel NÃO faz conta própria. Ele deriva tudo:
 *  • dos MESMOS clientes/estágios/VIPs da aba Recompra (dadosDaAbaRecompra);
 *  • do MESMO placar da tela Recuperação (placarDeRecuperacao);
 *  • da MESMA régua de faturamento do Dashboard (netTotal em pedidos PAGOS,
 *    pela data de pagamento).
 * Se um número daqui aparecer em outra tela, é O MESMO número — duas contas
 * separadas um dia discordam, e número que não bate mata a confiança no
 * sistema inteiro.
 *
 * O MONITOR IA não é bola de cristal: é o vigia que LÊ esses mesmos números,
 * compara com o período anterior e escreve a conclusão em português — cada
 * frase rastreável até a conta que a gerou. Determinístico de propósito:
 * num painel "100% confiável", chute não entra.
 */

export type Insight = {
  nivel: "ALERTA" | "ATENCAO" | "BOA";
  emoji: string;
  texto: string;
};

export type PainelDeRecompra = {
  // clientes por estágio (idênticos à aba Recompra)
  porFaixa: Record<Faixa, number>;
  passouDoPonto: number;
  /** faturamento médio por compra dessas clientes = o que está na mesa */
  valorEmRisco: number;
  // taxa de recompra (mesma definição do card do Marketing)
  compradoras: number;
  recorrentes: number; // 2+ compras
  taxaRecompra: number; // %
  cicloMedioDaLoja: number | null;
  // faturamento do mês: quanto veio de RECOMPRA vs 1ª compra
  mesFaturamento: number;
  mesRecompra: number;
  mesPrimeiraCompra: number;
  // mês anterior (para o monitor comparar)
  mesAnteriorRecompra: number;
  // VIPs
  vips: ClienteDeRecompra[];
  concentracaoVip: number; // % do total histórico comprado pelo Top 20
  // recuperação (mesmo placar da tela Recuperação)
  recuperadoMes: number;
  recuperadoVendas: number;
  // aniversariantes sem compra no mês (oportunidade parada)
  aniversariantes: number;
  insights: Insight[];
};

const DIA_MS = 24 * 60 * 60 * 1000;

/** Início do mês atual e do anterior, no calendário de São Paulo. */
export function inicioDoMesSP(agora = new Date(), mesesAtras = 0): Date {
  const sp = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  // meia-noite de SP = 03:00 UTC
  return new Date(
    Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth() - mesesAtras, 1, 3, 0, 0)
  );
}

/**
 * O MONITOR IA: lê os números e escreve as conclusões. Puro de propósito —
 * cada frase é testável, e nenhuma inventa dado que não veio da conta.
 */
export function gerarInsights(p: Omit<PainelDeRecompra, "insights">): Insight[] {
  const out: Insight[] = [];

  if (p.passouDoPonto > 0) {
    out.push({
      nivel: "ALERTA",
      emoji: "⏰",
      texto: `${p.passouDoPonto} cliente${p.passouDoPonto === 1 ? "" : "s"} ${
        p.passouDoPonto === 1 ? "passou" : "passaram"
      } do próprio ritmo de reposição — ${brl(p.valorEmRisco)} de compra média em jogo. É a lista mais quente da aba Recompra.`,
    });
  }

  if (p.compradoras >= 5) {
    if (p.taxaRecompra < 30) {
      out.push({
        nivel: "ALERTA",
        emoji: "📉",
        texto: `Só ${Math.round(p.taxaRecompra)}% das clientes voltaram a comprar. A primeira venda está acontecendo; a segunda, não — vale caprichar no pós-venda da 1ª compra.`,
      });
    } else if (p.taxaRecompra >= 60) {
      out.push({
        nivel: "BOA",
        emoji: "🏆",
        texto: `${Math.round(p.taxaRecompra)}% das clientes recompram — carteira saudável. O jogo agora é aumentar a frequência, não só a base.`,
      });
    }
  }

  if (p.mesFaturamento > 0) {
    const pct = Math.round((p.mesRecompra / p.mesFaturamento) * 100);
    out.push({
      nivel: pct >= 50 ? "BOA" : "ATENCAO",
      emoji: "🔁",
      texto: `${pct}% do faturamento do mês (${brl(p.mesRecompra)}) veio de clientes que JÁ compravam — ${
        pct >= 50
          ? "a recompra está sustentando a loja."
          : "a loja ainda depende de cliente novo; recompra barata está sendo deixada na mesa."
      }`,
    });
  }

  if (p.mesAnteriorRecompra > 0 && p.mesRecompra < p.mesAnteriorRecompra * 0.7) {
    out.push({
      nivel: "ALERTA",
      emoji: "🚨",
      texto: `A receita de recompra caiu para ${brl(p.mesRecompra)} contra ${brl(
        p.mesAnteriorRecompra
      )} no mês passado — queda de ${Math.round(
        (1 - p.mesRecompra / p.mesAnteriorRecompra) * 100
      )}%. Olhe a lista "passou do ponto" hoje.`,
    });
  }

  if (p.concentracaoVip >= 60 && p.compradoras > TOP_VIPS) {
    out.push({
      nivel: "ATENCAO",
      emoji: "💎",
      texto: `As ${TOP_VIPS} VIPs respondem por ${Math.round(
        p.concentracaoVip
      )}% de tudo que a loja já vendeu. Dependência alta: mimar as VIPs é obrigação, e criar novas VIPs é o seguro.`,
    });
  }

  if (p.recuperadoMes > 0) {
    out.push({
      nivel: "BOA",
      emoji: "🛍️",
      texto: `A Recuperação de carrinhos já devolveu ${brl(p.recuperadoMes)} este mês (${
        p.recuperadoVendas
      } venda${p.recuperadoVendas === 1 ? "" : "s"}).`,
    });
  }

  if (p.aniversariantes > 0) {
    out.push({
      nivel: "ATENCAO",
      emoji: "🎂",
      texto: `${p.aniversariantes} aniversariante${
        p.aniversariantes === 1 ? "" : "s"
      } do mês ainda sem compra no mês — a mensagem que mais converte no ano está esperando na aba Recompra.`,
    });
  }

  if (out.length === 0) {
    out.push({
      nivel: "BOA",
      emoji: "✅",
      texto: "Nenhum alerta agora: ninguém passou do ponto e a recompra segue o ritmo. O monitor continua de olho.",
    });
  }
  // alertas primeiro, boas notícias por último
  const peso = { ALERTA: 0, ATENCAO: 1, BOA: 2 } as const;
  return out.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}

export async function painelDeRecompra(user: SessionUser): Promise<PainelDeRecompra> {
  const agora = new Date();
  const inicioMes = inicioDoMesSP(agora);
  const inicioMesAnterior = inicioDoMesSP(agora, 1);

  // FONTE ÚNICA nº 1: os mesmos clientes/estágios/VIPs da aba Recompra
  const aba = await dadosDaAbaRecompra(user);
  const clientes = aba.clientes;

  const porFaixa: Record<Faixa, number> = {
    ATIVA: 0,
    ESFRIANDO: 0,
    RISCO: 0,
    SUMIDA: 0,
  };
  for (const c of clientes) porFaixa[c.faixa]++;
  const atrasadas = clientes.filter((c) => c.passouDoPonto);
  // o que está na mesa = a compra média de cada atrasada (total ÷ compras)
  const valorEmRisco = atrasadas.reduce((s, c) => s + c.total / c.compras, 0);

  const recorrentes = clientes.filter((c) => c.compras >= 2).length;
  const ciclos = clientes.map((c) => c.cicloDias).filter((v): v is number => v != null);
  const cicloMedioDaLoja = ciclos.length
    ? Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length)
    : null;

  // FONTE ÚNICA nº 2: faturamento por data de PAGAMENTO, netTotal, pedidos
  // PAGOS — a régua do Dashboard. Recompra = pedido que NÃO é o primeiro
  // pago da cliente.
  const pedidosDoisMeses = await db.order.findMany({
    where: {
      companyId: user.companyId,
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { gte: inicioMesAnterior },
    },
    select: { customerId: true, netTotal: true, paidAt: true },
  });
  const primeiraCompraDe = new Map<string, Date>();
  const primeiras = (await db.order.groupBy({
    by: ["customerId"],
    where: {
      companyId: user.companyId,
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { not: null },
    },
    _min: { paidAt: true },
  })) as unknown as { customerId: string | null; _min: { paidAt: Date | null } }[];
  for (const p of primeiras) {
    if (p.customerId && p._min.paidAt) primeiraCompraDe.set(p.customerId, p._min.paidAt);
  }
  let mesFaturamento = 0;
  let mesRecompra = 0;
  let mesAnteriorRecompra = 0;
  for (const o of pedidosDoisMeses) {
    if (!o.paidAt) continue;
    const primeira = primeiraCompraDe.get(o.customerId);
    const ehRecompra = !!primeira && o.paidAt.getTime() > primeira.getTime();
    if (o.paidAt >= inicioMes) {
      mesFaturamento += o.netTotal;
      if (ehRecompra) mesRecompra += o.netTotal;
    } else if (ehRecompra) {
      mesAnteriorRecompra += o.netTotal;
    }
  }

  // FONTE ÚNICA nº 3: o placar da tela Recuperação
  const recuperado = await placarDeRecuperacao(user.companyId, inicioMes);

  const vips = clientes
    .filter((c) => c.vip !== null)
    .sort((a, b) => (a.vip ?? 99) - (b.vip ?? 99));
  const totalHistorico = clientes.reduce((s, c) => s + c.total, 0);
  const concentracaoVip = totalHistorico
    ? (vips.reduce((s, c) => s + c.total, 0) / totalHistorico) * 100
    : 0;

  const aniversariantes = clientes.filter(
    (c) => c.aniversarioMes && c.diasDesde > (agora.getTime() - inicioMes.getTime()) / DIA_MS
  ).length;

  const base = {
    porFaixa,
    passouDoPonto: atrasadas.length,
    valorEmRisco,
    compradoras: clientes.length,
    recorrentes,
    taxaRecompra: clientes.length ? (recorrentes / clientes.length) * 100 : 0,
    cicloMedioDaLoja,
    mesFaturamento,
    mesRecompra,
    mesPrimeiraCompra: mesFaturamento - mesRecompra,
    mesAnteriorRecompra,
    vips,
    concentracaoVip,
    recuperadoMes: recuperado.valor,
    recuperadoVendas: recuperado.vendas,
    aniversariantes,
  };
  return { ...base, insights: gerarInsights(base) };
}
