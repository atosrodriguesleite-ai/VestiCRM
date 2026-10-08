// Guarda RN-073
import { describe, it, expect } from "vitest";
import {
  STATUS_QUE_ACEITAM_TROCA,
  aceitaTroca,
  ajusteDasTrocasPorVariacao,
  chaveDaPeca,
  deltasPorVariacao,
  devolvidasPorChave,
  linhasParaTroca,
  pacoteEfetivo,
  juntarSaidas,
  juntarVoltas,
  movimentosDaTroca,
  nasceAcertada,
  resolucaoValida,
  resolucoesPermitidas,
  restanteDaLinha,
  saldoDeCredito,
  somarTroca,
  textoDaTroca,
  textoDoAcerto,
  validarTroca,
  type LinhaParaTroca,
} from "../troca/regra";
import { PAID_ORDER_STATUSES } from "../orders";
import { STATUS_NA_FILA } from "../etiquetas/separacao-regra";
import { podeRegistrarTroca } from "../troca/registrar";
import { precoDigitado } from "../../app/(app)/pedidos/[id]/trocas-do-pedido";

/**
 * RN-073 · TROCA DE PEÇAS: registro próprio pendurado no pedido pago — o
 * pedido não muda, o estoque anda pelo livro, a diferença fica na troca com
 * a resolução escolhida (cobrar, crédito ou devolução), frete combinado fora
 * da conta.
 */

const linhas: LinhaParaTroca[] = [
  { chave: "v:v-preto-p|32.00", orderItemId: "l1", variantId: "v-preto-p", productId: "p1", name: "Regata Alça", color: "Preto", size: "P", quantity: 3, unitPrice: 32, jaDevolvidas: 0 },
  { chave: "v:v-branco-m|32.00", orderItemId: "l2", variantId: "v-branco-m", productId: "p1", name: "Regata Alça", color: "Branco", size: "M", quantity: 2, unitPrice: 32, jaDevolvidas: 2 },
  { chave: "s:peça apagada|||50.00", orderItemId: "l3", variantId: null, productId: null, name: "Peça apagada", color: null, size: null, quantity: 1, unitPrice: 50, jaDevolvidas: 0 },
];
const P = "v:v-preto-p|32.00";
const M = "v:v-branco-m|32.00";
const APAGADA = "s:peça apagada|||50.00";

describe("RN-073 · em que pedido se registra troca", () => {
  it("vale a peça que já SAIU: venda paga enviada/entregue (RN-001) e a venda a prazo entregue (RN-069), derivado das listas", () => {
    expect(aceitaTroca("ENVIADO")).toBe(true);
    expect(aceitaTroca("ENTREGUE")).toBe(true);
    expect(aceitaTroca("ENTREGUE_A_RECEBER")).toBe(true);
    expect(STATUS_QUE_ACEITAM_TROCA).toHaveLength(PAID_ORDER_STATUSES.length - STATUS_NA_FILA.length + 1);
  });
  it("pedido que ainda consta na loja (pago, em produção, separação) NÃO troca — a Separação lê os itens e o Inventário o livro", () => {
    for (const s of STATUS_NA_FILA) expect(aceitaTroca(s)).toBe(false);
    expect(aceitaTroca("PAGO")).toBe(false);
  });
  it("orçamento, aguardando pagamento e cancelado não trocam (edita ou cancela)", () => {
    expect(aceitaTroca("ORCAMENTO")).toBe(false);
    expect(aceitaTroca("AGUARDANDO_PAGAMENTO")).toBe(false);
    expect(aceitaTroca("CANCELADO")).toBe(false);
  });
  it("a equipe comercial registra; suporte não (mexe em dinheiro)", () => {
    expect(podeRegistrarTroca({ role: "SELLER" })).toBe(true);
    expect(podeRegistrarTroca({ role: "MANAGER" })).toBe(true);
    expect(podeRegistrarTroca({ role: "ADMIN" })).toBe(true);
    expect(podeRegistrarTroca({ role: "SUPPORT" })).toBe(false);
  });
});

describe("RN-073 · o que pode voltar", () => {
  it("o teto é comprado − já devolvido em trocas anteriores", () => {
    expect(restanteDaLinha(linhas[0])).toBe(3);
    expect(restanteDaLinha(linhas[1])).toBe(0);
    expect(restanteDaLinha({ quantity: 1, jaDevolvidas: 5 })).toBe(0);
  });
  it("a chave da peça é a VARIAÇÃO + preço pago; sem variação, o retrato nome|cor|tamanho + preço", () => {
    expect(chaveDaPeca({ variantId: "v1", name: "X", color: "Preto", size: "P", unitPrice: 32 })).toBe("v:v1|32.00");
    expect(chaveDaPeca({ variantId: "v1", name: "X", color: "Preto", size: "P", unitPrice: 32.1 + 0.2 })).toBe("v:v1|32.30");
    expect(chaveDaPeca({ variantId: null, name: " Regata ", color: "PRETO", size: "p", unitPrice: 20 })).toBe("s:regata|preto|p|20.00");
    expect(chaveDaPeca({ variantId: null, name: "Regata", color: null, size: null, unitPrice: 0 })).toBe("s:regata|||0.00");
  });
  it("devolvidasPorChave soma só o sentido VOLTA, pela chave (variação ou retrato, com o preço)", () => {
    const m = devolvidasPorChave([
      { itens: [{ sentido: "VOLTA", variantId: "v1", name: "A", color: null, size: null, unitPrice: 32, quantity: 1 }, { sentido: "SAI", variantId: "v9", name: "B", color: null, size: null, unitPrice: 50, quantity: 9 }] },
      { itens: [{ sentido: "VOLTA", variantId: "v1", name: "A", color: null, size: null, unitPrice: 32, quantity: 1 }, { sentido: "VOLTA", variantId: null, name: "Apagada", color: "Azul", size: "M", unitPrice: 50, quantity: 2 }] },
    ]);
    expect(m.get("v:v1|32.00")).toBe(2);
    expect(m.get("s:apagada|azul|m|50.00")).toBe(2);
    expect(m.size).toBe(2);
  });
  it("linhasParaTroca agrupa por chave e anota o que já voltou — o teto NÃO depende do id da linha (editar itens recria as linhas)", () => {
    const itens = [
      { id: "novo-1", variantId: "v1", productId: "p", name: "Regata", color: "Preto", size: "P", quantity: 2, unitPrice: 32 },
      { id: "novo-2", variantId: "v1", productId: "p", name: "Regata", color: "Preto", size: "P", quantity: 1, unitPrice: 32 },
      // a mesma peça a outro preço (promoção) é OUTRO grupo: devolvê-la vale o que ela custou
      { id: "novo-4", variantId: "v1", productId: "p", name: "Regata", color: "Preto", size: "P", quantity: 1, unitPrice: 20 },
      { id: "novo-3", variantId: null, productId: null, name: "Apagada", color: "Azul", size: "M", quantity: 1, unitPrice: 50 },
    ];
    // a troca anterior guardou a linha com id ANTIGO (apagado) — mas a variação, o retrato e o preço
    const trocas = [{ itens: [
      { sentido: "VOLTA", variantId: "v1", name: "Regata", color: "Preto", size: "P", unitPrice: 32, quantity: 1 },
      { sentido: "VOLTA", variantId: null, name: "Apagada", color: "Azul", size: "M", unitPrice: 50, quantity: 1 },
    ] }];
    const l = linhasParaTroca(itens, trocas);
    expect(l).toHaveLength(3);
    expect(l[0]).toMatchObject({ chave: "v:v1|32.00", orderItemId: "novo-1", quantity: 3, unitPrice: 32, jaDevolvidas: 1 });
    expect(restanteDaLinha(l[0])).toBe(2);
    expect(l[1]).toMatchObject({ chave: "v:v1|20.00", quantity: 1, unitPrice: 20, jaDevolvidas: 0 });
    expect(l[2]).toMatchObject({ chave: "s:apagada|azul|m|50.00", quantity: 1, jaDevolvidas: 1 });
    expect(restanteDaLinha(l[2])).toBe(0);
  });
  it("recusa devolver mais do que resta, dizendo a peça e o número", () => {
    const erro = validarTroca(linhas, [{ chave: P, quantity: 4, destino: "ESTOQUE" }], [{ variantId: "x", quantity: 1, unitPrice: 10 }]);
    expect(erro).toContain("Regata Alça (Preto P)");
    expect(erro).toContain("3 peças");
  });
  it("linha que já voltou toda é recusada com frase própria", () => {
    const erro = validarTroca(linhas, [{ chave: M, quantity: 1, destino: "ESTOQUE" }], [{ variantId: "x", quantity: 1, unitPrice: 10 }]);
    expect(erro).toContain("já voltaram em troca anterior");
  });
  it("a mesma linha mandada duas vezes (estoque + defeito) soma contra o teto", () => {
    const volta = juntarVoltas([
      { chave: P, quantity: 2, destino: "ESTOQUE" },
      { chave: P, quantity: 2, destino: "DEFEITO" },
    ]);
    expect(volta).toHaveLength(2);
    expect(validarTroca(linhas, volta, [{ variantId: "x", quantity: 1, unitPrice: 10 }])).toContain("você marcou 4");
    const ok = juntarVoltas([
      { chave: P, quantity: 1, destino: "ESTOQUE" },
      { chave: P, quantity: 1, destino: "ESTOQUE" },
      { chave: P, quantity: 1, destino: "DEFEITO" },
    ]);
    expect(ok).toEqual([
      { chave: P, quantity: 2, destino: "ESTOQUE" },
      { chave: P, quantity: 1, destino: "DEFEITO" },
    ]);
    expect(validarTroca(linhas, ok, [{ variantId: "x", quantity: 1, unitPrice: 10 }])).toBeNull();
  });
  it("peça de outro pedido, quantidade torta e destino inválido são recusados", () => {
    const sai = [{ variantId: "x", quantity: 1, unitPrice: 10 }];
    expect(validarTroca(linhas, [{ chave: "v:nao-existe", quantity: 1, destino: "ESTOQUE" }], sai)).toContain("não é deste pedido");
    expect(validarTroca(linhas, [{ chave: P, quantity: 0, destino: "ESTOQUE" }], sai)).toContain("Quantidade devolvida");
    expect(validarTroca(linhas, [{ chave: P, quantity: 1.5, destino: "ESTOQUE" }], sai)).toContain("Quantidade devolvida");
    expect(validarTroca(linhas, [{ chave: P, quantity: 1, destino: "LIXO" as never }], sai)).toContain("Destino");
  });
});

describe("RN-073 · troca precisa dos dois lados", () => {
  it("sem peça devolvida não é troca", () => {
    expect(validarTroca(linhas, [], [{ variantId: "x", quantity: 1, unitPrice: 10 }])).toContain("pelo menos uma peça");
  });
  it("devolução sem peça nova não é troca — é cancelamento ou edição", () => {
    expect(validarTroca(linhas, [{ chave: P, quantity: 1, destino: "ESTOQUE" }], [])).toContain("não é troca");
  });
  it("peça que sai: quantidade inteira ≥ 1 e preço ≥ 0", () => {
    const volta = [{ chave: P, quantity: 1, destino: "ESTOQUE" as const }];
    expect(validarTroca(linhas, volta, [{ variantId: "x", quantity: 0, unitPrice: 10 }])).toContain("Quantidade da peça que sai");
    expect(validarTroca(linhas, volta, [{ variantId: "x", quantity: 1, unitPrice: -1 }])).toContain("Preço");
    expect(validarTroca(linhas, volta, [{ variantId: "x", quantity: 1, unitPrice: Number.NaN }])).toContain("Preço");
    expect(validarTroca(linhas, volta, [{ variantId: "x", quantity: 1, unitPrice: 0 }])).toBeNull(); // brinde na troca é válido
  });
  it("juntarSaidas soma a mesma variação e mantém o primeiro preço", () => {
    expect(juntarSaidas([{ variantId: "a", quantity: 1, unitPrice: 30 }, { variantId: "a", quantity: 2, unitPrice: 35 }])).toEqual([
      { variantId: "a", quantity: 3, unitPrice: 30 },
    ]);
  });
});

describe("RN-073 · a conta da diferença", () => {
  it("o que volta vale o preço PAGO no pedido; o que sai vale o combinado", () => {
    const t = somarTroca(linhas, [{ chave: P, quantity: 2, destino: "ESTOQUE" }], [{ variantId: "x", quantity: 1, unitPrice: 80 }]);
    expect(t).toEqual({ valorVolta: 64, valorSai: 80, diferenca: 16 });
  });
  it("centavos fecham (0,1 + 0,2 não vira 0,30000000004)", () => {
    const l: LinhaParaTroca[] = [{ ...linhas[0], unitPrice: 0.1, quantity: 3 }];
    const t = somarTroca(l, [{ chave: P, quantity: 3, destino: "ESTOQUE" }], [{ variantId: "x", quantity: 1, unitPrice: 0.2 }]);
    expect(t.valorVolta).toBe(0.3);
    expect(t.diferenca).toBe(-0.1);
  });
  it("defeito vale igual: a cliente pagou pela peça e ela voltou", () => {
    const t = somarTroca(linhas, [{ chave: P, quantity: 1, destino: "DEFEITO" }], [{ variantId: "v-preto-p", quantity: 1, unitPrice: 32 }]);
    expect(t.diferenca).toBe(0);
  });
});

describe("RN-073 · como acertar a diferença depende do sinal", () => {
  it("zero: nada a resolver; cliente devendo: só cobrar; loja devendo: crédito ou devolução (os dois, decisão do dono)", () => {
    expect(resolucoesPermitidas(0)).toEqual(["SEM_DIFERENCA"]);
    expect(resolucoesPermitidas(0.004)).toEqual(["SEM_DIFERENCA"]);
    expect(resolucoesPermitidas(16)).toEqual(["COBRAR"]);
    expect(resolucoesPermitidas(-16)).toEqual(["CREDITO", "DEVOLUCAO"]);
  });
  it("a resolução que não combina com o sinal é recusada (o servidor não aceita 'crédito' com a cliente devendo)", () => {
    expect(resolucaoValida(16, "CREDITO")).toBe(false);
    expect(resolucaoValida(16, "COBRAR")).toBe(true);
    expect(resolucaoValida(-16, "COBRAR")).toBe(false);
    expect(resolucaoValida(0, "COBRAR")).toBe(false);
    expect(resolucaoValida(0, "SEM_DIFERENCA")).toBe(true);
  });
  it("sem diferença e crédito nascem acertados; cobrança e devolução esperam o dinheiro andar", () => {
    expect(nasceAcertada("SEM_DIFERENCA")).toBe(true);
    expect(nasceAcertada("CREDITO")).toBe(true);
    expect(nasceAcertada("COBRAR")).toBe(false);
    expect(nasceAcertada("DEVOLUCAO")).toBe(false);
  });
  it("o saldo de crédito é a SOMA do livro (concessão positiva, uso negativo)", () => {
    expect(saldoDeCredito([{ valor: 16 }, { valor: -10 }, { valor: 0.1 }, { valor: 0.2 }])).toBe(6.3);
    expect(saldoDeCredito([])).toBe(0);
  });
});

describe("RN-073 · os movimentos do livro (RN-003)", () => {
  const ctx = { numeroDaTroca: 1, pedido: "#0012", estoqueDoPedidoEDaqui: true };
  it("peça boa que volta = ENTRADA com pedido; peça que sai = SAÍDA com pedido", () => {
    const movs = movimentosDaTroca(linhas, [{ chave: P, quantity: 2, destino: "ESTOQUE" }], [{ variantId: "v-novo", quantity: 1, unitPrice: 50 }], ctx);
    expect(movs).toEqual([
      { variantId: "v-preto-p", type: "ENTRADA", quantity: 2, comPedido: true, reason: "Troca 1 — pedido #0012: devolvida pela cliente", deltaEstoque: 2 },
      { variantId: "v-novo", type: "SAIDA", quantity: 1, comPedido: true, reason: "Troca 1 — pedido #0012: peça levada pela cliente", deltaEstoque: -1 },
    ]);
  });
  it("defeito: ENTRADA presa ao pedido + SAÍDA solta ('baixa por defeito') — o estoque não muda, mas o pedido deixa de segurar a peça", () => {
    const movs = movimentosDaTroca(linhas, [{ chave: P, quantity: 1, destino: "DEFEITO" }], [{ variantId: "v-novo", quantity: 1, unitPrice: 50 }], ctx);
    expect(movs.slice(0, 2)).toEqual([
      { variantId: "v-preto-p", type: "ENTRADA", quantity: 1, comPedido: true, reason: "Troca 1 — pedido #0012: devolvida com defeito", deltaEstoque: 0 },
      { variantId: "v-preto-p", type: "SAIDA", quantity: 1, comPedido: false, reason: "Troca 1 — pedido #0012: baixa por defeito", deltaEstoque: 0 },
    ]);
    // o saldo do livro DO PEDIDO cai em 1 (SAÍDA da venda − ENTRADA da troca):
    // cancelar depois devolve só o que a cliente ainda tem
    const doPedido = movs.filter((m) => m.comPedido);
    const saldo = doPedido.reduce((s, m) => s + (m.type === "SAIDA" ? m.quantity : -m.quantity), 0);
    expect(saldo).toBe(-1 + 1); // −1 da entrada, +1 da saída da peça nova
  });
  it("venda da loja online: os movimentos NÃO levam o pedido (o livro daqui nunca teve a saída dela)", () => {
    const movs = movimentosDaTroca(linhas, [{ chave: P, quantity: 1, destino: "ESTOQUE" }], [{ variantId: "v-novo", quantity: 1, unitPrice: 50 }], { ...ctx, estoqueDoPedidoEDaqui: false });
    expect(movs.every((m) => m.comPedido === false)).toBe(true);
    // mas o estoque anda do mesmo jeito: é movimento real, espelhado para lá
    expect(deltasPorVariacao(movs)).toEqual([{ variantId: "v-preto-p", delta: 1 }, { variantId: "v-novo", delta: -1 }]);
  });
  it("linha sem vínculo (variação apagada) volta sem mexer no estoque — não há onde devolver", () => {
    const movs = movimentosDaTroca(linhas, [{ chave: APAGADA, quantity: 1, destino: "ESTOQUE" }], [{ variantId: "v-novo", quantity: 1, unitPrice: 50 }], ctx);
    expect(movs).toHaveLength(1);
    expect(movs[0].variantId).toBe("v-novo");
  });
  it("deltas somam por variação e deixam o zero de fora (troca da mesma peça por outra igual, defeito)", () => {
    const movs = movimentosDaTroca(linhas, [{ chave: P, quantity: 1, destino: "ESTOQUE" }], [{ variantId: "v-preto-p", quantity: 1, unitPrice: 32 }], ctx);
    expect(deltasPorVariacao(movs)).toEqual([]);
  });
});

describe("RN-073 · o pacote efetivo é itens ± trocas (edição de itens depois da troca)", () => {
  it("peça devolvida (boa ou com defeito) sai da conta; peça levada entra; sem variação não conta", () => {
    const ajuste = ajusteDasTrocasPorVariacao([
      { itens: [
        { sentido: "VOLTA", variantId: "v-p", quantity: 1, destino: "ESTOQUE" },
        { sentido: "VOLTA", variantId: "v-p", quantity: 1, destino: "DEFEITO" },
        { sentido: "SAI", variantId: "v-m", quantity: 2 },
        { sentido: "VOLTA", variantId: null, quantity: 5 },
      ] },
    ]);
    expect(ajuste.get("v-p")).toBe(-2);
    expect(ajuste.get("v-m")).toBe(2);
    expect(ajuste.size).toBe(2);
  });
  it("a régua do reconciliador com o ajuste: nada é devolvido nem baixado de novo só por editar o preço", () => {
    // pedido 3× P; troca: volta 1 P, leva 1 M; livro do pedido: P 2, M 1
    const ajuste = new Map([["v-p", -1], ["v-m", 1]]);
    const livro = new Map([["v-p", 2], ["v-m", 1]]);
    const antigo = new Map([["v-p", 3]]);
    const novo = new Map([["v-p", 3]]); // só o preço mudou
    for (const v of ["v-p", "v-m"]) {
      const t = ajuste.get(v) ?? 0;
      const antes = Math.max(0, (antigo.get(v) ?? 0) + t);
      const agora = Math.max(0, (novo.get(v) ?? 0) + t);
      const baixar = Math.max(0, agora - antes);
      const devolver = Math.max(0, (livro.get(v) ?? 0) + baixar - agora);
      expect(baixar).toBe(0);
      expect(devolver).toBe(0);
    }
    // tirar a P inteira do pedido devolve só as 2 que a cliente ainda tem (nunca negativo)
    const agoraP = Math.max(0, 0 + -1);
    expect(Math.max(0, 2 + 0 - agoraP)).toBe(2);
  });
});

describe("RN-073 · o pacote efetivo como lista (o que o pedido restaurado volta a reservar)", () => {
  it("itens ± trocas, por variação, nunca negativo; peça só das trocas usa o retrato delas", () => {
    const itens = [{ variantId: "v-p", quantity: 3, name: "Regata", color: "Preto", size: "P" }, { variantId: null, quantity: 1, name: "Apagada", color: null, size: null }];
    const trocas = [
      { itens: [
        { sentido: "VOLTA", variantId: "v-p", quantity: 1, name: "Regata", color: "Preto", size: "P" },
        { sentido: "SAI", variantId: "v-m", quantity: 1, name: "Regata", color: "Preto", size: "M" },
      ] },
      { itens: [
        { sentido: "VOLTA", variantId: "v-p", quantity: 2, name: "Regata", color: "Preto", size: "P" },
        { sentido: "SAI", variantId: "v-c", quantity: 1, name: "Cropped", color: "Azul", size: "G" },
      ] },
    ];
    expect(pacoteEfetivo(itens, trocas)).toEqual([
      { variantId: "v-m", quantity: 1, name: "Regata", color: "Preto", size: "M" },
      { variantId: "v-c", quantity: 1, name: "Cropped", color: "Azul", size: "G" },
    ]);
    expect(pacoteEfetivo(itens, [])).toEqual([{ variantId: "v-p", quantity: 3, name: "Regata", color: "Preto", size: "P" }]);
  });
});

describe("RN-073 · o preço digitado na tela", () => {
  it("número de verdade vale; vazio ou no meio da digitação NÃO vira zero; zero explícito é brinde", () => {
    expect(precoDigitado("48")).toBe(48);
    expect(precoDigitado("48,5")).toBe(48.5);
    expect(precoDigitado("R$ 1.248,90")).toBe(1248.9);
    expect(precoDigitado("")).toBeNull();
    expect(precoDigitado("R$ ")).toBeNull();
    expect(precoDigitado("abc")).toBeNull();
    expect(precoDigitado("48,")).toBeNull();
    expect(precoDigitado("0")).toBe(0);
    expect(precoDigitado("0,00")).toBe(0);
  });
});

describe("RN-073 · a história do pedido conta a troca", () => {
  it("frase legível: quem, o que voltou (com defeito marcado), o que levou, o dinheiro, motivo e frete", () => {
    const t = textoDaTroca({
      numero: 2,
      autor: "Lara",
      volta: [{ nome: "Regata Alça (Preto P)", quantity: 1, destino: "DEFEITO" }, { nome: "Regata Alça (Preto M)", quantity: 1, destino: "ESTOQUE" }],
      sai: [{ nome: "Cropped (Azul G)", quantity: 2 }],
      diferenca: -16,
      resolucao: "CREDITO",
      motivo: "Defeito",
      freteCombinado: "cliente paga a volta",
    });
    expect(t).toBe(
      "Troca 2 registrada por Lara: voltou 1× Regata Alça (Preto P) (defeito), 1× Regata Alça (Preto M); levou 2× Cropped (Azul G); diferença de R$ 16,00 virou crédito na ficha da cliente. Motivo: Defeito. Frete: cliente paga a volta."
    );
  });
  it("cobrança, devolução e sem diferença têm frases próprias", () => {
    const base = { numero: 1, autor: "Ana", volta: [{ nome: "A", quantity: 1, destino: "ESTOQUE" as const }], sai: [{ nome: "B", quantity: 1 }] };
    expect(textoDaTroca({ ...base, diferenca: 10, resolucao: "COBRAR" })).toContain("diferença de R$ 10,00 a cobrar da cliente");
    expect(textoDaTroca({ ...base, diferenca: -10, resolucao: "DEVOLUCAO" })).toContain("diferença de R$ 10,00 a devolver para a cliente");
    expect(textoDaTroca({ ...base, diferenca: 0, resolucao: "SEM_DIFERENCA" })).toContain("sem diferença de valor.");
  });
  it("o acerto registra quem confirmou e o valor", () => {
    expect(textoDoAcerto({ numero: 1, autor: "Ana", resolucao: "COBRAR", diferenca: 10 })).toBe(
      "Troca 1: diferença de R$ 10,00 recebida da cliente — confirmado por Ana."
    );
    expect(textoDoAcerto({ numero: 1, autor: "Ana", resolucao: "DEVOLUCAO", diferenca: -10 })).toContain("devolução de R$ 10,00 feita à cliente");
  });
});
