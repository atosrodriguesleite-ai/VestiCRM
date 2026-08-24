import { describe, it, expect } from "vitest";
import {
  lifetimeMeses,
  lifetimeLabel,
  valorDaCobranca,
  mesesDoCiclo,
  situacaoCobranca,
  calcularMRR,
  tipoDeRisco,
  canalDoLead,
  marcaDoLink,
  valorGerado,
  horasForaDoAr,
  tempoForaLabel,
  ALERTA_WHATSAPP_HORAS,
} from "../gestao";

describe("lifetime — há quanto tempo a loja é cliente", () => {
  const hoje = new Date("2026-07-27T12:00:00Z");

  it("conta meses cheios", () => {
    expect(lifetimeMeses(new Date("2026-04-27T00:00:00Z"), hoje)).toBe(3);
    expect(lifetimeMeses(new Date("2025-07-27T00:00:00Z"), hoje)).toBe(12);
  });

  it("mês só conta depois de fechar o dia", () => {
    // entrou dia 29 (meio-dia, sem dúvida de fuso): em 27/07 falta fechar
    expect(lifetimeMeses(new Date("2026-04-29T12:00:00Z"), hoje)).toBe(2);
  });

  it("conta no fuso de São Paulo, não no do servidor", () => {
    // 28/04 00:00 UTC ainda é 27/04 às 21h em São Paulo — para o cliente
    // brasileiro a loja nasceu no dia 27, então em 27/07 fecha 3 meses.
    expect(lifetimeMeses(new Date("2026-04-28T00:00:00Z"), hoje)).toBe(3);
  });

  it("loja criada hoje é zero, nunca negativo", () => {
    expect(lifetimeMeses(hoje, hoje)).toBe(0);
    expect(lifetimeMeses(new Date("2026-08-30T00:00:00Z"), hoje)).toBe(0);
  });

  it("rótulo em português", () => {
    expect(lifetimeLabel(0)).toBe("menos de 1 mês");
    expect(lifetimeLabel(1)).toBe("1 mês");
    expect(lifetimeLabel(7)).toBe("7 meses");
    expect(lifetimeLabel(12)).toBe("1 ano");
    expect(lifetimeLabel(14)).toBe("1 ano e 2 meses");
  });
});

describe("ciclo do contrato", () => {
  it("cada cobrança cobre os meses do ciclo", () => {
    expect(mesesDoCiclo("MENSAL")).toBe(1);
    expect(mesesDoCiclo("SEMESTRAL")).toBe(6);
    expect(mesesDoCiclo("ANUAL")).toBe(12);
  });

  it("o valor da cobrança é a mensalidade vezes os meses", () => {
    expect(valorDaCobranca(197, "MENSAL")).toBe(197);
    expect(valorDaCobranca(197, "SEMESTRAL")).toBe(1182);
    expect(valorDaCobranca(197, "ANUAL")).toBe(2364);
  });
});

describe("situação da cobrança", () => {
  const base = { kind: "PAGANTE", monthlyFee: 197, dueDay: 10 };

  it("pagou o mês corrente: em dia", () => {
    expect(
      situacaoCobranca({
        ...base,
        paidThrough: new Date("2026-07-01T00:00:00Z"),
        hoje: new Date("2026-07-27T12:00:00Z"),
      })
    ).toBe("EM_DIA");
  });

  it("não pagou, mas ainda não venceu: a vencer", () => {
    expect(
      situacaoCobranca({
        ...base,
        paidThrough: new Date("2026-06-01T00:00:00Z"),
        hoje: new Date("2026-07-05T12:00:00Z"),
      })
    ).toBe("A_VENCER");
  });

  it("passou do vencimento sem pagar: atrasado", () => {
    expect(
      situacaoCobranca({
        ...base,
        paidThrough: new Date("2026-06-01T00:00:00Z"),
        hoje: new Date("2026-07-27T12:00:00Z"),
      })
    ).toBe("ATRASADO");
  });

  it("nunca pagou nada e já venceu: atrasado", () => {
    expect(
      situacaoCobranca({ ...base, paidThrough: null, hoje: new Date("2026-07-27T12:00:00Z") })
    ).toBe("ATRASADO");
  });

  it("não discorda do painel Lojas: usa a mesma régua (lib/billing)", () => {
    // paidThrough é gravado como dia 1 da competência em UTC. Lido no fuso de
    // São Paulo viraria o último dia do mês ANTERIOR — e a loja que pagou
    // julho apareceria como atrasada. A régua oficial lê em UTC; conferindo:
    const pagouJulho = new Date("2026-07-01T00:00:00Z");
    expect(
      situacaoCobranca({ ...base, paidThrough: pagouJulho, hoje: new Date("2026-07-31T23:00:00Z") })
    ).toBe("EM_DIA");
  });

  it("teste e cortesia não entram na régua de cobrança", () => {
    expect(situacaoCobranca({ ...base, kind: "TESTE", paidThrough: null })).toBe("SEM_COBRANCA");
    expect(situacaoCobranca({ ...base, kind: "CORTESIA", paidThrough: null })).toBe("SEM_COBRANCA");
    expect(situacaoCobranca({ ...base, monthlyFee: 0, paidThrough: null })).toBe("SEM_COBRANCA");
  });
});

describe("MRR — receita recorrente mensal", () => {
  it("soma só as pagantes ativas", () => {
    const mrr = calcularMRR([
      { suspended: false, kind: "PAGANTE", monthlyFee: 197 },
      { suspended: false, kind: "PAGANTE", monthlyFee: 297 },
      { suspended: true, kind: "PAGANTE", monthlyFee: 500 }, // suspensa não gera caixa
      { suspended: false, kind: "TESTE", monthlyFee: 0 },
      { suspended: false, kind: "CORTESIA", monthlyFee: 197 }, // cortesia não paga
    ]);
    expect(mrr).toBe(494);
  });

  it("sem pagantes, MRR zero", () => {
    expect(calcularMRR([{ suspended: false, kind: "TESTE", monthlyFee: 0 }])).toBe(0);
  });
});

describe("loja em risco", () => {
  const hoje = new Date("2026-07-27T12:00:00Z");
  const velha = new Date("2026-01-01T00:00:00Z"); // criada há muito tempo

  it("pagante sem uso há 14+ dias: risco de cancelar", () => {
    expect(
      tipoDeRisco(
        { suspended: false, kind: "PAGANTE", ultimoAcesso: new Date("2026-07-01T00:00:00Z"), criadaEm: velha },
        hoje
      )
    ).toBe("PAGANTE_SUMIU");
  });

  it("pagante usando o sistema não é risco", () => {
    expect(
      tipoDeRisco(
        { suspended: false, kind: "PAGANTE", ultimoAcesso: new Date("2026-07-26T00:00:00Z"), criadaEm: velha },
        hoje
      )
    ).toBeNull();
  });

  it("pagante que NUNCA entrou é o pior caso", () => {
    expect(
      tipoDeRisco({ suspended: false, kind: "PAGANTE", ultimoAcesso: null, criadaEm: velha }, hoje)
    ).toBe("PAGANTE_SUMIU");
  });

  it("teste parado há 7+ dias: risco de não fechar a venda", () => {
    expect(
      tipoDeRisco(
        { suspended: false, kind: "TESTE", ultimoAcesso: new Date("2026-07-15T00:00:00Z"), criadaEm: velha },
        hoje
      )
    ).toBe("TESTE_PARADO");
  });

  it("teste usando o sistema não é risco", () => {
    expect(
      tipoDeRisco(
        { suspended: false, kind: "TESTE", ultimoAcesso: new Date("2026-07-25T00:00:00Z"), criadaEm: velha },
        hoje
      )
    ).toBeNull();
  });

  it("teste que nunca entrou: alarme só depois da tolerância de 2 dias", () => {
    // criada agora mesmo: ainda não acende
    expect(
      tipoDeRisco({ suspended: false, kind: "TESTE", ultimoAcesso: null, criadaEm: hoje }, hoje)
    ).toBeNull();
    // criada há 3 dias e ninguém entrou: acende
    expect(
      tipoDeRisco(
        { suspended: false, kind: "TESTE", ultimoAcesso: null, criadaEm: new Date("2026-07-24T00:00:00Z") },
        hoje
      )
    ).toBe("TESTE_PARADO");
  });

  it("suspensa e cortesia ficam fora do alerta", () => {
    expect(
      tipoDeRisco({ suspended: true, kind: "PAGANTE", ultimoAcesso: null, criadaEm: velha }, hoje)
    ).toBeNull();
    expect(
      tipoDeRisco({ suspended: true, kind: "TESTE", ultimoAcesso: null, criadaEm: velha }, hoje)
    ).toBeNull();
    expect(
      tipoDeRisco({ suspended: false, kind: "CORTESIA", ultimoAcesso: null, criadaEm: velha }, hoje)
    ).toBeNull();
  });
});

describe("de onde a lojista veio (marca dos utm no link)", () => {
  it("rodapé do CATÁLOGO de uma loja guarda a loja que indicou", () => {
    // ?utm_source=catalogo&utm_medium=powered-by&utm_campaign=toque-leve
    expect(marcaDoLink("catalogo / powered-by / toque-leve")).toBe(
      "catalogo:toque-leve"
    );
  });

  it("rodapé da BIO de uma loja (sem 'medium' no meio)", () => {
    expect(marcaDoLink("bio / toque-leve")).toBe("bio:toque-leve");
  });

  it("sem a loja no link, fica só o canal", () => {
    expect(marcaDoLink("bio")).toBe("bio");
    expect(marcaDoLink("catalogo / powered-by")).toBe("catalogo");
  });

  it("link de afiliado não vira canal de rodapé", () => {
    expect(marcaDoLink("afiliado / indicacao / maria")).toBeNull();
  });

  it("campanha chamada 'bio' NÃO passa por rodapé de bio", () => {
    // a fonte é a 1ª parte (utm_source); procurar em qualquer posição
    // creditava o boca a boca do produto a um anúncio pago qualquer
    expect(marcaDoLink("google / cpc / bio")).toBeNull();
  });

  it("visitante que chegou direto não tem marca", () => {
    expect(marcaDoLink(null)).toBeNull();
    expect(marcaDoLink("")).toBeNull();
  });
});

describe("canal de entrada dos leads da plataforma", () => {
  it("bio de loja", () => {
    expect(canalDoLead({ origin: "SITE", landingSource: "bio:toque-leve" })).toBe("BIO");
  });
  it("formulário do site", () => {
    expect(canalDoLead({ origin: "SITE", landingSource: null })).toBe("LANDING");
  });

  /**
   * O canal que o dono queria medir e que estava INVISÍVEL: a lojista que
   * descobre o AtacadoPro no rodapé "Feito com AtacadoPro" do catálogo de
   * outra loja. Ela cai no formulário do site (origin SITE), então sem a
   * marca do rodapé virava "Site / landing page" e o canal aparecia zerado.
   */
  it("rodapé do CATÁLOGO de uma loja é canal próprio, não 'site'", () => {
    expect(
      canalDoLead({ origin: "SITE", landingSource: "catalogo:toque-leve" })
    ).toBe("CATALOGO_DE_LOJA");
  });

  it("catálogo da própria plataforma", () => {
    expect(canalDoLead({ origin: "CATALOGO_PUBLICO", landingSource: null })).toBe(
      "CATALOGO_PLATAFORMA"
    );
  });
  it("resto cai em outros", () => {
    expect(canalDoLead({ origin: "MANUAL", landingSource: null })).toBe("OUTROS");
    expect(canalDoLead({ origin: "WHATSAPP", landingSource: null })).toBe("OUTROS");
  });
});

describe("valor já gerado pelo cliente", () => {
  it("soma implementação e recorrências pagas", () => {
    expect(valorGerado([{ amount: 1500 }, { amount: 197 }, { amount: 197 }])).toBe(1894);
  });
  it("cliente sem pagamento ainda não gerou nada", () => {
    expect(valorGerado([])).toBe(0);
  });
});

describe("WhatsApp fora do ar", () => {
  const agora = new Date("2026-07-27T18:00:00Z");

  it("loja conectada não tem tempo fora do ar", () => {
    expect(horasForaDoAr(null, agora)).toBeNull();
  });

  it("conta as horas cheias desde a queda", () => {
    expect(horasForaDoAr(new Date("2026-07-27T15:30:00Z"), agora)).toBe(2);
    expect(horasForaDoAr(new Date("2026-07-26T18:00:00Z"), agora)).toBe(24);
  });

  it("queda de agora mesmo é zero, nunca negativo", () => {
    expect(horasForaDoAr(agora, agora)).toBe(0);
    expect(horasForaDoAr(new Date("2026-07-27T19:00:00Z"), agora)).toBe(0);
  });

  it("oscilação curta fica abaixo do limite de alerta", () => {
    const h = horasForaDoAr(new Date("2026-07-27T17:20:00Z"), agora)!;
    expect(h).toBeLessThan(ALERTA_WHATSAPP_HORAS);
  });

  it("rótulo em português, virando dias depois de 24h", () => {
    expect(tempoForaLabel(0)).toBe("menos de 1 hora");
    expect(tempoForaLabel(1)).toBe("1 hora");
    expect(tempoForaLabel(5)).toBe("5 horas");
    expect(tempoForaLabel(24)).toBe("1 dia");
    expect(tempoForaLabel(50)).toBe("2 dias");
  });
});
