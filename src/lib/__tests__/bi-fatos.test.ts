// Guarda RN-082
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BALDES_MIN,
  DIAS_FALTANTES_POR_RODADA,
  DIAS_VIVOS,
  baldeDoTempo,
  calcularFatos,
  diasComJanelaCompleta,
  diasDaRodada,
  inicioDoDiaSP,
  ultimosDias,
  type EntradaDosFatos,
} from "../bi/fatos";
import { encaixarPeriodo, medianaDaDistribuicao, periodoAnterior, somarDias, variacao } from "../bi/painel";
import { HORARIO_SUGERIDO } from "../bi/horario-comercial";
import { itemVisivel } from "../menu-grupos";
import { MODULOS } from "../modulos";

/**
 * RN-082 — o BI lê FATOS DIÁRIOS prontos (loja × dia, calendário de SP),
 * calculados de carona: leads por origem, esperas e respostas (RN-080) em
 * minutos de atendimento (RN-079), pedidos criados e pagos (RN-001/002). A
 * chave do módulo abre só a tela; a coleta é de toda loja (ADR-019).
 */

const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);
const msg = (
  conversationId: string,
  direction: "IN" | "OUT",
  quando: Date,
  extra: Partial<EntradaDosFatos["mensagens"][number]> = {}
) => ({
  conversationId,
  direction,
  kind: "TEXT" as const,
  createdAt: quando,
  authorId: direction === "OUT" ? "ana" : null,
  automatica: false,
  ...extra,
});
// 12/10/2026 é segunda; prazo 30 min no horário sugerido; "agora" = terça 12:00
const regua = { horario: HORARIO_SUGERIDO, prazoMin: 30, agora: sp("2026-10-13", "12:00") };

describe("o calendário dos dias", () => {
  it("os últimos N dias terminam em hoje, do mais antigo ao mais novo", () => {
    expect(ultimosDias("2026-10-13", 3)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13"]);
    // virada de mês e de ano
    expect(ultimosDias("2026-01-01", 2)).toEqual(["2025-12-31", "2026-01-01"]);
  });
  it("a 0h de SP de um dia é 03:00 UTC", () => {
    expect(inicioDoDiaSP("2026-10-13").toISOString()).toBe("2026-10-13T03:00:00.000Z");
  });
  it("a rodada refaz os 8 dias vivos e preenche os que faltam, do mais recente para trás, com teto", () => {
    const hoje = "2026-10-13";
    const nenhum = diasDaRodada(hoje, new Set());
    expect(nenhum).toHaveLength(DIAS_VIVOS + DIAS_FALTANTES_POR_RODADA);
    expect(nenhum[nenhum.length - 1]).toBe(hoje);
    expect(nenhum[0]).toBe(ultimosDias(hoje, DIAS_VIVOS + DIAS_FALTANTES_POR_RODADA)[0]);
    // com os 90 dias gravados, só os vivos
    const todos = new Set(ultimosDias(hoje, 90));
    expect(diasDaRodada(hoje, todos)).toEqual(ultimosDias(hoje, DIAS_VIVOS));
    // com um buraco no meio, ele entra
    todos.delete("2026-09-01");
    expect(diasDaRodada(hoje, todos)).toContain("2026-09-01");
  });
  it("leitura que bateu no teto grava só os dias DEPOIS do primeiro dia lido (que veio pela metade)", () => {
    const dias = ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];
    expect(diasComJanelaCompleta(dias, "2026-10-11", true)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(diasComJanelaCompleta(dias, "2026-10-11", false)).toEqual(dias);
    expect(diasComJanelaCompleta(dias, null, true)).toEqual(dias);
  });
  it("os baldes do tempo de resposta", () => {
    expect(baldeDoTempo(0)).toBe(0);
    expect(baldeDoTempo(5)).toBe(0);
    expect(baldeDoTempo(5.1)).toBe(1);
    expect(baldeDoTempo(240)).toBe(BALDES_MIN.length - 1);
    expect(baldeDoTempo(1000)).toBe(BALDES_MIN.length);
  });
});

describe("a conta dos fatos de um dia", () => {
  const entrada: EntradaDosFatos = {
    mensagens: [
      // c1: espera de 10:00 respondida 10:20 (no prazo) — e um robô no meio, que não conta
      msg("c1", "IN", sp("2026-10-12", "10:00")),
      msg("c1", "OUT", sp("2026-10-12", "10:05"), { automatica: true, authorId: null }),
      msg("c1", "OUT", sp("2026-10-12", "10:20")),
      // c2: espera das 17:50 de segunda respondida 08:30 de terça = 40 min de atendimento (fora do prazo),
      // e ela CONTA NO DIA DA CHEGADA (segunda)
      msg("c2", "IN", sp("2026-10-12", "17:50")),
      msg("c2", "OUT", sp("2026-10-13", "08:30")),
      // c3: cliente escreveu segunda 16:00 e ninguém respondeu até agora (terça 12:00): aberta, estourou
      msg("c3", "IN", sp("2026-10-12", "16:00")),
      // c4: conversa encerrada com o "obrigada" no fim
      msg("c4", "IN", sp("2026-10-12", "11:00")),
      msg("c4", "OUT", sp("2026-10-12", "11:02")),
      msg("c4", "IN", sp("2026-10-12", "11:03")),
      // c5: espera de terça, 5 min
      msg("c5", "IN", sp("2026-10-13", "09:00")),
      msg("c5", "OUT", sp("2026-10-13", "09:05")),
    ],
    conversas: [
      { id: "c1", customerId: "k1", status: "OPEN" },
      { id: "c2", customerId: "k2", status: "OPEN" },
      { id: "c3", customerId: "k3", status: "OPEN" },
      { id: "c4", customerId: "k4", status: "CLOSED" },
      { id: "c5", customerId: "k5", status: "OPEN" },
    ],
    contatos: [
      { id: "k1", createdAt: sp("2026-10-12", "10:00"), origin: "WHATSAPP" },
      { id: "k3", createdAt: sp("2026-10-12", "16:00"), origin: "CATALOGO_PUBLICO" },
      { id: "k4", createdAt: sp("2026-10-12", "11:00"), origin: "WHATSAPP" },
      // cadastrada ANTES de qualquer mensagem humana da conversa dela: respondida
      { id: "k5", createdAt: sp("2026-10-13", "08:00"), origin: "INDICACAO" },
      // k6: contato de segunda sem conversa nenhuma (cadastro manual) — lead, não respondido
      { id: "k6", createdAt: sp("2026-10-12", "20:00"), origin: "MANUAL" },
    ],
    pedidos: [
      // criado e pago segunda
      { customerId: "k1", createdAt: sp("2026-10-12", "10:30"), paidAt: sp("2026-10-12", "11:00"), status: "PAGO", netTotal: 100.5 },
      // criado segunda, pago terça: conta como criado na segunda e pago na terça
      { customerId: "k4", createdAt: sp("2026-10-12", "12:00"), paidAt: sp("2026-10-13", "09:00"), status: "ENVIADO", netTotal: 200 },
      // cancelado: não é pedido criado nem pago
      { customerId: "k3", createdAt: sp("2026-10-12", "13:00"), paidAt: null, status: "CANCELADO", netTotal: 50 },
      // orçamento aberto: criado, não pago
      { customerId: "k6", createdAt: sp("2026-10-12", "21:00"), paidAt: null, status: "ORCAMENTO", netTotal: 80 },
      // a prazo entregue (RN-069): tem paidAt? não — não é faturamento
      { customerId: "k2", createdAt: sp("2026-10-12", "14:00"), paidAt: null, status: "ENTREGUE_A_RECEBER", netTotal: 300 },
    ],
    regua,
  };

  it("segunda: leads por origem, respondidos, esperas por como terminaram, pedidos criados e pagos", () => {
    const [seg] = calcularFatos(entrada, ["2026-10-12"]);
    expect(seg).toMatchObject({
      dia: "2026-10-12",
      leads: 4,
      origens: { WHATSAPP: 2, CATALOGO_PUBLICO: 1, MANUAL: 1 },
      // funil por fatos: k1 (pago), k4 (pago), k6 (orçamento) fizeram pedido; k3 só tem cancelado
      leadsComPedido: 3,
      leadsPagaram: 2,
      leadsRespondidos: 2, // k1 e k4; k3 e k6 não
      esperas: 5, // c1, c2, c3, c4 (a pergunta) e c4 de novo (o "obrigada")
      respondidas: 3, // c1 (20 min), c2 (40 min) e c4 (2 min)
      noPrazo: 2,
      foraDoPrazo: 2, // c2 respondida fora + c3 aberta e estourada
      semResposta: 1, // c3
      encerradasSemResposta: 1, // o "obrigada" de c4
      medianaMin: 20, // 2, 20, 40
      p90Min: 40,
      pedidos: 4, // k1, k4, k6, k2 — o cancelado não
      pedidosPagos: 1,
      vendido: 100.5,
    });
    // distribuição: 2 min no balde ≤5 (índice 0), 20 no ≤30 (2), 40 no ≤60 (3)
    expect(seg.hist).toEqual([1, 0, 1, 1, 0, 0, 0]);
  });

  it("terça: a espera de c2 NÃO conta de novo; o pagamento de k4 conta na terça", () => {
    const [ter] = calcularFatos(entrada, ["2026-10-13"]);
    expect(ter).toMatchObject({
      leads: 1,
      leadsRespondidos: 1,
      esperas: 1, // só c5
      respondidas: 1,
      noPrazo: 1,
      medianaMin: 5,
      pedidos: 0,
      pedidosPagos: 1,
      vendido: 200,
    });
  });

  it("a espera que começou num dia anterior NÃO renasce pela mensagem seguinte da cliente, e a resposta a ela é vista", () => {
    // domingo 23:00 a cliente escreve; segunda 09:00 escreve "oi?"; segunda 09:10 a loja responde.
    // Calculando só a segunda com a leitura incluindo o domingo: nenhuma espera nova na segunda
    // (a espera é do domingo) — e a resposta não vira "abordagem sem pergunta".
    const msgs = [
      msg("c9", "IN", sp("2026-10-11", "23:00")),
      msg("c9", "IN", sp("2026-10-12", "09:00")),
      msg("c9", "OUT", sp("2026-10-12", "09:10")),
    ];
    const base = { ...entrada, mensagens: msgs, conversas: [{ id: "c9", customerId: "k9", status: "OPEN" }], contatos: [], pedidos: [] };
    const [seg] = calcularFatos(base, ["2026-10-12"]);
    expect(seg.esperas).toBe(0);
    // a espera é do domingo: da chegada (domingo fechado) até 09:10 de segunda são 70 min de atendimento
    const [dom] = calcularFatos(base, ["2026-10-11"]);
    expect(dom).toMatchObject({ esperas: 1, respondidas: 1, noPrazo: 0, foraDoPrazo: 1, medianaMin: 70 });
    // sem a leitura do domingo (a janela errada), a segunda inventava uma espera
    const [segSemDomingo] = calcularFatos({ ...base, mensagens: msgs.slice(1) }, ["2026-10-12"]);
    expect(segSemDomingo.esperas).toBe(1);
  });

  it("dia sem nada vem zerado, com mediana nula (não zero)", () => {
    const [dom] = calcularFatos(entrada, ["2026-10-11"]);
    expect(dom).toMatchObject({ leads: 0, esperas: 0, medianaMin: null, p90Min: null, pedidos: 0, vendido: 0 });
  });

  it("sem horário cadastrado a mesma espera de c2 vale 880 min — o horário é o que torna a conta justa", () => {
    const [seg] = calcularFatos({ ...entrada, regua: { ...regua, horario: null } }, ["2026-10-12"]);
    expect(seg.p90Min).toBe(880);
  });
});

describe("as somas do painel", () => {
  const linha = (dia: string, extra: Partial<Parameters<typeof somarDias>[0][number]> = {}) => ({
    dia,
    leads: 0,
    origens: "{}",
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
    hist: "[0,0,0,0,0,0,0]",
    pedidos: 0,
    pedidosPagos: 0,
    vendido: 0,
    ...extra,
  });
  it("soma dias, lê a % no prazo das decididas, o ticket e a mediana aproximada pelos baldes", () => {
    const s = somarDias([
      linha("2026-10-12", { leads: 3, noPrazo: 2, foraDoPrazo: 1, hist: "[2,0,1,0,0,0,0]", pedidosPagos: 2, vendido: 100, origens: '{"WHATSAPP":3}' }),
      linha("2026-10-13", { leads: 1, noPrazo: 1, hist: "[0,1,0,0,0,0,0]", pedidosPagos: 1, vendido: 50, origens: '{"WHATSAPP":1,"MANUAL":0}' }),
    ]);
    expect(s).toMatchObject({ leads: 4, pctNoPrazo: 75, pedidosPagos: 3, vendido: 150, ticket: 50, origens: { WHATSAPP: 4, MANUAL: 0 } });
    expect(s.hist).toEqual([2, 1, 1, 0, 0, 0, 0]);
    expect(s.medianaAproxMin).toBe(5); // metade das 4 cabe no primeiro balde
    expect(medianaDaDistribuicao([0, 0, 0, 0, 0, 0, 3])).toBe(Infinity);
    expect(medianaDaDistribuicao([0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
  it("sem fato nenhum, os números são nulos — nunca zero disfarçado", () => {
    const s = somarDias([]);
    expect(s).toMatchObject({ pctNoPrazo: null, ticket: null, medianaAproxMin: null, leads: 0 });
  });
  it("o período anterior tem o mesmo tamanho, colado antes; o teto é um ano; variação sem base é nula", () => {
    expect(periodoAnterior({ de: "2026-10-01", ate: "2026-10-07" })).toEqual({ de: "2026-09-24", ate: "2026-09-30" });
    expect(encaixarPeriodo({ de: "2024-01-01", ate: "2026-10-13" })).toEqual({ de: ultimosDias("2026-10-13", 366)[0], ate: "2026-10-13" });
    expect(encaixarPeriodo({ de: "2026-10-13", ate: "2026-10-01" })).toEqual({ de: "2026-10-01", ate: "2026-10-01" });
    expect(variacao(120, 100)).toBe(20);
    expect(variacao(5, 0)).toBeNull();
  });
});

describe("a chave do módulo", () => {
  it("o item do menu só aparece com a chave da loja E para gerência", () => {
    const item = { href: "/bi", biOnly: true, managerOnly: true };
    expect(itemVisivel(item, { role: "ADMIN", biEnabled: true })).toBe(true);
    expect(itemVisivel(item, { role: "MANAGER", biEnabled: true })).toBe(true);
    expect(itemVisivel(item, { role: "SELLER", biEnabled: true })).toBe(false);
    expect(itemVisivel(item, { role: "SUPPORT", biEnabled: true })).toBe(false);
    expect(itemVisivel(item, { role: "ADMIN", biEnabled: false })).toBe(false);
  });
  it("o módulo está no catálogo com preço 0 até o dono definir", () => {
    const bi = MODULOS.find((m) => m.key === "BI");
    expect(bi?.flag).toBe("biEnabled");
    expect(bi?.precoTabela).toBe(0);
  });
  it("os fatos são calculados de carona no sync da inbox, para toda loja (sem a chave)", () => {
    const rota = readFileSync(join(process.cwd(), "src/app/api/conversations/route.ts"), "utf8");
    expect(rota).toMatch(/after\(\(\) => atualizarFatosDoBiSeDevido\(user\.companyId\)\)/);
    // o motor nunca filtra a loja pela chave do módulo
    const fatos = readFileSync(join(process.cwd(), "src/lib/bi/fatos.ts"), "utf8");
    expect(fatos).not.toMatch(/biEnabled:/);
  });
});
