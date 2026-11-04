// Guarda RN-108
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TETO_DIAS_GRAFICO,
  acumular,
  janelaDoGrafico,
  agruparPorSemana,
  diasEntre,
  enderecoDaPorta,
  fraseDaComparacao,
  lerParametros,
  montarFaturamento,
  montarGrafico,
  periodoDeComparacao,
  resumoDoFaturamento,
  serieDiaria,
  somarDias,
  textoDaVariacao,
  variacao,
} from "../dashboard/faturamento-regra";
import { fimDoDiaSP, inicioDoDiaSP } from "../periodo";
import { PAID_ORDER_STATUSES } from "../orders";
import type { SessionUser } from "../auth";

/**
 * O GRÁFICO DE FATURAMENTO VIVO (RN-108): o período comparado tem SEMPRE a
 * mesma duração e alinha dia a dia; cada ponto é um dia de São Paulo
 * somando `netTotal` de pedido pago pela data do pagamento; a porta devolve
 * as duas séries pela mesma régua da página, recortada pela sessão; o
 * navegador só soma o que o servidor mandou.
 */

/* ---- o banco e a sessão de mentira da porta ---------------------------- */
const estado = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  consultas: [] as { where: Record<string, unknown>; select: unknown }[],
  vendas: [] as { netTotal: number; paidAt: Date; sellerId: string | null }[],
}));
vi.mock("@/lib/auth", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUser: async () => {
      if (!estado.user) throw new AuthError("Não autenticado");
      return estado.user;
    },
  };
});
vi.mock("@/lib/db", () => ({
  db: {
    order: {
      findMany: async (q: { where: Record<string, unknown>; select: unknown }) => {
        estado.consultas.push(q);
        const paidAt = q.where.paidAt as { gte: Date; lte: Date };
        return estado.vendas.filter((v) => v.paidAt >= paidAt.gte && v.paidAt <= paidAt.lte);
      },
    },
  },
}));

const sp = (iso: string, hora = "12:00") => new Date(`${iso}T${hora}:00-03:00`);

describe("o período comparado tem a mesma duração e alinha dia a dia", () => {
  const periodo = { de: "2026-11-01", ate: "2026-11-04" };
  it("anterior: os 4 dias imediatamente antes", () => {
    expect(periodoDeComparacao("anterior", periodo)).toEqual({ de: "2026-10-28", ate: "2026-10-31" });
  });
  it("ano passado: as mesmas datas um ano antes, com a mesma duração", () => {
    expect(periodoDeComparacao("ano-passado", periodo)).toEqual({ de: "2025-11-01", ate: "2025-11-04" });
    // 29/02 escorrega para 01/03, e a duração continua a mesma
    expect(periodoDeComparacao("ano-passado", { de: "2028-02-29", ate: "2028-03-02" })).toEqual({ de: "2027-03-01", ate: "2027-03-03" });
  });
  it("outra data: começa onde a loja disse e dura o mesmo; sem data válida não há comparação", () => {
    expect(periodoDeComparacao("personalizado", periodo, "2026-10-01")).toEqual({ de: "2026-10-01", ate: "2026-10-04" });
    expect(periodoDeComparacao("personalizado", periodo, "2026-02-30")).toBeNull();
    expect(periodoDeComparacao("personalizado", periodo, null)).toBeNull();
  });
  it("as contas de dia atravessam o mês e o ano", () => {
    expect(somarDias("2026-01-01", -1)).toBe("2025-12-31");
    expect(diasEntre("2026-10-28", "2026-11-04")).toBe(8);
    expect(diasEntre("2026-11-04", "2026-11-01")).toBe(1);
  });
});

describe("a série diária é por dia de São Paulo, pela data do pagamento", () => {
  it("o pagamento das 23h de SP conta no dia de SP, não no dia UTC", () => {
    const s = serieDiaria(
      [
        { paidAt: sp("2026-11-01", "23:30"), netTotal: 100 },
        { paidAt: sp("2026-11-02", "00:10"), netTotal: 50 },
        { paidAt: sp("2026-11-02", "08:00"), netTotal: 25.5 },
        { paidAt: null, netTotal: 999 },
        { paidAt: sp("2026-10-31"), netTotal: 999 },
        { paidAt: sp("2026-11-05"), netTotal: 999 },
      ],
      "2026-11-01",
      4
    );
    expect(s.valores).toEqual([100, 75.5, 0, 0]);
    expect(s.pedidos).toEqual([1, 2, 0, 0]);
  });
  it("aceita a data como texto (o JSON da porta)", () => {
    const s = serieDiaria([{ paidAt: sp("2026-11-03").toISOString(), netTotal: 10 }], "2026-11-01", 4);
    expect(s.valores).toEqual([0, 0, 10, 0]);
  });
  it("a janela do gráfico prende o fim ao teto (é o que vai ao banco)", () => {
    expect(janelaDoGrafico({ de: "2026-11-01", ate: "2026-11-04" })).toEqual({ periodo: { de: "2026-11-01", ate: "2026-11-04" }, dias: 4, cortado: false });
    const j = janelaDoGrafico({ de: "2020-01-01", ate: "2026-12-31" });
    expect(j.cortado).toBe(true);
    expect(j.dias).toBe(TETO_DIAS_GRAFICO);
    expect(j.periodo).toEqual({ de: "2020-01-01", ate: somarDias("2020-01-01", TETO_DIAS_GRAFICO - 1) });
  });
  it("o pacote corta no teto e DIZ", () => {
    const d = montarFaturamento({
      periodo: { de: "2020-01-01", ate: "2026-12-31" },
      tipo: "anterior",
      comparacao: periodoDeComparacao("anterior", { de: "2020-01-01", ate: "2026-12-31" }),
      vendas: [],
      vendasComparadas: [],
    });
    expect(d.cortado).toBe(true);
    expect(d.periodo.dias).toBe(TETO_DIAS_GRAFICO);
    expect(d.atual.valores).toHaveLength(TETO_DIAS_GRAFICO);
    expect(d.comparado.valores).toHaveLength(TETO_DIAS_GRAFICO);
  });
});

describe("o gráfico e o resumo são a mesma soma", () => {
  const periodo = { de: "2026-11-01", ate: "2026-11-04" };
  const dados = montarFaturamento({
    periodo,
    tipo: "anterior",
    comparacao: periodoDeComparacao("anterior", periodo),
    vendas: [
      { paidAt: sp("2026-11-01"), netTotal: 100 },
      { paidAt: sp("2026-11-03"), netTotal: 300 },
      { paidAt: sp("2026-11-04"), netTotal: 250.5 },
      { paidAt: sp("2026-11-04"), netTotal: 49.5 },
    ],
    vendasComparadas: [
      { paidAt: sp("2026-10-28"), netTotal: 400 },
      { paidAt: sp("2026-10-30"), netTotal: 100 },
    ],
  });
  it("por dia: cada ponto sabe que dia é nos DOIS períodos", () => {
    const g = montarGrafico(dados, "dia");
    expect(g.porSemana).toBe(false);
    expect(g.rotulos).toEqual(["01/11", "02/11", "03/11", "04/11"]);
    expect(g.pontos[3]).toEqual({
      de: "2026-11-04",
      ate: "2026-11-04",
      cmpDe: "2026-10-31",
      cmpAte: "2026-10-31",
      atual: 300,
      comparado: 0,
      pedidos: 2,
      pedidosComparados: 0,
    });
    expect(g.pontos[0].comparado).toBe(400);
  });
  it("acumulado: a soma corrida, nos dois", () => {
    const g = montarGrafico(dados, "acumulado");
    expect(g.pontos.map((p) => p.atual)).toEqual([100, 100, 400, 700]);
    expect(g.pontos.map((p) => p.comparado)).toEqual([400, 400, 500, 500]);
    expect(g.pontos.map((p) => p.pedidos)).toEqual([1, 1, 2, 4]);
  });
  it("o resumo soma a MESMA série: total, diferença, variação, média, melhor dia", () => {
    const r = resumoDoFaturamento(dados);
    expect(r.total).toBe(700);
    expect(r.pedidos).toBe(4);
    expect(r.totalComparado).toBe(500);
    expect(r.diferenca).toBe(200);
    expect(r.variacao).toBe(40);
    expect(r.mediaPorDia).toBe(175);
    expect(r.mediaPorDiaComparada).toBe(125);
    expect(r.ticket).toBe(175);
    expect(r.ticketComparado).toBe(250);
    expect(r.melhorDia).toEqual({ dia: "2026-11-03", valor: 300 });
    // o acumulado termina onde o resumo termina
    const acum = montarGrafico(dados, "acumulado").pontos;
    expect(acum[acum.length - 1].atual).toBe(r.total);
    expect(acum[acum.length - 1].comparado).toBe(r.totalComparado);
  });
  it("a média por dia do atual é dos dias FECHADOS quando o período chega até hoje", () => {
    // hoje = 04/11: os três dias fechados somam 400 → 133,33; o comparado (fechado) divide por 4
    const r = resumoDoFaturamento(dados, "2026-11-04");
    expect(r.mediaSemHoje).toBe(true);
    expect(r.diasDaMedia).toBe(3);
    expect(r.mediaPorDia).toBeCloseTo(400 / 3, 6);
    expect(r.mediaPorDiaComparada).toBe(125);
    // período já fechado (hoje depois dele): divide por todos os dias
    const fechado = resumoDoFaturamento(dados, "2026-11-10");
    expect(fechado.mediaSemHoje).toBe(false);
    expect(fechado.diasDaMedia).toBe(4);
    expect(fechado.mediaPorDia).toBe(175);
    // período de UM dia (o atalho "Hoje"): não há dia fechado para dividir — vale o dia
    const umDia = montarFaturamento({ periodo: { de: "2026-11-04", ate: "2026-11-04" }, tipo: "anterior", comparacao: null, vendas: [{ paidAt: sp("2026-11-04"), netTotal: 50 }], vendasComparadas: [] });
    const hoje = resumoDoFaturamento(umDia, "2026-11-04");
    expect(hoje.mediaSemHoje).toBe(false);
    expect(hoje.mediaPorDia).toBe(50);
    // sem "hoje" (o servidor), divide por todos
    expect(resumoDoFaturamento(dados).mediaPorDia).toBe(175);
  });
  it("sem comparação: nada de zero disfarçado", () => {
    const semCmp = montarFaturamento({ periodo, tipo: "personalizado", comparacao: null, vendas: [], vendasComparadas: [] });
    const r = resumoDoFaturamento(semCmp);
    expect(r.totalComparado).toBeNull();
    expect(r.variacao).toBeNull();
    expect(r.melhorDia).toBeNull();
    expect(montarGrafico(semCmp, "dia").pontos[0].comparado).toBeNull();
    expect(fraseDaComparacao(semCmp.comparacao)).toBe("sem período para comparar");
    expect(variacao(10, 0)).toBeNull();
    expect(textoDaVariacao(null)).toBe("");
    expect(textoDaVariacao(12.345)).toBe("+12,3%");
    expect(textoDaVariacao(-8)).toBe("−8%");
    expect(textoDaVariacao(0.01)).toBe("0%");
  });
  it("período longo agrupa por semana e o ponto diz de que dia a que dia soma", () => {
    const longo = { de: "2026-01-01", ate: "2026-04-10" }; // 100 dias
    const d = montarFaturamento({
      periodo: longo,
      tipo: "anterior",
      comparacao: periodoDeComparacao("anterior", longo),
      vendas: [
        { paidAt: sp("2026-01-01"), netTotal: 1 },
        { paidAt: sp("2026-01-07"), netTotal: 2 },
        { paidAt: sp("2026-01-08"), netTotal: 4 },
        { paidAt: sp("2026-04-10"), netTotal: 8 },
      ],
      vendasComparadas: [],
    });
    const g = montarGrafico(d, "dia");
    expect(g.porSemana).toBe(true);
    expect(g.pontos).toHaveLength(15);
    expect(g.pontos[0]).toMatchObject({ de: "2026-01-01", ate: "2026-01-07", atual: 3, pedidos: 2 });
    expect(g.pontos[1]).toMatchObject({ de: "2026-01-08", ate: "2026-01-14", atual: 4 });
    // a última semana é mais curta e termina no fim do período
    expect(g.pontos[14]).toMatchObject({ de: "2026-04-09", ate: "2026-04-10", atual: 8 });
    expect(agruparPorSemana([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([28, 8]);
    expect(acumular([1, 2, 3])).toEqual([1, 3, 6]);
  });
  it("a frase da comparação diz o tipo e as datas", () => {
    expect(fraseDaComparacao(dados.comparacao)).toBe("período anterior · 28/10/2026 a 31/10/2026");
    expect(fraseDaComparacao({ tipo: "ano-passado", periodo: { de: "2025-11-01", ate: "2025-11-04" } })).toBe(
      "mesmo período do ano passado · 01/11/2025 a 04/11/2025"
    );
    expect(fraseDaComparacao({ tipo: "personalizado", periodo: { de: "2026-10-01", ate: "2026-10-01" } })).toBe("de 01/10/2026");
  });
});

describe("os parâmetros da porta", () => {
  it("lê o que vale e recusa o torto", () => {
    expect(lerParametros({ de: "2026-11-01", ate: "2026-11-04" })).toEqual({
      periodo: { de: "2026-11-01", ate: "2026-11-04" },
      tipo: "anterior",
      cmpDe: null,
    });
    expect(lerParametros({ de: "2026-11-01", ate: "2026-11-04", tipo: "personalizado", cmpDe: "2026-10-01" })).toEqual({
      periodo: { de: "2026-11-01", ate: "2026-11-04" },
      tipo: "personalizado",
      cmpDe: "2026-10-01",
    });
    expect(lerParametros({ de: "2026-11-04", ate: "2026-11-01" })).toBeNull();
    expect(lerParametros({ de: "2026-02-30", ate: "2026-03-01" })).toBeNull();
    expect(lerParametros({ de: "2026-11-01", ate: "2026-11-04", tipo: "mes-passado" })).toBeNull();
    expect(lerParametros({ de: "2026-11-01", ate: "2026-11-04", tipo: "personalizado" })).toBeNull();
    expect(lerParametros({ de: null, ate: null })).toBeNull();
  });
  it("o endereço leva os parâmetros, e só o cmpDe quando é outra data", () => {
    expect(enderecoDaPorta({ periodo: { de: "2026-11-01", ate: "2026-11-04" }, tipo: "ano-passado", cmpDe: null })).toBe(
      "/api/dashboard/faturamento?de=2026-11-01&ate=2026-11-04&tipo=ano-passado"
    );
    expect(enderecoDaPorta({ periodo: { de: "2026-11-01", ate: "2026-11-04" }, tipo: "personalizado", cmpDe: "2026-10-01" })).toBe(
      "/api/dashboard/faturamento?de=2026-11-01&ate=2026-11-04&tipo=personalizado&cmpDe=2026-10-01"
    );
  });
});

describe("o dia inteiro de São Paulo", () => {
  it("começa às 03:00 UTC e termina 1 ms antes do dia seguinte", () => {
    expect(inicioDoDiaSP("2026-11-04")?.toISOString()).toBe("2026-11-04T03:00:00.000Z");
    expect(fimDoDiaSP("2026-11-04")?.toISOString()).toBe("2026-11-05T02:59:59.999Z");
  });
});

describe("a porta /api/dashboard/faturamento", () => {
  const gerente = { id: "u-g", companyId: "loja-1", role: "MANAGER", name: "Gi", email: "g@x" } as unknown as SessionUser;
  const vendedora = { id: "u-ana", companyId: "loja-1", role: "SELLER", name: "Ana", email: "ana@x" } as unknown as SessionUser;

  beforeEach(() => {
    estado.user = gerente as unknown as Record<string, unknown>;
    estado.consultas = [];
    estado.vendas = [
      { netTotal: 100, paidAt: sp("2026-11-01"), sellerId: "u-ana" },
      { netTotal: 300, paidAt: sp("2026-11-03", "23:50"), sellerId: "u-bia" },
      { netTotal: 400, paidAt: sp("2026-10-28"), sellerId: "u-ana" },
      { netTotal: 70, paidAt: sp("2025-11-02"), sellerId: null },
    ];
  });

  async function chamar(query: string) {
    const { GET } = await import("@/app/api/dashboard/faturamento/route");
    const r = await GET(new Request(`http://x/api/dashboard/faturamento?${query}`));
    return { status: r.status, corpo: await r.json() };
  }

  it("devolve as duas séries pela régua do dinheiro: pago, pela data do pagamento, netTotal, dias inteiros de SP", async () => {
    const { status, corpo } = await chamar("de=2026-11-01&ate=2026-11-04");
    expect(status).toBe(200);
    expect(corpo.periodo).toEqual({ de: "2026-11-01", ate: "2026-11-04", dias: 4 });
    expect(corpo.comparacao).toEqual({ tipo: "anterior", periodo: { de: "2026-10-28", ate: "2026-10-31" } });
    expect(corpo.atual.valores).toEqual([100, 0, 300, 0]);
    expect(corpo.comparado.valores).toEqual([400, 0, 0, 0]);
    expect(estado.consultas).toHaveLength(2);
    for (const q of estado.consultas) {
      expect(q.where.companyId).toBe("loja-1");
      expect(q.where.status).toEqual({ in: PAID_ORDER_STATUSES });
      expect(q.select).toEqual({ netTotal: true, sellerId: true, paidAt: true });
    }
    const atual = estado.consultas[0].where.paidAt as { gte: Date; lte: Date };
    expect(atual.gte.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(atual.lte.toISOString()).toBe("2026-11-05T02:59:59.999Z");
  });
  it("ano passado e outra data mudam só o comparado", async () => {
    const ano = await chamar("de=2026-11-01&ate=2026-11-04&tipo=ano-passado");
    expect(ano.corpo.comparacao.periodo).toEqual({ de: "2025-11-01", ate: "2025-11-04" });
    expect(ano.corpo.comparado.valores).toEqual([0, 70, 0, 0]);
    const outra = await chamar("de=2026-11-01&ate=2026-11-04&tipo=personalizado&cmpDe=2026-10-27");
    expect(outra.corpo.comparacao.periodo).toEqual({ de: "2026-10-27", ate: "2026-10-30" });
    expect(outra.corpo.comparado.valores).toEqual([0, 400, 0, 0]);
  });
  it("um período gigante vai ao banco preso ao teto, nos dois lados", async () => {
    const { status, corpo } = await chamar("de=1990-01-01&ate=2026-11-04");
    expect(status).toBe(200);
    expect(corpo.cortado).toBe(true);
    const atual = estado.consultas[0].where.paidAt as { gte: Date; lte: Date };
    const dias = Math.round((atual.lte.getTime() - atual.gte.getTime()) / 86_400_000);
    expect(dias).toBe(TETO_DIAS_GRAFICO);
    const comparado = estado.consultas[1].where.paidAt as { gte: Date; lte: Date };
    expect(Math.round((comparado.lte.getTime() - comparado.gte.getTime()) / 86_400_000)).toBe(TETO_DIAS_GRAFICO);
  });
  it("a vendedora recebe só as vendas dela (RN-007) — pela sessão, nunca pela URL", async () => {
    estado.user = vendedora as unknown as Record<string, unknown>;
    const { corpo } = await chamar("de=2026-11-01&ate=2026-11-04&companyId=loja-2&sellerId=u-bia");
    expect(estado.consultas[0].where).toMatchObject({ companyId: "loja-1", sellerId: "u-ana" });
    expect(corpo.atual.valores).toEqual([100, 0, 300, 0]); // o banco de mentira não recorta; a cláusula sim
  });
  it("torto é 400, sem sessão é 401, suporte e Super Admin fora da loja são 403", async () => {
    expect((await chamar("de=2026-11-04&ate=2026-11-01")).status).toBe(400);
    expect((await chamar("de=2026-11-01&ate=2026-11-04&tipo=personalizado")).status).toBe(400);
    estado.user = null;
    expect((await chamar("de=2026-11-01&ate=2026-11-04")).status).toBe(401);
    estado.user = { ...gerente, role: "SUPPORT" } as unknown as Record<string, unknown>;
    expect((await chamar("de=2026-11-01&ate=2026-11-04")).status).toBe(403);
    estado.user = { ...gerente, role: "SUPERADMIN" } as unknown as Record<string, unknown>;
    expect((await chamar("de=2026-11-01&ate=2026-11-04")).status).toBe(403);
    estado.user = { ...gerente, role: "SUPERADMIN", impersonatedBy: "sa" } as unknown as Record<string, unknown>;
    expect((await chamar("de=2026-11-01&ate=2026-11-04")).status).toBe(200);
  });
});
