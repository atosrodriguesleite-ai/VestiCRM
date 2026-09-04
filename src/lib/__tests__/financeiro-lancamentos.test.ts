// Guarda RN-030
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  autorDeGente,
  conferirBaixa,
  dataDoDia,
  diaSP,
  diasDeAtraso,
  dividirEmParcelas,
  podeCancelarLancamento,
  podeEditarValores,
  resumoDoPeriodo,
  saldoDaParcela,
  statusDaParcela,
  totalAbatido,
  valorMovimentado,
  vencimentosMensais,
} from "../financeiro/lancamentos";

/**
 * RN-030 · O lançamento do financeiro: parcelas sem perder centavo, status
 * SEMPRE calculado, baixa parcial, estorno com rastro e a régua do que pode
 * ser mexido depois que o dinheiro andou.
 */

const dia = (iso: string) => dataDoDia(iso)!;

describe("parcelamento não perde centavo (RN-030)", () => {
  it("R$ 100 em 3× fecha exatamente R$ 100", () => {
    const p = dividirEmParcelas(100, 3);
    expect(p).toEqual([33.33, 33.33, 33.34]);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 10);
  });

  it("qualquer valor e qualquer número de parcelas fecham a soma", () => {
    for (const valor of [0.03, 1, 19.99, 1500, 2999.97, 87.55]) {
      for (const n of [1, 2, 3, 4, 6, 7, 12]) {
        const soma = dividirEmParcelas(valor, n).reduce((s, v) => s + v, 0);
        expect(Math.round(soma * 100), `${valor} em ${n}x`).toBe(
          Math.round(valor * 100)
        );
      }
    }
  });

  it("valor que não divide deixa a sobra na ÚLTIMA parcela", () => {
    expect(dividirEmParcelas(10, 4)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(dividirEmParcelas(10.01, 2)).toEqual([5, 5.01]);
  });
});

describe("vencimentos mensais (RN-030)", () => {
  it("anda de mês em mês mantendo o dia", () => {
    const datas = vencimentosMensais(dia("2026-01-10"), 3).map(diaSP);
    expect(datas).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
  });

  it("dia 31 em mês curto cai no último dia — NUNCA vaza para o mês seguinte", () => {
    // o `setMonth` cru transformaria 31/01 + 1 mês em 03/03 e a parcela
    // sumiria do mês de fevereiro nos relatórios
    const datas = vencimentosMensais(dia("2026-01-31"), 4).map(diaSP);
    expect(datas).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("atravessa a virada do ano", () => {
    const datas = vencimentosMensais(dia("2026-11-15"), 3).map(diaSP);
    expect(datas).toEqual(["2026-11-15", "2026-12-15", "2027-01-15"]);
  });
});

describe("o dia é o de São Paulo, não o do servidor (RN-030)", () => {
  it("data guardada ao meio-dia continua no mesmo dia no fuso de SP", () => {
    expect(diaSP(dia("2026-09-05"))).toBe("2026-09-05");
  });

  it("22h de SP ainda é o dia de SP, mesmo já sendo amanhã em UTC", () => {
    // 2026-09-05T01:30Z = 04/09 22:30 em São Paulo
    expect(diaSP(new Date("2026-09-05T01:30:00.000Z"))).toBe("2026-09-04");
  });

  it("recusa texto que não é data", () => {
    expect(dataDoDia("05/09/2026")).toBeNull();
    expect(dataDoDia("")).toBeNull();
  });
});

describe("status calculado, nunca digitado (RN-030)", () => {
  const hoje = dia("2026-09-10");
  const parcela = (venc: string, baixas: { valor: number; estornadaEm?: Date }[] = []) => ({
    valor: 100,
    vencimento: dia(venc),
    baixas,
  });

  it("vencida sem baixa = ATRASADA (e conta os dias)", () => {
    const p = parcela("2026-09-05");
    expect(statusDaParcela(p, hoje)).toBe("ATRASADA");
    expect(diasDeAtraso(p, hoje)).toBe(5);
  });

  it("vence hoje é seu próprio balde", () => {
    expect(statusDaParcela(parcela("2026-09-10"), hoje)).toBe("VENCE_HOJE");
    expect(diasDeAtraso(parcela("2026-09-10"), hoje)).toBe(0);
  });

  it("futura = PENDENTE; paga = QUITADA; metade paga e a vencer = PARCIAL", () => {
    expect(statusDaParcela(parcela("2026-09-20"), hoje)).toBe("PENDENTE");
    expect(statusDaParcela(parcela("2026-09-20", [{ valor: 100 }]), hoje)).toBe("QUITADA");
    expect(statusDaParcela(parcela("2026-09-20", [{ valor: 40 }]), hoje)).toBe("PARCIAL");
  });

  it("metade paga E VENCIDA é ATRASADA — o vencimento manda", () => {
    // antes ela contava no card "Atrasado" mas sumia ao filtrar por atrasado,
    // e a lojista cobrava a metade errada da lista (revisão 31/08/2026)
    expect(statusDaParcela(parcela("2026-09-05", [{ valor: 40 }]), hoje)).toBe("ATRASADA");
  });

  it("as três parcelas de R$ 100/3 quitam de verdade (tolerância do centavo)", () => {
    const p = { valor: 33.33, vencimento: dia("2026-09-01"), baixas: [{ valor: 33.33 }] };
    expect(statusDaParcela(p, hoje)).toBe("QUITADA");
    expect(saldoDaParcela(p)).toBe(0);
  });

  it("baixa ESTORNADA não conta: a parcela volta a dever", () => {
    const p = parcela("2026-09-05", [
      { valor: 100, estornadaEm: new Date("2026-09-08") },
    ]);
    expect(totalAbatido(p.baixas)).toBe(0);
    expect(saldoDaParcela(p)).toBe(100);
    expect(statusDaParcela(p, hoje)).toBe("ATRASADA");
  });

  it("lançamento cancelado não tem status de cobrança", () => {
    expect(statusDaParcela(parcela("2026-09-05"), hoje, true)).toBe("CANCELADA");
  });
});

describe("o que a baixa movimenta na conta (RN-030)", () => {
  it("desconto tira e juros somam — o abatimento continua o mesmo", () => {
    expect(valorMovimentado({ valor: 100, desconto: 5 })).toBe(95);
    expect(valorMovimentado({ valor: 100, juros: 10 })).toBe(110);
    expect(valorMovimentado({ valor: 100 })).toBe(100);
  });

  it("parcela de 100 quitada com multa: quita a parcela e move 110", () => {
    const p = { valor: 100, vencimento: dia("2026-08-01"), baixas: [{ valor: 100, juros: 10 }] };
    expect(saldoDaParcela(p)).toBe(0);
    expect(valorMovimentado(p.baixas[0])).toBe(110);
  });
});

describe("a baixa cabe? (RN-030)", () => {
  const p = { valor: 100, vencimento: dia("2026-09-01"), baixas: [{ valor: 60 }] };

  it("aceita o que falta e recusa o que passa", () => {
    expect(conferirBaixa(p, { valor: 40 })).toBeNull();
    expect(conferirBaixa(p, { valor: 41 })).toMatch(/maior que o saldo/);
  });

  it("recusa valor zero, negativo e desconto negativo", () => {
    expect(conferirBaixa(p, { valor: 0 })).toBeTruthy();
    expect(conferirBaixa(p, { valor: -10 })).toBeTruthy();
    expect(conferirBaixa(p, { valor: 10, desconto: -1 })).toBeTruthy();
  });

  it("desconto maior que a baixa é recusado (moveria dinheiro NEGATIVO)", () => {
    expect(conferirBaixa(p, { valor: 10, desconto: 15 })).toMatch(/desconto/i);
    expect(valorMovimentado({ valor: 10, desconto: 10 })).toBe(0);
  });

  it("parcela já quitada não recebe baixa nova", () => {
    const quitada = { valor: 100, vencimento: dia("2026-09-01"), baixas: [{ valor: 100 }] };
    expect(conferirBaixa(quitada, { valor: 1 })).toMatch(/já está quitada/);
  });
});

describe("resumo do período: os baldes somam o total (RN-030)", () => {
  const hoje = dia("2026-09-10");

  it("cada parcela entra em um balde só, e o que falta usa o SALDO", () => {
    const r = resumoDoPeriodo(
      [
        { valor: 100, vencimento: dia("2026-09-05"), baixas: [] }, // atrasada
        { valor: 200, vencimento: dia("2026-09-10"), baixas: [] }, // hoje
        { valor: 300, vencimento: dia("2026-09-20"), baixas: [] }, // a vencer
        { valor: 400, vencimento: dia("2026-09-02"), baixas: [{ valor: 400 }] }, // quitada
      ],
      hoje
    );
    expect(r.atrasado).toBe(100);
    expect(r.venceHoje).toBe(200);
    expect(r.pendente).toBe(300);
    expect(r.quitado).toBe(400);
    expect(r.total).toBe(1000);
  });

  it("parcela paga PELA METADE e vencida: só o que falta entra no atrasado", () => {
    const r = resumoDoPeriodo(
      [{ valor: 100, vencimento: dia("2026-09-01"), baixas: [{ valor: 30 }] }],
      hoje
    );
    expect(r.quitado).toBe(30);
    expect(r.atrasado).toBe(70);
    expect(r.pendente).toBe(0);
  });

  it("no recorte por LIQUIDAÇÃO, o recebido é o que MOVIMENTOU na janela", () => {
    // a parcela foi paga em duas vezes, uma em agosto e outra em setembro,
    // a de setembro com multa. Olhando setembro, o card tem que mostrar o
    // que entrou na conta EM SETEMBRO (com a multa) — é o que bate com o
    // extrato do banco, e não o abatimento total da parcela.
    const parcela = {
      valor: 100,
      vencimento: dia("2026-08-20"),
      baixas: [
        { valor: 60, data: dia("2026-08-25") },
        { valor: 40, juros: 7, data: dia("2026-09-03") },
      ],
    };
    const janela = { de: dia("2026-09-01"), ate: dia("2026-09-30") };
    expect(resumoDoPeriodo([parcela], hoje, janela).quitado).toBe(47);
    // sem a janela (recorte por vencimento), o card soma o abatimento total
    expect(resumoDoPeriodo([parcela], hoje).quitado).toBe(100);
  });

  it("baixa estornada não entra na janela de liquidação", () => {
    const parcela = {
      valor: 100,
      vencimento: dia("2026-09-01"),
      baixas: [{ valor: 100, data: dia("2026-09-03"), estornadaEm: new Date() }],
    };
    const janela = { de: dia("2026-09-01"), ate: dia("2026-09-30") };
    expect(resumoDoPeriodo([parcela], hoje, janela).quitado).toBe(0);
  });

  it("lançamento cancelado fica FORA de todas as somas", () => {
    const r = resumoDoPeriodo(
      [{ valor: 999, vencimento: dia("2026-09-01"), baixas: [], cancelado: true }],
      hoje
    );
    expect(r).toEqual({ atrasado: 0, venceHoje: 0, pendente: 0, quitado: 0, total: 0 });
  });
});

describe("o que pode ser mexido depois que o dinheiro andou (RN-030)", () => {
  const comBaixa = [
    { valor: 100, vencimento: dia("2026-09-01"), baixas: [{ valor: 100 }] },
  ];
  const semBaixa = [{ valor: 100, vencimento: dia("2026-09-01"), baixas: [] }];
  const baixaEstornada = [
    {
      valor: 100,
      vencimento: dia("2026-09-01"),
      baixas: [{ valor: 100, estornadaEm: new Date() }],
    },
  ];

  it("com baixa ativa: não cancela nem edita valores — estorne primeiro", () => {
    expect(podeCancelarLancamento(comBaixa)).toMatch(/Estorne/);
    expect(podeEditarValores(comBaixa, "MANUAL")).toBeTruthy();
  });

  it("cancelar libera sem baixa ativa (a estornada não impede)", () => {
    expect(podeCancelarLancamento(semBaixa)).toBeNull();
    expect(podeCancelarLancamento(baixaEstornada)).toBeNull();
  });

  it("EDITAR é mais rígido: baixa estornada também trava", () => {
    // editar refaz as parcelas, e as baixas penduradas nelas iriam junto —
    // inclusive a estornada, que é o registro de que algo deu errado
    expect(podeEditarValores(semBaixa, "MANUAL")).toBeNull();
    expect(podeEditarValores(baixaEstornada, "MANUAL")).toMatch(/histórico/);
  });

  it("lançamento que veio de VENDA nunca aceita edição de valor", () => {
    // a fonte da verdade é o pedido (prepara a porta única da Fase 4)
    expect(podeEditarValores(semBaixa, "PEDIDO")).toMatch(/pedido/);
    expect(podeEditarValores(semBaixa, "NUVEMSHOP")).toMatch(/pedido/);
  });
});

/**
 * Estes dois são guardas de ARQUITETURA (varredura de arquivo), na mesma
 * família do guarda da porteira da RN-029: eles vigiam uma propriedade que
 * some sem ninguém ver numa rota futura. O COMPORTAMENTO do dinheiro é
 * guardado pelos testes acima e pelo cenário ponta a ponta rodado contra o
 * Postgres local antes do push.
 */
describe("as portas do dinheiro estão fechadas (RN-030)", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("baixa roda em transação SERIALIZÁVEL (duas pessoas, uma parcela)", () => {
    // sem isso, as duas passam pela conferência (nenhuma enxerga a linha da
    // outra) e a parcela termina paga em dobro — dinheiro inventado
    const rota = ler("src/app/api/financeiro/parcelas/[id]/baixas/route.ts");
    expect(rota).toContain("Serializable");
    expect(rota).toContain("conferirBaixa");
  });

  it("estorno marca quem e quando, e não existe DELETE de baixa", () => {
    const rota = ler("src/app/api/financeiro/baixas/[id]/route.ts");
    expect(rota).toContain("estornadaEm");
    expect(rota).toContain("estornoAutor");
    expect(/export\s+(async\s+)?function\s+DELETE/.test(rota)).toBe(false);
  });
});

describe("data que não existe no calendário (RN-030)", () => {
  it("30 de fevereiro é RECUSADO — antes virava 2 de março em silêncio", () => {
    // um vencimento digitado errado caía noutro mês sem ninguém ver
    expect(dataDoDia("2026-02-30")).toBeNull();
    expect(dataDoDia("2026-04-31")).toBeNull();
    expect(dataDoDia("2026-13-01")).toBeNull();
  });

  it("mas o que existe continua valendo, inclusive 29/02 bissexto", () => {
    expect(dataDoDia("2026-02-28")?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(dataDoDia("2028-02-29")?.toISOString()).toBe("2028-02-29T12:00:00.000Z");
    expect(dataDoDia("2026-09-05")?.toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });
});

/**
 * A AUDITORIA COMPLETA DO MÓDULO (03/09/2026) — os guardas dos achados de
 * lançamento, extrato e cadastros.
 */
describe("os achados da auditoria completa (RN-030, RN-032, RN-039)", () => {
  const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("editar e cancelar conferem DENTRO da transação, e serializável", () => {
    // conferindo de fora, uma baixa que chegasse no meio era apagada em
    // cascata (editar) ou ficava viva num lançamento CANCELADO — o DRE pula
    // a parcela e o extrato continua somando a baixa, e os dois divergem
    // para sempre sem pista de onde
    const rota = ler("src/app/api/financeiro/lancamentos/[id]/route.ts");
    expect(rota.match(/Prisma\.TransactionIsolationLevel\.Serializable/g) ?? []).toHaveLength(2);
    expect(rota).toContain("const trava = podeEditarValores(agora.parcelas, agora.origem);");
    expect(rota).toContain("const impedimento = podeCancelarLancamento(agora.parcelas);");
    // e o LADO não muda numa edição, nem se edita cancelado
    expect(rota).toContain("Não dá para trocar o lado do lançamento");
    expect(rota).toContain("Este lançamento está cancelado");
  });

  it("o estorno da baixa é UMA transação (três escritas soltas perdiam rastro)", () => {
    const rota = ler("src/app/api/financeiro/baixas/[id]/route.ts");
    const corpo = rota.slice(rota.indexOf("const estornou = await db.$transaction"));
    expect(corpo).toContain("tx.finBaixa.updateMany");
    expect(corpo).toContain("tx.finOfxVinculo.deleteMany");
    expect(corpo).toContain("tx.finLancamentoEvento.create");
  });

  it("o nome da baixa automática não colide com o de uma pessoa", () => {
    // "Sistema" é a identidade da porta e está no índice único do banco: uma
    // vendedora com esse nome tinha a baixa lida como automática (a porta a
    // estornava sozinha) e levava 500 em vez de frase em português
    expect(autorDeGente("Sistema")).toBe("Sistema (usuária)");
    expect(autorDeGente(" Sistema ")).toBe("Sistema (usuária)");
    expect(autorDeGente("Marta")).toBe("Marta");
    // e a porteira trata TODA rota do módulo de uma vez
    expect(ler("src/lib/financeiro/gate.ts")).toContain("name: autorDeGente(user.name)");
  });

  it("o filtro de situação vem ANTES do corte da página", () => {
    // lendo 500 e filtrando depois, a lista de "Quitado" aparecia VAZIA
    // numa loja com mais de 500 parcelas no mês, enquanto o card mostrava
    // o valor cheio
    const consulta = ler("src/lib/financeiro/consulta.ts");
    expect(consulta).toContain("export const TETO_COM_FILTRO");
    expect(consulta).toContain("const filtradas = comFiltro");
    expect(consulta.indexOf("const filtradas = comFiltro")).toBeLessThan(
      consulta.indexOf("const linhas = filtradas.slice(0, TETO_LINHAS);")
    );
    // e os cards avisam quando o período não coube
    expect(consulta).toContain("resumoTruncado");
  });

  it("nunca nasce parcela de valor ZERO", () => {
    // R$ 0,02 em 3× dava [0, 0, 0,02] e o servidor recusava a ficha inteira
    // com um "Dados inválidos" que não diz qual linha nem por quê
    for (const [valor, n] of [
      [0.02, 3],
      [1, 12],
      [0.01, 5],
      [100, 3],
    ] as [number, number][]) {
      const p = dividirEmParcelas(valor, n);
      expect(p.every((v) => v > 0), `${valor} em ${n}x tem parcela zerada`).toBe(true);
      expect(Math.round(p.reduce((s, v) => s + v, 0) * 100)).toBe(Math.round(valor * 100));
    }
  });

  it("o saldo inicial da conta é DIA ao meio-dia, e o cartão não guarda dinheiro", () => {
    for (const rota of [
      "src/app/api/financeiro/contas/route.ts",
      "src/app/api/financeiro/contas/[id]/route.ts",
    ]) {
      const codigo = ler(rota);
      // z.coerce.date() gravava meia-noite UTC e o dia virava o anterior em
      // São Paulo: a abertura aparecia um dia antes no extrato e um MÊS
      // antes no fluxo de caixa
      expect(codigo).not.toContain("saldoInicialEm: z.coerce.date()");
      expect(codigo).toContain("dataDoDia(");
      expect(codigo).toContain("padrao: false, saldoInicial: 0");
    }
    // e o cartão fica fora de TODA soma de dinheiro (RN-039): saldo de uma
    // conta, saldo por conta e a linha de abertura do extrato
    const extrato = ler("src/lib/financeiro/extrato.ts");
    expect((extrato.match(/tipo: \{ not: "CARTAO" \}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(ler("src/lib/financeiro/visao.ts")).toContain('tipo: { not: "CARTAO" }');
  });

  it("converter conta COM dinheiro em cartão é RECUSADO (não zera o saldo)", () => {
    // cartão não carrega saldo inicial (RN-039), então a conversão o
    // ZERARIA — apagando de vez o saldo declarado, sem volta
    const rota = ler("src/app/api/financeiro/contas/[id]/route.ts");
    expect(rota).toContain("class ContaComDinheiro");
    expect(rota).toContain('alvo.tipo !== "CARTAO" && campos.tipo === "CARTAO"');
    expect(rota).toContain("não dá para transformar em cartão de crédito");
  });

  it("arquivar categoria leva as filhas; DESarquivar não ressuscita nada", () => {
    // vale para qualquer nível (a subcategoria também tem filhas), e
    // desarquivar a mãe não pode trazer de volta a filha que a lojista
    // arquivou uma a uma (auditoria de 03/09/2026)
    const rota = ler("src/app/api/financeiro/categorias/[id]/route.ts");
    expect(rota).toContain("if (arquivar === true) {");
    expect(rota).toContain("codigo: { startsWith: `${alvo.codigo}.` }");
    expect(rota).not.toContain("!alvo.codigo.includes(\".\")");
  });

  it("o saldo do cartão nunca entra por uma ponta e sai pela outra", () => {
    // o saldo inicial já excluía CARTÃO; as baixas não, e aí o card "Saldo
    // hoje" e o saldo previsto discordavam para uma conta convertida
    const extrato = ler("src/lib/financeiro/extrato.ts");
    expect((extrato.match(/conta: \{ tipo: \{ not: "CARTAO" \} \}/g) ?? []).length)
      .toBeGreaterThanOrEqual(4);
  });

  it("a abertura da conta vem ANTES dos movimentos do mesmo dia", () => {
    // no desempate por id, a linha "si-" caía depois das baixas ("b-") e a
    // coluna Saldo mostrava um intermediário falso
    const extrato = ler("src/lib/financeiro/extrato.ts");
    expect(extrato).toContain('l.tipo === "SALDO_INICIAL" ? 0 : 1');
  });
});
