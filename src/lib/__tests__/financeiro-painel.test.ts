import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agruparCauda,
  janelaDoMes,
  montarCurva,
  montarIndicador,
  montarResultado,
  pontoMaisBaixo,
  projecao,
  variacao,
  HORIZONTES,
  type LinhaDaCurva,
} from "../financeiro/painel";
import { janelaPadraoDaConciliacao } from "../financeiro/conciliacao-tela";
import { avaliarSaude, MAXIMO_POR_SINAL, rotuloDaNota } from "../financeiro/saude";
import { marcasDoEixo, valorCurto } from "../financeiro/eixo";

/**
 * O PAINEL DO FINANCEIRO (RN-035, redesenho de 05/09/2026): a nota de saúde,
 * a curva prevista, o resumo do mês e as projeções. As CONSULTAS são provadas
 * no cenário ponta a ponta contra o Postgres; aqui ficam as MONTAGENS puras —
 * é nelas que moram as regras ("o atrasado cai em hoje", "fevereiro para no
 * último", "sem base é não ter movimento").
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/* ---- saúde ---------------------------------------------------------------- */

const base = {
  saldoHoje: 5000,
  aPagar7: 1000,
  aReceber30: 4000,
  aPagar30: 3000,
  atrasado: 0,
  aReceberEmAberto: 6000,
  entradasMes: 8000,
  saidasMes: 5000,
};

describe("a nota de saúde financeira (RN-035)", () => {
  it("é a soma de QUATRO sinais de 25, com frase em português em cada um", () => {
    const s = avaliarSaude(base);
    expect(s.sinais).toHaveLength(4);
    expect(s.sinais.every((x) => x.maximo === MAXIMO_POR_SINAL)).toBe(true);
    expect(s.nota).toBe(s.sinais.reduce((t, x) => t + x.pontos, 0));
    expect(s.nota).toBe(100);
    expect(s.rotulo).toBe("Saudável");
    for (const x of s.sinais) expect(x.frase.length).toBeGreaterThan(10);
  });

  it("saldo negativo zera o sinal da semana e diz o valor", () => {
    const s = avaliarSaude({ ...base, saldoHoje: -300 });
    expect(s.sinais[0].pontos).toBe(0);
    expect(s.sinais[0].frase).toContain("negativo");
    expect(s.sinais[0].tom).toBe("ruim");
  });

  it("o saldo que cobre só metade da semana vale metade e aponta o caminho", () => {
    const s = avaliarSaude({ ...base, saldoHoje: 600, aPagar7: 1000 });
    expect(s.sinais[0].pontos).toBe(12);
    expect(s.sinais[0].frase).toContain("60%");
    const pior = avaliarSaude({ ...base, saldoHoje: 100, aPagar7: 1000 });
    expect(pior.sinais[0].pontos).toBe(0);
    expect(pior.sinais[0].frase).toContain("Faltam");
  });

  it("os 30 dias: folga de 20% vale cheio; cobrir sem folga vale menos; não cobrir zera", () => {
    expect(avaliarSaude({ ...base, saldoHoje: 0, aReceber30: 3600, aPagar30: 3000 }).sinais[1].pontos).toBe(25);
    expect(avaliarSaude({ ...base, saldoHoje: 0, aReceber30: 3100, aPagar30: 3000 }).sinais[1].pontos).toBe(18);
    expect(avaliarSaude({ ...base, saldoHoje: 0, aReceber30: 2500, aPagar30: 3000 }).sinais[1].pontos).toBe(10);
    const ruim = avaliarSaude({ ...base, saldoHoje: 0, aReceber30: 1000, aPagar30: 3000 });
    expect(ruim.sinais[1].pontos).toBe(0);
    expect(ruim.sinais[1].frase).toContain("Faltam");
    // nada a pagar: 25 se o saldo não está negativo
    expect(avaliarSaude({ ...base, aPagar30: 0 }).sinais[1].pontos).toBe(25);
    expect(avaliarSaude({ ...base, saldoHoje: -1, aReceber30: 0, aPagar30: 0 }).sinais[1].pontos).toBe(0);
  });

  it("o atraso é medido como PARTE do que há para receber, não em reais", () => {
    // R$ 250 atrasados numa loja com R$ 6.000 a receber é pouco…
    expect(avaliarSaude({ ...base, atrasado: 250 }).sinais[2].pontos).toBe(20);
    // …e numa loja com R$ 600 é grave
    const grave = avaliarSaude({ ...base, atrasado: 250, aReceberEmAberto: 600 });
    expect(grave.sinais[2].pontos).toBe(0);
    expect(grave.sinais[2].frase).toContain("cobrar");
    expect(avaliarSaude({ ...base, atrasado: 600, aReceberEmAberto: 6000 }).sinais[2].pontos).toBe(12);
    expect(avaliarSaude({ ...base, atrasado: 1500, aReceberEmAberto: 6000 }).sinais[2].pontos).toBe(5);
    // sem atraso, cheio — mesmo sem nada a receber
    expect(avaliarSaude({ ...base, atrasado: 0, aReceberEmAberto: 0 }).sinais[2].pontos).toBe(25);
  });

  it("o resultado do mês: entrou mais do que saiu vale cheio; mês sem movimento fica no meio", () => {
    expect(avaliarSaude(base).sinais[3].pontos).toBe(25);
    expect(avaliarSaude({ ...base, entradasMes: 5100, saidasMes: 5000 }).sinais[3].pontos).toBe(18);
    expect(avaliarSaude({ ...base, entradasMes: 4600, saidasMes: 5000 }).sinais[3].pontos).toBe(10);
    const ruim = avaliarSaude({ ...base, entradasMes: 2000, saidasMes: 5000 });
    expect(ruim.sinais[3].pontos).toBe(0);
    expect(ruim.sinais[3].frase).toContain("Para onde foi o dinheiro");
    const vazio = avaliarSaude({ ...base, entradasMes: 0, saidasMes: 0 });
    expect(vazio.sinais[3].pontos).toBe(12);
    expect(vazio.sinais[3].frase).toContain("Ainda não houve movimento");
    // só entrou: cheio
    expect(avaliarSaude({ ...base, entradasMes: 300, saidasMes: 0 }).sinais[3].pontos).toBe(25);
  });

  it("os rótulos da nota", () => {
    expect(rotuloDaNota(100)).toEqual({ rotulo: "Saudável", tom: "bom" });
    expect(rotuloDaNota(80)).toEqual({ rotulo: "Saudável", tom: "bom" });
    expect(rotuloDaNota(79).rotulo).toBe("Atenção");
    expect(rotuloDaNota(60).rotulo).toBe("Atenção");
    expect(rotuloDaNota(59).rotulo).toBe("Apertada");
    expect(rotuloDaNota(39)).toEqual({ rotulo: "Crítica", tom: "ruim" });
    expect(rotuloDaNota(0).tom).toBe("ruim");
  });
});

/* ---- a curva -------------------------------------------------------------- */

const HOJE = "2026-09-15";

describe("a curva prevista (RN-035)", () => {
  it("os horizontes são 30, 60 e 90 dias, em ordem", () => {
    expect([...HORIZONTES]).toEqual([30, 60, 90]);
  });

  it("um ponto por dia, de hoje até o horizonte, partindo do saldo de hoje", () => {
    const c = montarCurva([], 1000, HOJE, 10);
    expect(c.pontos).toHaveLength(11);
    expect(c.pontos[0].dia).toBe("2026-09-15");
    expect(c.pontos[10].dia).toBe("2026-09-25");
    expect(c.pontos.every((p) => p.saldo === 1000 && p.entra === 0 && p.sai === 0)).toBe(true);
  });

  it("o que vence em cada dia entra no dia, e o saldo acumula", () => {
    const linhas: LinhaDaCurva[] = [
      { dia: "2026-09-17", tipo: "RECEITA", falta: 500 },
      { dia: "2026-09-17", tipo: "DESPESA", falta: 200 },
      { dia: "2026-09-20", tipo: "DESPESA", falta: 900 },
    ];
    const c = montarCurva(linhas, 100, HOJE, 10);
    expect(c.pontos[2]).toMatchObject({ dia: "2026-09-17", entra: 500, sai: 200, entraAcum: 500, saiAcum: 200, saldo: 400 });
    expect(c.pontos[5]).toMatchObject({ dia: "2026-09-20", sai: 900, saiAcum: 1100, saldo: -500 });
    expect(c.pontos[10].saldo).toBe(-500);
  });

  it("o atrasado cai em HOJE — mesmo que a linha venha com o dia no passado", () => {
    const c = montarCurva(
      [
        { dia: "2026-09-01", tipo: "RECEITA", falta: 250 },
        { dia: "2026-09-15", tipo: "RECEITA", falta: 50 },
      ],
      0,
      HOJE,
      5
    );
    expect(c.pontos[0].entra).toBe(300);
    expect(c.pontos[0].saldo).toBe(300);
  });

  it("linha além do horizonte fica de fora, e o centavo não some", () => {
    const c = montarCurva(
      [
        { dia: "2026-09-30", tipo: "RECEITA", falta: 999 },
        { dia: "2026-09-16", tipo: "RECEITA", falta: 0.1 },
        { dia: "2026-09-16", tipo: "RECEITA", falta: 0.2 },
      ],
      0,
      HOJE,
      5
    );
    expect(c.pontos[1].entra).toBe(0.3);
    expect(c.pontos[5].entraAcum).toBe(0.3);
  });

  it("a projeção de N dias é o ponto N da curva, com a diferença contra hoje e a cobertura", () => {
    const c = montarCurva(
      [
        { dia: "2026-09-17", tipo: "RECEITA", falta: 50 },
        { dia: "2026-09-20", tipo: "DESPESA", falta: 200 },
      ],
      100,
      HOJE,
      10
    );
    expect(projecao(c, 5)).toMatchObject({ dias: 5, ate: "2026-09-20", saldo: -50, aReceber: 50, aPagar: 200, diferenca: -150, cobertura: 75 });
    // antes da despesa: nada a pagar → 100%
    expect(projecao(c, 3).cobertura).toBe(100);
    // pedir além da curva devolve o último ponto (nunca estoura)
    expect(projecao(c, 999).ate).toBe("2026-09-25");
    // teto de 200%: o número é para ler, não para auditar
    expect(projecao({ ...c, saldoHoje: 100_000 }, 10).cobertura).toBe(200);
  });

  it("o dia mais apertado é o de menor saldo; curva vazia não quebra", () => {
    const c = montarCurva([{ dia: "2026-09-20", tipo: "DESPESA", falta: 900 }], 100, HOJE, 10);
    expect(pontoMaisBaixo(c.pontos)?.dia).toBe("2026-09-20");
    expect(pontoMaisBaixo([])).toBeNull();
  });
});

/* ---- o resumo do mês ------------------------------------------------------ */

describe("a janela do resumo do mês (RN-035)", () => {
  // 15/09/2026 às 14h em São Paulo
  const j = janelaDoMes(new Date("2026-09-15T17:00:00.000Z"));

  it("este mês até hoje, e o mês anterior até o MESMO dia", () => {
    expect(j).toMatchObject({ hojeDia: "2026-09-15", diaHoje: 15, prefixoMes: "2026-09", prefixoAnt: "2026-08", diaDaComparacao: 15, mes: "setembro", mesAnterior: "agosto" });
    expect(j.inicioAnt.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(j.ateHoje.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("os pedidos comparam o MESMO tanto de relógio, a partir das 00h de São Paulo", () => {
    expect(j.inicioMesSP.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(j.inicioAntSP.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    // 14 dias e 14 horas depois do início, nos dois meses
    expect(j.fimMesSP.getTime() - j.inicioMesSP.getTime()).toBe(j.fimAntSP.getTime() - j.inicioAntSP.getTime());
    expect(j.fimAntSP.toISOString()).toBe("2026-08-15T17:00:00.000Z");
  });

  it("fevereiro para no último dia — nas baixas E nos pedidos", () => {
    // 30/03: o mesmo trecho de fevereiro é o mês inteiro, e NÃO invade março
    const marco = janelaDoMes(new Date("2026-03-30T13:00:00.000Z"));
    expect(marco.diaDaComparacao).toBe(28);
    expect(marco.mesAnterior).toBe("fevereiro");
    expect(marco.fimAntSP.getTime()).toBeLessThan(marco.inicioMesSP.getTime());
    expect(marco.fimAntSP.toISOString()).toBe("2026-03-01T02:59:59.999Z");
    // 31/05 vs. abril (30 dias): mesma trava
    const maio = janelaDoMes(new Date("2026-05-31T20:00:00.000Z"));
    expect(maio.diaDaComparacao).toBe(30);
    expect(maio.fimAntSP.toISOString()).toBe("2026-05-01T02:59:59.999Z");
  });

  it("janeiro compara com dezembro do ano anterior", () => {
    const jan = janelaDoMes(new Date("2027-01-10T15:00:00.000Z"));
    expect(jan.prefixoAnt).toBe("2026-12");
    expect(jan.mesAnterior).toBe("dezembro");
    expect(jan.inicioAntSP.toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });

  it("de madrugada em UTC ainda é ONTEM em São Paulo", () => {
    // 05/09 01:00Z = 04/09 22:00 em SP
    expect(janelaDoMes(new Date("2026-09-05T01:00:00.000Z")).hojeDia).toBe("2026-09-04");
  });
});

describe("os indicadores do resumo (RN-035)", () => {
  const j = janelaDoMes(new Date("2026-09-15T17:00:00.000Z"));

  it("distribui os movimentos nas duas séries e compara os totais", () => {
    const ind = montarIndicador(
      [
        { dia: "2026-09-02", valor: 410 },
        { dia: "2026-09-03", valor: 250 },
        { dia: "2026-08-03", valor: 300 },
        // depois do dia 15 do mês anterior: fora da comparação
        { dia: "2026-08-28", valor: 5000 },
        // outro mês: fora
        { dia: "2026-07-10", valor: 999 },
      ],
      j
    );
    expect(ind.serie).toHaveLength(15);
    expect(ind.serie[1]).toBe(410);
    expect(ind.serie[2]).toBe(250);
    expect(ind.atual).toBe(660);
    expect(ind.serieAnterior).toHaveLength(15);
    expect(ind.anterior).toBe(300);
    expect(ind.temBase).toBe(true);
    expect(ind.variacao).toBe(120);
  });

  it("dois movimentos no mesmo dia somam sem perder centavo", () => {
    const ind = montarIndicador([{ dia: "2026-09-10", valor: 0.1 }, { dia: "2026-09-10", valor: 0.2 }], j);
    expect(ind.serie[9]).toBe(0.3);
    expect(ind.atual).toBe(0.3);
  });

  it("sem NENHUM movimento no trecho anterior não há base — nem variação", () => {
    const ind = montarIndicador([{ dia: "2026-09-02", valor: 100 }], j);
    expect(ind.temBase).toBe(false);
    expect(ind.anterior).toBeNull();
    expect(ind.variacao).toBeNull();
  });

  it("o resultado com PREJUÍZO no mês anterior TEM base (não é 'sem base')", () => {
    const entradas = montarIndicador([{ dia: "2026-08-03", valor: 1000 }, { dia: "2026-09-02", valor: 900 }], j);
    const saidas = montarIndicador([{ dia: "2026-08-04", valor: 1500 }, { dia: "2026-09-03", valor: 100 }], j);
    const r = montarResultado(entradas, saidas);
    expect(r.atual).toBe(800);
    expect(r.anterior).toBe(-500);
    expect(r.temBase).toBe(true);
    // e nunca tem variação % (negativo dos dois lados confunde)
    expect(r.variacao).toBeNull();
    expect(r.serie[1]).toBe(900);
    expect(r.serie[2]).toBe(-100);
    // sem movimento nenhum lá: aí sim sem base
    const vazio = montarResultado(montarIndicador([], j), montarIndicador([], j));
    expect(vazio.temBase).toBe(false);
    expect(vazio.anterior).toBeNull();
  });

  it("a variação % só existe com base positiva", () => {
    expect(variacao(660, 300)).toBe(120);
    expect(variacao(150, 300)).toBe(-50);
    expect(variacao(300, 300)).toBe(0);
    expect(variacao(100, 0)).toBeNull();
    expect(variacao(100, null)).toBeNull();
    expect(variacao(100, -5)).toBeNull();
  });

  it("as fatias além das N maiores viram 'Outras'; cabendo todas, nada muda", () => {
    const fatias = [
      { nome: "Aluguel", valor: 500 },
      { nome: "Salários", valor: 400 },
      { nome: "Tecido", valor: 300 },
      { nome: "Energia", valor: 30 },
      { nome: "Água", valor: 20 },
    ];
    expect(agruparCauda(fatias, 5)).toEqual(fatias);
    const dobradas = agruparCauda(fatias, 3);
    expect(dobradas).toHaveLength(4);
    expect(dobradas[3]).toEqual({ nome: "Outras", valor: 50 });
    // centavo não some na dobra
    expect(agruparCauda([{ nome: "a", valor: 1 }, { nome: "b", valor: 0.1 }, { nome: "c", valor: 0.2 }], 1)[1].valor).toBe(0.3);
  });
});

/* ---- as consultas (o que só o banco prova, guardado pelo texto) ---------- */

describe("as consultas do painel (RN-035)", () => {
  const motor = ler("src/lib/financeiro/painel.ts");

  it("o ticket é pelo valor VENDIDO de pedido pago (RN-001/RN-002)", () => {
    expect(motor).toContain("status: { in: PAID_ORDER_STATUSES }");
    expect(motor).toContain("_avg: { netTotal: true }");
    expect(motor).not.toMatch(/_avg: \{ total: true \}/);
  });

  it("o dinheiro segue a régua do extrato: baixa viva, lançamento não cancelado", () => {
    expect(motor).toContain("estornadaEm: null");
    expect(motor).toContain("canceladoEm: null");
    expect(motor).toContain('AND b."estornadaEm" IS NULL');
    expect(motor).toContain('AND l."canceladoEm" IS NULL');
  });

  it("a curva soma no banco com o atrasado em HOJE e só a baixa que já está na conta", () => {
    expect(motor).toContain('GREATEST(p."vencimento", ${hojeDia})');
    expect(motor).toContain('AND b."data" <= ${hojeDia}');
  });

  it("a pendência do banco é a MESMA conta e a MESMA janela da tela de conferir", () => {
    const tela = ler("src/app/(app)/financeiro/conciliacao/page.tsx");
    for (const arq of [motor, tela]) {
      expect(arq).toContain("janelaPadraoDaConciliacao(");
      expect(arq).toContain('orderBy: [{ padrao: "desc" }, { nome: "asc" }]');
    }
    // "últimos 3 meses" = este e os dois anteriores, desde o dia 1
    expect(janelaPadraoDaConciliacao("2026-09-15")).toEqual({ de: "2026-07-01", ate: "2026-09-15" });
    expect(janelaPadraoDaConciliacao("2026-02-10")).toEqual({ de: "2025-12-01", ate: "2026-02-10" });
  });
});

/* ---- a tela --------------------------------------------------------------- */

describe("a tela do painel (RN-035)", () => {
  const painel = ler("src/app/(app)/financeiro/_visao/painel.tsx");

  it("o saldo de hoje tem UM caminho, e a curva parte dele", () => {
    expect(painel).toContain("contas.reduce((s, c) => s + c.saldo, 0)");
    expect(painel).toContain("montarCurva(linhasCurva, saldoHoje, hojeDia)");
    // conta arquivada com dinheiro continua na lista (as linhas fecham com o card)
    expect(painel).toContain("!c.arquivada || c.saldo !== 0");
  });

  it("a consulta da curva vai JUNTO das outras (não é uma ida a mais ao banco)", () => {
    const bloco = painel.slice(painel.indexOf("await Promise.all(["), painel.indexOf("]);", painel.indexOf("await Promise.all([")));
    expect(bloco).toContain("linhasDaCurva(companyId, hoje)");
    expect(bloco).toContain("pendenciaDoBanco(companyId, hoje)");
  });

  it("a nota é calculada com os números que a tela já mostra", () => {
    expect(painel).toContain("avaliarSaude({");
    expect(painel).toContain("atrasado: inad.total");
    expect(painel).toContain("entradasMes: resumo.entradas.atual");
  });

  it("em 'Saídas', subir é ruim — o selo sabe a direção", () => {
    expect(painel).toMatch(/rotulo=\{`Saídas em \$\{resumo\.mes\}`\}[\s\S]*?subirEhBom=\{false\}/);
  });

  it("'Vence hoje' leva para o lado que tem dinheiro vencendo", () => {
    expect(painel).toContain('pagaHoje > venceHoje ? "/financeiro/contas-a-pagar" : "/financeiro/contas-a-receber"');
  });

  it("a página aceita só os horizontes da curva e cai em 30", () => {
    const pagina = ler("src/app/(app)/financeiro/page.tsx");
    expect(pagina).toContain("(HORIZONTES as readonly number[]).includes(bruto) ? bruto : 30");
  });

  it("a cauda do donut é cinza de propósito e as fatias com nome usam a paleta validada", () => {
    expect(painel).toContain('f.nome === "Outras" ? "#94a3b8"');
    expect(painel).toContain('["#c4622d", "#2a78d6", "#1baf7a", "#eda100", "#4a3aa7"]');
  });
});

/* ---- os gráficos ---------------------------------------------------------- */

describe("os eixos dos gráficos", () => {
  it("as marcas do eixo são redondas e sempre incluem o zero", () => {
    expect(marcasDoEixo(7188, 31200)).toEqual([0, 10000, 20000, 30000, 40000]);
    expect(marcasDoEixo(-500, 400)).toEqual([-500, -250, 0, 250, 500]);
    // tudo positivo: começa no zero
    expect(marcasDoEixo(100, 120)[0]).toBe(0);
    // curva chapada no zero (loja sem conta) ainda desenha um eixo legível
    expect(marcasDoEixo(0, 0)).toEqual([0, 25, 50, 75, 100]);
  });

  it("o valor curto do eixo", () => {
    expect(valorCurto(0)).toBe("R$ 0");
    expect(valorCurto(950)).toBe("R$ 950");
    expect(valorCurto(1500)).toBe("R$ 1,5 mil");
    expect(valorCurto(12300)).toBe("R$ 12 mil");
    expect(valorCurto(-20000)).toBe("−R$ 20 mil");
    expect(valorCurto(2_500_000)).toBe("R$ 2,5 mi");
  });
});
