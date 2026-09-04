import { describe, it, expect } from "vitest";
import { escolherCobrancaAConfirmar, type CobrancaDoPedido } from "../orders";

// Guarda RN-047 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * MARCAR "PAGO" NA MÃO CONFIRMA UMA COBRANÇA SÓ.
 *
 * Relato do dono (03/09/2026): "o cliente pagou R$ 553,50, mas no sistema
 * consta que ele pagou R$ 554,50". O pedido #0076 tinha DUAS cobranças
 * pendentes — a que nasce com o pedido e o link que a vendedora gerou — e
 * marcar pago confirmava as duas: R$ 1.109,00 registrados, e a ficha
 * anunciando "pago a mais R$ 555,50", dinheiro que nunca existiu.
 */

const em = (min: number) => new Date(Date.UTC(2026, 8, 1, 12, min));

const nascida: CobrancaDoPedido = {
  id: "nasceu-com-o-pedido",
  status: "PENDENTE",
  amount: 554.5,
  mpPaymentId: null,
  createdAt: em(0),
};
const linkGerado: CobrancaDoPedido = {
  id: "link-que-a-vendedora-mandou",
  status: "PENDENTE",
  amount: 554.5,
  mpPaymentId: null,
  createdAt: em(30),
};

describe("uma cobrança só vira pagamento", () => {
  /** O caso do relato, ponta a ponta. */
  it("com duas cobranças pendentes, confirma UMA e invalida a irmã", () => {
    const d = escolherCobrancaAConfirmar([nascida, linkGerado], 554.5);
    expect(d.confirmar).toBe(linkGerado.id);
    expect(d.invalidar).toEqual([nascida.id]);
  });

  /**
   * QUAL delas importa: a mais recente é o link/QR que a vendedora acabou de
   * mandar para a cliente — a que nasceu com o pedido costuma nem ter sido
   * enviada.
   */
  it("sem gateway envolvido, fica com a mais recente", () => {
    const d = escolherCobrancaAConfirmar([linkGerado, nascida], 554.5);
    expect(d.confirmar).toBe(linkGerado.id);
  });

  /**
   * A COBRANÇA DO GATEWAY FICA DE FORA enquanto houver outra. Quem marca na
   * mão recebeu POR FORA (se tivesse entrado pelo gateway, o webhook já teria
   * liquidado sozinho) — e carimbar a do gateway como paga desarmaria o
   * alarme de "🚨 SEGUNDO pagamento": ele só dispara enquanto existir linha
   * PENDENTE com aquele id, e sem ela a cliente pagando o QR depois faria o
   * dinheiro em dobro entrar calado (achado da revisão, 03/09/2026).
   */
  it("a cobrança do gateway fica pendente enquanto houver outra", () => {
    const doGateway: CobrancaDoPedido = {
      id: "pix-do-mercado-pago",
      status: "PENDENTE",
      amount: 554.5,
      mpPaymentId: "MP-123",
      createdAt: em(60),
    };
    const d = escolherCobrancaAConfirmar([doGateway, linkGerado], 554.5);
    expect(d.confirmar).toBe(linkGerado.id);
    expect(d.invalidar).toEqual([doGateway.id]);
  });

  /** Só existe a do gateway: aí ela é a que vira paga, sem alternativa. */
  it("sozinha, a do gateway é confirmada", () => {
    const doGateway: CobrancaDoPedido = {
      ...nascida,
      id: "pix-sozinho",
      mpPaymentId: "MP-123",
    };
    expect(escolherCobrancaAConfirmar([doGateway], 554.5).confirmar).toBe(doGateway.id);
  });

  it("uma cobrança só: confirma ela e não invalida nada", () => {
    const d = escolherCobrancaAConfirmar([nascida], 554.5);
    expect(d.confirmar).toBe(nascida.id);
    expect(d.invalidar).toEqual([]);
  });
});

describe("o valor confirmado é o que FALTA", () => {
  /**
   * Mesma régua da baixa da porta do Financeiro (RN-033). Sem isso, a
   * cobrança gerada antes de uma edição carimbava o valor velho como recebido.
   */
  it("cobrança com valor velho entra pelo valor de agora", () => {
    const d = escolherCobrancaAConfirmar([nascida], 553.5);
    expect(d.confirmar).toBe(nascida.id);
    expect(d.ajustarPara).toBe(553.5);
  });

  it("valor que já bate não é reescrito à toa", () => {
    expect(escolherCobrancaAConfirmar([nascida], 554.5).ajustarPara).toBeNull();
  });

  /**
   * O NÚMERO DO GATEWAY NÃO SE REESCREVE: ele é o que o provedor tem, e mudá-lo
   * quebraria a conferência com o extrato do Mercado Pago / InfinitePay.
   */
  it("cobrança do gateway mantém o valor que o provedor conhece", () => {
    const doGateway: CobrancaDoPedido = {
      ...nascida,
      id: "pix-pago-la",
      mpPaymentId: "MP-123",
    };
    const d = escolherCobrancaAConfirmar([doGateway], 553.5);
    expect(d.confirmar).toBe(doGateway.id);
    expect(d.ajustarPara).toBeNull();
  });

  /**
   * SINAL JÁ PAGO: metade entrou pelo gateway, marcar pago cobre só o resto —
   * confirmar o valor cheio faria o pedido constar como pago a mais.
   */
  it("com parte já paga, a cobrança entra pelo que falta", () => {
    const sinal: CobrancaDoPedido = {
      id: "sinal",
      status: "CONFIRMADO",
      amount: 300,
      mpPaymentId: "MP-1",
      createdAt: em(0),
    };
    const d = escolherCobrancaAConfirmar([sinal, linkGerado], 554.5);
    expect(d.confirmar).toBe(linkGerado.id);
    expect(d.ajustarPara).toBe(254.5);
  });

  /**
   * Pedido JÁ COBERTO (a cliente pagou pelo gateway antes de alguém mexer no
   * status): nada vira pagamento novo — as pendentes só param de valer.
   */
  it("pedido já coberto não ganha pagamento nenhum", () => {
    const pago: CobrancaDoPedido = {
      id: "pago-la",
      status: "CONFIRMADO",
      amount: 554.5,
      mpPaymentId: "MP-1",
      createdAt: em(0),
    };
    const d = escolherCobrancaAConfirmar([pago, linkGerado], 554.5);
    expect(d.confirmar).toBeNull();
    expect(d.invalidar).toEqual([linkGerado.id]);
  });

  /** Cobrança estornada é história: não volta a ser candidata nem conta como pago. */
  it("estornada não é candidata nem soma como recebida", () => {
    const estornada: CobrancaDoPedido = {
      id: "estornada",
      status: "ESTORNADO",
      amount: 554.5,
      mpPaymentId: null,
      createdAt: em(40),
    };
    const d = escolherCobrancaAConfirmar([estornada, nascida], 554.5);
    expect(d.confirmar).toBe(nascida.id);
    expect(d.invalidar).toEqual([]);
  });

  it("sem cobrança nenhuma, não há o que confirmar", () => {
    const d = escolherCobrancaAConfirmar([], 554.5);
    expect(d).toEqual({ confirmar: null, ajustarPara: null, invalidar: [] });
  });
});
