// Guarda RN-090
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { diaBR, gerarPdfDoRelatorio, nomeDoArquivo, secoesDoRelatorio, textoDaVariacao, type DadosDoRelatorio } from "../bi/relatorio";
import type { Painel, Vendedoras, SomaDoPeriodo } from "../bi/painel";
import { textoPdf } from "../pdf-texto";
import { BALDES_MIN, ROTULO_DO_BALDE } from "../bi/fatos";

/**
 * RN-090 — o relatório do período em PDF: o CONTEÚDO é puro e vem dos
 * mesmos objetos que a tela lê (nenhuma conta própria); o PDF nasce do
 * conteúdo e não quebra com emoji nem com período vazio.
 */

const soma = (p: Partial<SomaDoPeriodo> = {}): SomaDoPeriodo => ({
  leads: 40,
  leadsRespondidos: 30,
  leadsComPedido: 12,
  leadsPagaram: 8,
  esperas: 50,
  respondidas: 44,
  noPrazo: 36,
  foraDoPrazo: 8,
  semResposta: 6,
  pctNoPrazo: 82,
  hist: [20, 10, 6, 4, 2, 1, 1],
  medianaAproxMin: 15,
  pedidos: 14,
  pedidosPagos: 8,
  vendido: 1234.5,
  ticket: 154.31,
  origens: { WHATSAPP: 30, INSTAGRAM: 10 },
  diasComFato: 30,
  ...p,
});

const painel: Painel = {
  periodo: { de: "2026-09-14", ate: "2026-10-13" },
  anterior: { de: "2026-08-15", ate: "2026-09-13" },
  atual: soma(),
  passado: soma({ leads: 32, pctNoPrazo: 70, vendido: 1000, ticket: 125, pedidosPagos: 8 }),
  serie: Array.from({ length: 30 }, (_, i) => ({ dia: `2026-${i < 17 ? "09" : "10"}-${String(i < 17 ? 14 + i : i - 16).padStart(2, "0")}`, leads: i % 5, vendido: i === 20 ? 300 : 20, pedidosPagos: 1, pctNoPrazo: 80 })),
  funil: { leads: 40, respondidos: 30, comPedido: 12, pagaram: 8 },
  motivos: [{ label: "Achou caro 💸", value: 5 }, { label: "Outro", value: 2, sub: "pediu boleto ×2" }],
  mes: "2026-10",
  realizado: { FATURAMENTO: 800, PEDIDOS_PAGOS: 5, NOVOS_CONTATOS: 20, RESPOSTA_NO_PRAZO_PCT: 82, TICKET_MEDIO: 160, RECOMPRA_PCT: 30 },
  metas: { FATURAMENTO: 2000, PEDIDOS_PAGOS: 10 },
  recompraPct: 33,
  atualizadoEm: new Date("2026-10-13T12:00:00Z"),
  diasSemFato: 2,
};

const vendedoras: Vendedoras = {
  periodo: painel.periodo,
  pessoas: [
    { userId: "a", nome: "Ana", cor: "#000", ativa: true, conversaoPct: 25, leads: 24, leadsRespondidos: 20, leadsComPedido: 8, leadsPagaram: 6, respondidas: 30, noPrazo: 26, foraDoPrazo: 4, semResposta: 2, pctNoPrazo: 87, hist: [], medianaAproxMin: 10, pedidos: 9, pedidosPagos: 6, vendido: 900, ticket: 150 },
    { userId: "b", nome: "Bia", cor: "#000", ativa: false, conversaoPct: null, leads: 0, leadsRespondidos: 0, leadsComPedido: 0, leadsPagaram: 0, respondidas: 10, noPrazo: 8, foraDoPrazo: 2, semResposta: 1, pctNoPrazo: 80, hist: [], medianaAproxMin: null, pedidos: 0, pedidosPagos: 0, vendido: 0, ticket: null },
  ] as Vendedoras["pessoas"],
  loja: soma(),
  semVendedora: { respondidas: 4, leads: 16, pedidosPagos: 2, vendido: 334.5, semResposta: 3 },
  diasSemVendedoras: 0,
};

const dados: DadosDoRelatorio = {
  loja: "Toque Leve Confecções",
  geradoPor: "Atos",
  geradoEm: new Date("2026-10-14T18:00:00Z"),
  prazoMin: 30,
  semHorario: true,
  painel,
  vendedoras,
  tendencia: [
    { mes: "2026-09", rotulo: "set/26", leads: 50, pedidosPagos: 10, vendido: 1500, ticket: 150, pctNoPrazo: 75, semResposta: 4, respondidas: 40, diasComFato: 30, diasNoMes: 30 },
    { mes: "2026-10", rotulo: "out/26", leads: 20, pedidosPagos: 4, vendido: 600, ticket: 150, pctNoPrazo: null, semResposta: null, respondidas: null, diasComFato: 0, diasNoMes: 13 },
  ],
};

describe("o conteúdo do relatório (puro)", () => {
  const secoes = secoesDoRelatorio(dados);
  const porTitulo = (t: string) => secoes.find((s) => s.titulo.startsWith(t))!;

  it("os seis números são os da tela, com a comparação do período anterior em palavras", () => {
    const bloco = porTitulo("Os números").blocos[0];
    expect(bloco.tipo).toBe("numeros");
    if (bloco.tipo !== "numeros") return;
    expect(bloco.itens.map((i) => [i.rotulo, i.valor])).toEqual([
      ["Novos contatos", "40"],
      ["Respondidos no prazo", "82%"],
      ["Sem resposta", "6"],
      ["Vendido no período", "R$ 1.234,50"],
      ["Ticket médio", "R$ 154,31"],
      ["Taxa de recompra", "33%"],
    ]);
    expect(bloco.itens[0].delta).toBe("+25% vs. período anterior");
    expect(bloco.itens[1].delta).toBe("+12 pontos vs. período anterior");
    expect(bloco.itens[1].nota).toContain("prazo de 30 min");
    expect(porTitulo("Os números").nota).toContain("15/08/2026 a 13/09/2026");
  });
  it("as metas entram só as preenchidas, com o atingido", () => {
    const b = porTitulo("Metas de outubro").blocos[0];
    expect(b.tipo).toBe("tabela");
    if (b.tipo !== "tabela") return;
    expect(b.linhas).toEqual([
      ["Faturamento do mês", "R$ 800", "R$ 2.000", "40%"],
      ["Pedidos pagos", "5", "10", "50%"],
    ]);
  });
  it("sem meta nenhuma a seção não existe", () => {
    const s = secoesDoRelatorio({ ...dados, painel: { ...painel, metas: {} } });
    expect(s.find((x) => x.titulo.startsWith("Metas"))).toBeUndefined();
  });
  it("o funil diz a conversão de cada etapa (a mesma conta da tela)", () => {
    const b = porTitulo("Funil").blocos[0];
    if (b.tipo !== "barras") throw new Error(b.tipo);
    expect(b.itens.map((i) => i.texto)).toEqual(["40", "30 · 75% da anterior · 75% do começo", "12 · 40% da anterior · 30% do começo", "8 · 67% da anterior · 20% do começo"]);
    expect(b.rampa).toBe(true);
  });
  it("a espera vira distribuição com %, as origens vêm traduzidas e ordenadas, os motivos levam o detalhe", () => {
    const esperou = porTitulo("Quanto").blocos[0];
    if (esperou.tipo !== "barras") throw new Error();
    expect(esperou.itens[0]).toEqual({ rotulo: "até 5 min", valor: 20, texto: "20 (45%)" });
    const origem = porTitulo("De onde").blocos[0];
    if (origem.tipo !== "barras") throw new Error();
    expect(origem.itens.map((i) => i.rotulo)).toEqual(["WhatsApp", "Instagram"]);
    const motivos = porTitulo("Por que").blocos[0];
    if (motivos.tipo !== "barras") throw new Error();
    expect(motivos.itens[1].rotulo).toBe("Outro (pediu boleto ×2)");
  });
  it("por vendedora: uma linha por pessoa (desativada marcada), 'Sem vendedora' e a loja inteira no rodapé", () => {
    const b = porTitulo("Por vendedora").blocos[0];
    if (b.tipo !== "tabela") throw new Error();
    expect(b.linhas[0]).toEqual(["Ana", "24", "6", "30", "87%", "2", "6", "R$ 900", "25%"]);
    expect(b.linhas[1][0]).toBe("Bia (desativada)");
    expect(b.linhas[2]).toEqual(["Sem vendedora", "16", "—", "4", "—", "3", "2", "R$ 334,50", "—"]);
    expect(b.rodape?.[7]).toBe("R$ 1.234,50");
  });
  it("12 meses: mês sem fato de atendimento fica com traço; mês coberto pela metade diz 'N de M dias'; a legenda diz de onde conta", () => {
    const sec = porTitulo("Últimos 12");
    const b = sec.blocos[0];
    if (b.tipo !== "tabela") throw new Error();
    expect(b.linhas[1]).toEqual(["out/26", "20", "—", "—", "4", "R$ 600", "R$ 150"]);
    expect(sec.nota).toContain("contado a partir de set/26");
    const parcial = secoesDoRelatorio({ ...dados, tendencia: [{ ...dados.tendencia[0], diasComFato: 11 }] }).find((s) => s.titulo.startsWith("Últimos"))!.blocos[0];
    if (parcial.tipo !== "tabela") throw new Error();
    expect(parcial.linhas[0][2]).toBe("75% (11 de 30 dias)");
  });
  it("os rótulos dos baldes são UMA lista, derivada dos limites (a tela e o PDF leem a mesma)", () => {
    expect(ROTULO_DO_BALDE).toEqual(["até 5 min", "até 15 min", "até 30 min", "até 1 h", "até 2 h", "até 4 h", "mais de 4 h"]);
    expect(ROTULO_DO_BALDE).toHaveLength(BALDES_MIN.length + 1);
  });
  it("por vendedora segue a régua de vazio da aba: só 'nenhum número' quando a LOJA não teve movimento", () => {
    const comFila = secoesDoRelatorio({ ...dados, vendedoras: { ...vendedoras, pessoas: [], loja: soma({ leads: 0, respondidas: 0, pedidos: 0, pedidosPagos: 0, semResposta: 5 }), semVendedora: { respondidas: 0, leads: 0, pedidosPagos: 0, vendido: 0, semResposta: 5 } } }).find((s) => s.titulo === "Por vendedora")!;
    expect(comFila.blocos[0].tipo).toBe("texto");
    expect(comFila.blocos[1]?.tipo).toBe("tabela");
    const parado = secoesDoRelatorio({ ...dados, vendedoras: { ...vendedoras, pessoas: [], loja: soma({ leads: 0, respondidas: 0, pedidos: 0, pedidosPagos: 0, semResposta: 0 }) } }).find((s) => s.titulo === "Por vendedora")!;
    expect(parado.blocos).toHaveLength(1);
    expect(parado.blocos[0].tipo).toBe("texto");
  });
  it("'como ler' avisa do horário não cadastrado e dos dias sem fato", () => {
    const b = porTitulo("Como ler").blocos[0];
    if (b.tipo !== "texto") throw new Error();
    expect(b.linhas.some((l) => l.includes("madrugada"))).toBe(true);
    expect(b.linhas.some((l) => l.includes("2 dia(s)"))).toBe(true);
    const sem = secoesDoRelatorio({ ...dados, semHorario: false, painel: { ...painel, diasSemFato: 0 } }).find((s) => s.titulo === "Como ler")!.blocos[0];
    if (sem.tipo !== "texto") throw new Error();
    expect(sem.linhas).toHaveLength(1);
  });
  it("período vazio: as seções dizem que não há dados em vez de quebrar", () => {
    const vazio = secoesDoRelatorio({
      ...dados,
      painel: { ...painel, atual: soma({ leads: 0, hist: [0, 0, 0, 0, 0, 0, 0], origens: {}, esperas: 0, ticket: null, pctNoPrazo: null }), passado: soma({ leads: 0, vendido: 0, pctNoPrazo: null, ticket: null }), funil: { leads: 0, respondidos: 0, comPedido: 0, pagaram: 0 }, motivos: [], serie: [] },
      vendedoras: { ...vendedoras, pessoas: [], semVendedora: { respondidas: 0, leads: 0, pedidosPagos: 0, vendido: 0, semResposta: 0 } },
    });
    const textos = vazio.flatMap((s) => s.blocos).filter((b) => b.tipo === "texto");
    expect(textos.length).toBeGreaterThanOrEqual(5);
    const numeros = vazio[0].blocos[0];
    if (numeros.tipo !== "numeros") throw new Error();
    expect(numeros.itens[0].delta).toBe("sem base de comparação");
  });
  it("as frases de variação e de dia", () => {
    expect([textoDaVariacao(12.4), textoDaVariacao(-3), textoDaVariacao(0), textoDaVariacao(null)]).toEqual(["+12% vs. período anterior", "-3% vs. período anterior", "0% vs. período anterior", "sem base de comparação"]);
    // o sinal é o hífen ASCII: o "−" tipográfico não existe na WinAnsi e o PDF o apagaria
    expect(textoPdf(textoDaVariacao(-3))).toBe("-3% vs. período anterior");
    expect(textoDaVariacao(1, "pontos")).toBe("+1 ponto vs. período anterior");
    expect(diaBR("2026-10-05")).toBe("05/10/2026");
  });
  it("o nome do arquivo é limpo: só letra, número e hífen", () => {
    expect(nomeDoArquivo("Toque Leve Confecções", painel.periodo)).toBe("bi-toque-leve-confeccoes-2026-09-14-a-2026-10-13.pdf");
    expect(nomeDoArquivo("💜", painel.periodo)).toBe("bi-loja-2026-09-14-a-2026-10-13.pdf");
  });
});

describe("o PDF", () => {
  it("nasce do conteúdo, com emoji no motivo de perda e período de 1 dia, e tem mais de uma página", async () => {
    const bytes = await gerarPdfDoRelatorio(dados);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toBe("BI de Vendas — Toque Leve Confecções");
  });
  it("quem gerou com emoji no nome, valores de 5 dígitos e 366 dias: o PDF não estoura", async () => {
    const grande = soma({ leads: 12000, vendido: 1234567.89, pedidosPagos: 312, hist: [9000, 1000, 500, 400, 50, 30, 20] });
    const bytes = await gerarPdfDoRelatorio({
      ...dados,
      geradoPor: "Ana 💜",
      loja: "Loja 🎉 Paweł",
      painel: { ...painel, atual: grande, funil: { leads: 12000, respondidos: 12000, comPedido: 3000, pagaram: 312 }, serie: Array.from({ length: 366 }, (_, i) => ({ dia: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, leads: i % 7, vendido: i * 10, pedidosPagos: 1, pctNoPrazo: 50 })) },
      vendedoras: { ...vendedoras, loja: grande },
      tendencia: Array.from({ length: 12 }, (_, i) => ({ ...dados.tendencia[0], mes: `2026-${String(i + 1).padStart(2, "0")}`, rotulo: `m${i + 1}/26`, vendido: 999999.99 })),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
  it("período vazio e série de um ponto também viram PDF", async () => {
    const bytes = await gerarPdfDoRelatorio({
      ...dados,
      painel: { ...painel, serie: [{ dia: "2026-10-13", leads: 3, vendido: 0, pedidosPagos: 0, pctNoPrazo: null }], funil: { leads: 0, respondidos: 0, comPedido: 0, pagaram: 0 }, motivos: [], metas: {} },
      vendedoras: { ...vendedoras, pessoas: [] },
      tendencia: [],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
