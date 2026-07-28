import { describe, expect, it } from "vitest";
import { lerEvento, resumoDoPeriodo } from "../eventos";

/**
 * Duas regras travadas aqui:
 *  1. quando é falha, a tela diz ONDE errou, POR QUÊ e O QUE FAZER;
 *  2. quando NÃO é falha, nada de vermelho.
 */

describe("evento que deu certo não vira alarme", () => {
  it("mensagem enviada com sucesso é OK e sem culpa nenhuma", () => {
    const r = lerEvento({ type: "message.sent", status: "OK" });
    expect(r.gravidade).toBe("OK");
    expect(r.titulo).toBe("Mensagem enviada pelo sistema");
    expect(r.ondeErrou).toBeUndefined();
    expect(r.oQueFazer).toBeUndefined();
  });

  it("recibo de entrega é OK", () => {
    expect(lerEvento({ type: "status.update", status: "OK" }).gravidade).toBe("OK");
  });
});

describe("falha diz onde, por quê e o que fazer", () => {
  const falha = (error: string, payload?: string) =>
    lerEvento({ type: "message.sent", status: "ERRO", error, payload });

  it("WhatsApp desconectado", () => {
    const r = falha("WhatsApp não conectado. Vá em Comunicação e conecte o número pelo QR Code.");
    expect(r.gravidade).toBe("ERRO");
    expect(r.ondeErrou).toContain("Ao enviar");
    expect(r.porque).toContain("não está conectado");
    expect(r.oQueFazer).toContain("QR Code");
  });

  it("servidor fora do ar", () => {
    const r = falha("Servidor de conexão do WhatsApp fora do ar — tente novamente em instantes.");
    expect(r.porque).toContain("fora do ar");
    expect(r.oQueFazer).toContain("voltar sozinho");
  });

  it("não conseguiu entregar (número errado / bloqueio)", () => {
    const r = falha("O WhatsApp não conseguiu entregar esta mensagem.");
    expect(r.porque).toContain("número errado");
    expect(r.oQueFazer).toContain("Confira o número");
  });

  it("recusa 4xx aponta número ou arquivo", () => {
    const r = falha("O WhatsApp recusou o envio (HTTP 400). Detalhe: bad request");
    expect(r.porque).toContain("recusou");
    expect(r.oQueFazer).toContain("arquivo");
  });

  it("erro 5xx é do servidor, não da loja", () => {
    expect(falha("O WhatsApp recusou o envio (HTTP 503).").porque).toContain("erro interno");
  });

  it("timeout avisa para conferir ANTES de reenviar (senão manda duas vezes)", () => {
    const r = falha("Erro no envio: TimeoutError: signal timed out");
    expect(r.oQueFazer).toContain("antes de reenviar");
  });

  it("mostra o número da cliente quando o evento guardou", () => {
    const r = falha("qualquer coisa", JSON.stringify({ to: "5511999998888", preview: "oi" }));
    expect(r.ondeErrou).toContain("5511999998888");
  });

  it("payload quebrado não derruba a leitura", () => {
    expect(() => falha("erro", "{isso não é json")).not.toThrow();
  });

  it("erro desconhecido ainda diz o que fazer", () => {
    const r = falha("KABOOM inesperado");
    expect(r.porque).toContain("KABOOM");
    expect(r.oQueFazer).toContain("suporte");
  });
});

describe("resumo das últimas 24h", () => {
  it("dia normal: nenhuma falha", () => {
    const r = resumoDoPeriodo({ recebidas: 40, enviadas: 30, falhas: 0, naFila: 0 });
    expect(r.gravidade).toBe("OK");
    expect(r.titulo).toContain("Nenhuma falha");
    expect(r.detalhe).toContain("40 recebida");
  });

  it("falha manda no resumo, mesmo com muito movimento", () => {
    const r = resumoDoPeriodo({ recebidas: 500, enviadas: 500, falhas: 2, naFila: 0 });
    expect(r.gravidade).toBe("ERRO");
    expect(r.titulo).toContain("2 mensagens não foram entregues");
  });

  it("singular e plural corretos", () => {
    expect(resumoDoPeriodo({ recebidas: 1, enviadas: 1, falhas: 1, naFila: 0 }).titulo).toContain(
      "1 mensagem não foi entregue"
    );
  });

  it("mensagem presa na fila é atenção, não erro", () => {
    const r = resumoDoPeriodo({ recebidas: 5, enviadas: 5, falhas: 0, naFila: 3 });
    expect(r.gravidade).toBe("ATENCAO");
  });

  it("silêncio total pede conferência, sem acusar defeito", () => {
    const r = resumoDoPeriodo({ recebidas: 0, enviadas: 0, falhas: 0, naFila: 0 });
    expect(r.gravidade).toBe("ATENCAO");
    expect(r.detalhe).toContain("dia parado");
  });
});

describe("tipo sem tradução não aparece com cara de código", () => {
  it("vira um nome apresentável", () => {
    expect(lerEvento({ type: "algo.novo_aqui", status: "OK" }).titulo).toBe("Algo novo aqui");
  });
});
