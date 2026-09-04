// Guarda RN-036
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grupoDFCdoCodigo } from "../financeiro/dfc-tipos";
import {
  acumularSaldo,
  blocoDREdoCodigo,
  mesDoPrevisto,
  mesesEntre,
  raizDoCodigo,
  rotuloDoMes,
  DRE_LABEL,
  MODO_FLUXO_LABEL,
} from "../financeiro/relatorios-tipos";

/**
 * RN-036 · DRE e Fluxo de Caixa respondem perguntas DIFERENTES: "deu lucro?"
 * (por competência) e "tem dinheiro?" (pela data do dinheiro). Investimento
 * entra no caixa e fica fora do resultado.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("em que linha do DRE cada categoria entra (RN-036)", () => {
  it("venda é receita, venha de onde vier", () => {
    for (const c of ["01", "01.01", "01.03", "02.01"]) {
      expect(blocoDREdoCodigo(c, "RECEITA")).toBe("RECEITA");
    }
  });

  it("tecido, facção e mercadoria são CUSTO — é o que forma a margem", () => {
    for (const c of ["03", "03.01", "03.02", "03.03"]) {
      expect(blocoDREdoCodigo(c, "DESPESA")).toBe("CUSTO");
    }
  });

  it("comissão e frete são despesa de venda; aluguel é administrativa", () => {
    expect(blocoDREdoCodigo("04.01", "DESPESA")).toBe("DESPESA_VENDAS");
    expect(blocoDREdoCodigo("04.02", "DESPESA")).toBe("DESPESA_VENDAS");
    expect(blocoDREdoCodigo("05.01", "DESPESA")).toBe("DESPESA_ADMIN");
    expect(blocoDREdoCodigo("06.02", "DESPESA")).toBe("DESPESA_FINANCEIRA");
  });

  it("INVESTIMENTO fica FORA do resultado (máquina não é prejuízo)", () => {
    // comprar uma máquina de R$ 8.000 tira dinheiro do caixa mas não é
    // despesa do mês — somá-la faria um mês bom parecer desastre
    expect(blocoDREdoCodigo("07", "DESPESA")).toBeNull();
    expect(blocoDREdoCodigo("07.01", "DESPESA")).toBeNull();
    // e a tela DIZ que ficou de fora, com o valor
    const tela = ler("src/app/(app)/financeiro/dre/dre-view.tsx");
    expect(tela).toContain("dre.totais.investimento");
    expect(tela).toContain("não é prejuízo");
  });

  it("categoria criada pela loja entra pelo TIPO, nunca some do relatório", () => {
    expect(blocoDREdoCodigo("09.03", "RECEITA")).toBe("RECEITA");
    expect(blocoDREdoCodigo("09.03", "DESPESA")).toBe("DESPESA_ADMIN");
    expect(blocoDREdoCodigo(null, "DESPESA")).toBe("DESPESA_ADMIN");
    expect(blocoDREdoCodigo(undefined, "RECEITA")).toBe("RECEITA");
  });

  it("venda com código 07 continua sendo RECEITA (o tipo manda)", () => {
    // a loja pode ter criado uma categoria de receita que ficou com o código
    // "07" — tratá-la como investimento tiraria a venda do resultado
    expect(blocoDREdoCodigo("07", "RECEITA")).toBe("RECEITA");
    expect(blocoDREdoCodigo("07.02", "RECEITA")).toBe("RECEITA");
  });

  it("os blocos têm nome em português para a lojista", () => {
    for (const t of Object.values(DRE_LABEL)) expect(t.length).toBeGreaterThan(6);
    for (const t of Object.values(MODO_FLUXO_LABEL)) expect(t).toMatch(/[a-z]/);
  });
});

describe("as colunas de mês (RN-036)", () => {
  it("lista os meses entre as duas pontas, inclusive", () => {
    expect(mesesEntre("2026-07", "2026-10")).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  it("vira o ano sem tropeçar", () => {
    expect(mesesEntre("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("um mês só é um mês só; ponta invertida não devolve nada", () => {
    expect(mesesEntre("2026-09", "2026-09")).toEqual(["2026-09"]);
    expect(mesesEntre("2026-09", "2026-07")).toEqual([]);
  });

  it("tem teto de 24 colunas — relatório de 10 anos não cabe na tela", () => {
    expect(mesesEntre("2016-01", "2026-01")).toHaveLength(24);
  });

  it("o rótulo é curto, do jeito que cabe na coluna", () => {
    expect(rotuloDoMes("2026-09")).toBe("set/2026");
    expect(rotuloDoMes("2026-01")).toBe("jan/2026");
    expect(rotuloDoMes("2026-12")).toBe("dez/2026");
  });
});

describe("as duas contas não se misturam (RN-036)", () => {
  const motor = ler("src/lib/financeiro/relatorios.ts");

  it("o DRE lê a COMPETÊNCIA (a venda de agosto é resultado de agosto)", () => {
    expect(motor).toContain("competencia: { gte: de, lte: ate }");
    expect(motor).toContain("canceladoEm: null");
  });

  it("o fluxo lê a DATA DO DINHEIRO (baixa) e o vencimento do que falta", () => {
    expect(motor).toContain("db.finBaixa.findMany");
    expect(motor).toContain("data: { gte: de, lte: ate }");
    expect(motor).toContain("estornadaEm: null");
    expect(motor).toContain("vencimento: { gte: de, lte: ate }");
    // do previsto entra só o que FALTA — o já pago já entrou pelo realizado
    expect(motor).toContain("const falta = saldoDaParcela(p);");
    expect(motor).toContain("if (falta <= 0) continue;");
  });

  it("o atrasado é filtrado NO BANCO, para o teto não se gastar com quitadas", () => {
    // trazer 5.000 vencidas e só então descartar as pagas deixaria a
    // duplicata realmente aberta fora do mês corrente
    expect(motor).toContain('SELECT SUM(b."valor") FROM "FinBaixa" b');
    expect(motor).toContain("TETO_ATRASADO");
  });

  it("o saldo do primeiro mês parte do saldo REAL da loja", () => {
    // (o acumulado mês a mês é testado por comportamento em `acumularSaldo`)
    expect(motor).toContain("saldoAte(companyId, null, new Date(de.getTime() - 1))");
    expect(motor).toContain("acumularSaldo(");
  });

  it("as telas do relatório são gated como toda porta do módulo (RN-029)", () => {
    for (const p of [
      "src/app/(app)/financeiro/dre/page.tsx",
      "src/app/(app)/financeiro/fluxo-de-caixa/page.tsx",
    ]) {
      const tela = ler(p);
      // a porteira de tela já traz as DUAS chaves (papel + módulo); a
      // varredura de todas as páginas mora em financeiro-cadastros.test.ts
      expect(tela).toContain("porteiraFinanceiroTela");
    }
  });
});

describe("em que mês cada previsão entra (RN-036)", () => {
  const HOJE = "2026-09";

  it("no recorte realizado não existe previsão nenhuma", () => {
    expect(mesDoPrevisto("2026-08", HOJE, "realizado")).toBeNull();
    expect(mesDoPrevisto("2026-12", HOJE, "realizado")).toBeNull();
  });

  it("no recorte previsto, cada conta cai no mês em que vence", () => {
    expect(mesDoPrevisto("2026-07", HOJE, "previsto")).toBe("2026-07");
    expect(mesDoPrevisto("2026-12", HOJE, "previsto")).toBe("2026-12");
  });

  it("no misto, o futuro vale pelo vencimento e o mês em curso também", () => {
    expect(mesDoPrevisto("2026-10", HOJE, "misto")).toBe("2026-10");
    expect(mesDoPrevisto(HOJE, HOJE, "misto")).toBe(HOJE);
  });

  it("no misto, a conta ATRASADA cai no mês corrente — nunca some", () => {
    // ela venceu no passado, mas o dinheiro ainda vai andar: o mês em que a
    // loja corre atrás é este (mesma régua do saldo previsto, RN-035)
    expect(mesDoPrevisto("2026-08", HOJE, "misto")).toBe(HOJE);
    expect(mesDoPrevisto("2025-02", HOJE, "misto")).toBe(HOJE);
  });
});

describe("o saldo mês a mês do fluxo (RN-036)", () => {
  const zeros = (n: number) => new Array(n).fill(0);

  it("começa no saldo real e cada mês termina onde o seguinte começa", () => {
    const s = acumularSaldo(1000, [200, -500, 300], zeros(3), zeros(3));
    expect(s.saldoInicial).toEqual([1000, 1200, 700]);
    expect(s.saldoFinal).toEqual([1200, 700, 1000]);
  });

  it("conta cadastrada com saldo DENTRO do período entra no saldo", () => {
    // sem isso o "saldo no fim" ficaria abaixo do painel e do extrato
    const s = acumularSaldo(0, [0, 0], [0, 10_000], zeros(2));
    expect(s.saldoFinal).toEqual([0, 10_000]);
  });

  it("transferência que sai num mês e cai no outro não some no caminho", () => {
    // saiu 400 em agosto, caiu 400 em setembro: agosto fecha 400 menor e
    // setembro devolve — sem isso todos os meses seguintes ficariam abaixo
    const s = acumularSaldo(1000, [0, 0], zeros(2), [-400, 400]);
    expect(s.saldoFinal).toEqual([600, 1000]);
  });

  it("centavo não escapa no acumulado", () => {
    const s = acumularSaldo(0, [0.1, 0.2], zeros(2), zeros(2));
    expect(s.saldoFinal).toEqual([0.1, 0.3]);
  });
});

/**
 * A AUDITORIA COMPLETA DO MÓDULO (03/09/2026) — os guardas dos achados dos
 * relatórios e do painel.
 */
describe("os achados da auditoria completa (RN-035, RN-036)", () => {
  const lerArq = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("o DFC também inverte de/ate — e o resíduo nunca sai com nome errado", () => {
    // com de > ate as consultas vinham vazias, mas o resíduo é calculado por
    // DIFERENÇA de saldos: a loja que movimentou R$ 45 mil via "A loja
    // gerou: R$ 0,00" ao lado de "Transferências: −R$ 45.000,00", com o
    // rodapé afirmando que a conta fecha
    const tela = lerArq("src/app/(app)/financeiro/dfc/page.tsx");
    expect(tela).toContain("cru.de <= cru.ate ? [cru.de, cru.ate] : [cru.ate, cru.de]");
  });

  it("o corte de 24 colunas é DITO na tela", () => {
    // pedindo 2020–2026, a tela desenhava 24 meses, os filtros continuavam
    // mostrando o período inteiro e nada avisava: a lojista concluía que
    // 2022–2026 não teve movimento
    const motor = lerArq("src/lib/financeiro/relatorios.ts");
    expect(motor.match(/const cortouMeses =/g) ?? []).toHaveLength(2);
    expect(motor).toContain("lancamentos.length >= TETO_RELATORIO || cortouMeses");
    expect(motor).toContain("cortouPeriodo || cortouAtrasado || cortouMeses");
  });

  it("o DFC tem teto e DIZ quando faltou (era o único relatório sem)", () => {
    const visao = lerArq("src/lib/financeiro/visao.ts");
    expect(visao).toContain("export const TETO_DFC");
    expect(visao).toContain("const truncado = baixas.length > TETO_DFC;");
    expect(lerArq("src/app/(app)/financeiro/dfc/dfc-view.tsx")).toContain("dfc.truncado");
  });

  it("a previsão não perde a baixa com data futura", () => {
    // `saldoHoje` conta baixa até HOJE; somando todas do outro lado, o
    // cheque registrado para amanhã saía das DUAS pontas e o dinheiro
    // desaparecia da previsão — enquanto o fluxo o mostrava como realizado
    const visao = lerArq("src/lib/financeiro/visao.ts");
    const corpo = visao.slice(visao.indexOf("async function emAbertoAte("));
    expect(corpo).toContain("data: { lte: hojeDia },");
  });

  it("o fluxo agrupa por ID, nunca pelo nome (duas 'Maria Silva' são duas)", () => {
    // a RN-020 diz que cadastro repetido acontece e que o sistema AVISA em
    // vez de juntar; usando o nome como chave, o relatório juntava sozinho
    const motor = lerArq("src/lib/financeiro/relatorios.ts");
    expect(motor).toContain("type Agrupado = { chave: string; rotulo: string }");
    expect(motor).toContain("chave: l.clienteId ?? l.cliente");
    expect(motor).toContain("acumular(alvo, grupo.chave, grupo.rotulo,");
  });

  it("categoria '07' criada pela LOJA não é lida como investimento", () => {
    // a despesa real dela sumia do resultado (R$ 20 mil/ano desaparecendo do
    // "deu lucro?") e ainda caía em Investimento no DFC
    expect(blocoDREdoCodigo("07", "DESPESA", true)).toBeNull();
    expect(blocoDREdoCodigo("07", "DESPESA", false)).toBe("DESPESA_ADMIN");
    expect(grupoDFCdoCodigo("07", true)).toBe("INVESTIMENTO");
    expect(grupoDFCdoCodigo("07", false)).toBe("OPERACIONAL");
  });

  it("quem decide se o '07' é investimento é a RAIZ, não a folha", () => {
    // olhar a folha erra dos DOIS lados: a categoria "07" criada pela loja
    // não é investimento (a despesa real dela sumia do resultado), e a
    // "07.01 Máquinas" que a lojista criou DENTRO do nosso bloco é
    // (auditoria completa do módulo, 03/09/2026)
    expect(raizDoCodigo("07.01")).toBe("07");
    expect(raizDoCodigo("07")).toBe("07");
    expect(raizDoCodigo(null)).toBeNull();
    const motor = lerArq("src/lib/financeiro/relatorios.ts");
    expect(motor).toContain("async function raizesDaArvore(");
    expect(motor).toContain("sistema: true, paiId: null");
    expect(motor).toContain("raizEhDoSistema(raizesDoSistema, l.categoria?.codigo)");
    expect(lerArq("src/lib/financeiro/visao.ts")).toContain("sistema: true, paiId: null");
  });

  it("os cards do mês no painel são somados NO BANCO", () => {
    // trazer as parcelas para a memória exigia um teto, e teto sem ordem faz
    // o Postgres devolver um subconjunto arbitrário: "a receber no mês"
    // mudava de valor entre dois F5
    expect(lerArq("src/lib/financeiro/visao.ts")).toContain(
      "export async function emAbertoNoPeriodo"
    );
    const painel = lerArq("src/app/(app)/financeiro/_visao/painel.tsx");
    expect(painel).toContain('emAbertoNoPeriodo(companyId, "RECEITA", inicioDoMes, fimDoMes)');
    expect(painel).not.toContain("take: 20_000");
  });

  it("o card Atrasado do painel não promete um número de clientes truncado", () => {
    const painel = lerArq("src/app/(app)/financeiro/_visao/painel.tsx");
    expect(painel).toContain('${inad.clientes}${inad.truncado ? "+" : ""}');
  });
});
