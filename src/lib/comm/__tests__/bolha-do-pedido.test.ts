import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  escolherBolha,
  mesmoTexto,
  JANELA_DA_BOLHA_MS,
  type BolhaCandidata,
} from "../bolha-do-pedido";

// Guarda RN-043 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * UMA BOLHA SÓ PARA O PEDIDO DO CATÁLOGO.
 *
 * Relato do dono (01/09/2026): pedido de teste pelo catálogo — no WhatsApp do
 * celular, UMA mensagem; na Central do sistema, DUAS, idênticas. Dois caminhos
 * gravavam a mesma coisa: o catálogo (na hora do pedido) e o webhook (quando
 * a cliente aperta enviar no wa.me). "Esses erros já não era mais para
 * acontecer."
 *
 * A DECISÃO é pura e é ela que estes testes executam de verdade; o intake só
 * busca as candidatas e trava por cliente.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const PEDIDO =
  "*Novo pedido — Jago Fitwear*\n\n*Blusa Clássica Tule*\n• Blusa Tule Preto — Único ×1  (1 peça · R$ 75,00)\n\n*Total:* 1 peças · R$ 75,00";

describe("mesmo texto", () => {
  it("o texto do catálogo e o que o WhatsApp devolve são o mesmo", () => {
    expect(mesmoTexto(PEDIDO, PEDIDO)).toBe(true);
  });

  /** O caminho muda espaço e quebra de linha; não muda conteúdo. */
  it("tolera espaço no fim, quebra dobrada e acento composto de outro jeito", () => {
    expect(mesmoTexto(PEDIDO, PEDIDO + "  \n")).toBe(true);
    expect(mesmoTexto(PEDIDO.replace("\n\n", "\n\n\n"), PEDIDO)).toBe(true);
    expect(mesmoTexto("Blusa Clássica", "Blusa Clássica")).toBe(true);
    expect(mesmoTexto("a\r\nb", "a\nb")).toBe(true);
  });

  /** Uma peça a mais é OUTRO pedido — nunca pode casar. */
  it("não tolera diferença de conteúdo", () => {
    expect(mesmoTexto(PEDIDO, PEDIDO.replace("×1", "×2"))).toBe(false);
    expect(mesmoTexto(PEDIDO, PEDIDO.replace("75,00", "57,00"))).toBe(false);
  });

  it("texto vazio nunca casa com nada", () => {
    expect(mesmoTexto("", "")).toBe(false);
    expect(mesmoTexto("   ", "   ")).toBe(false);
  });
});

describe("qual bolha reaproveitar", () => {
  const doCatalogo: BolhaCandidata = { id: "cat", body: PEDIDO, externalId: null, conversationId: "x" };
  const doWhatsApp: BolhaCandidata = { id: "wa", body: PEDIDO, externalId: "WA-1", conversationId: "x" };
  const outra: BolhaCandidata = { id: "oi", body: "oi, tudo bem?", externalId: null, conversationId: "x" };

  /** O caso do relato: o webhook chega e a bolha do catálogo já está lá. */
  it("webhook reaproveita a bolha do catálogo (a que ainda não tem id)", () => {
    expect(escolherBolha([outra, doCatalogo], PEDIDO, "do-catalogo")?.id).toBe("cat");
  });

  /**
   * A cliente mandar o MESMO texto duas vezes de propósito tem que aparecer
   * duas vezes — é o que ela vê no celular. Bolha que já tem id do WhatsApp
   * veio do próprio WhatsApp: o webhook nunca a reaproveita.
   */
  it("webhook NÃO reaproveita bolha que já tem id do WhatsApp", () => {
    expect(escolherBolha([doWhatsApp], PEDIDO, "do-catalogo")).toBeNull();
  });

  /** O outro lado da corrida: o webhook venceu, o catálogo reaproveita a COM id. */
  it("catálogo reaproveita a mensagem que o WhatsApp já trouxe", () => {
    expect(escolherBolha([doWhatsApp], PEDIDO, "do-whatsapp")?.id).toBe("wa");
  });

  /**
   * Bolha SEM id é de OUTRO pedido do catálogo (a cliente pediu o mesmo de
   * novo sem apertar enviar): o catálogo nunca a reaproveita — senão o
   * segundo pedido não aparecia no chat.
   */
  it("catálogo NÃO reaproveita a bolha de outro pedido do catálogo", () => {
    expect(escolherBolha([doCatalogo], PEDIDO, "do-whatsapp")).toBeNull();
  });

  it("texto diferente não é a bolha do pedido, em lado nenhum", () => {
    expect(escolherBolha([outra], PEDIDO, "do-catalogo")).toBeNull();
    expect(escolherBolha([outra], PEDIDO, "do-whatsapp")).toBeNull();
  });

  /** As candidatas vêm da mais recente para a mais antiga: a primeira que casa vence. */
  it("entre duas bolhas que servem, fica com a mais recente", () => {
    const velha: BolhaCandidata = { id: "velha", body: PEDIDO, externalId: null, conversationId: "x" };
    const nova: BolhaCandidata = { id: "nova", body: PEDIDO, externalId: null, conversationId: "x" };
    expect(escolherBolha([nova, velha], PEDIDO, "do-catalogo")?.id).toBe("nova");
  });

  it("sem candidatas, ou texto vazio, cria mensagem nova", () => {
    expect(escolherBolha([], PEDIDO, "do-catalogo")).toBeNull();
    expect(escolherBolha([doCatalogo], "   ", "do-catalogo")).toBeNull();
  });

  /**
   * A janela é curta e é a ÚNICA, para os dois lados: a janela de dias (para
   * o reenvio da fila do aparelho) foi construída e retirada — a cliente que
   * repetisse o mesmo pedido na quinta reaproveitava a bolha de segunda e,
   * sem apertar enviar, o segundo pedido não aparecia nunca.
   */
  it("a janela é curta, não é para sempre", () => {
    expect(JANELA_DA_BOLHA_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(JANELA_DA_BOLHA_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe("a regra mora na porta única, com trava", () => {
  /**
   * O que dá para afirmar sem banco é pouco, e é de propósito: a corrida de
   * verdade (catálogo e webhook em `Promise.all` → uma bolha só, nos dois
   * vencedores) foi reproduzida contra o Postgres local na entrega e na
   * revisão — é ESSE o teste que vale. Aqui fica só o contrato de quem chama:
   */
  it("o intake trava por cliente antes de decidir se cria ou reaproveita", () => {
    const intake = ler("src/lib/intake.ts");
    const de = intake.indexOf("reaproveitarBolha");
    expect(de).toBeGreaterThan(-1);
    expect(intake.slice(de)).toContain("pg_advisory_xact_lock");
  });

  /**
   * A mensagem do WhatsApp só é DESTE pedido se chegou depois do último pedido
   * da cliente: repetir o mesmo pedido minutos depois, sem apertar enviar,
   * reaproveitava a mensagem do pedido anterior e o segundo não aparecia.
   */
  it("o catálogo só reaproveita mensagem posterior ao último pedido da cliente", () => {
    const intake = ler("src/lib/intake.ts");
    const de = intake.indexOf('alvo === "do-whatsapp"');
    expect(de).toBeGreaterThan(-1);
    const bloco = intake.slice(de, intake.indexOf("tx.message.findMany", de));
    expect(bloco).toContain("tx.order.findFirst");
    expect(intake.slice(de)).toContain("gt: ultimoPedido.createdAt");
  });

  /** Cada lado pede a bolha do OUTRO; o webhook só para texto. */
  it("webhook pede a do catálogo (só texto); catálogo pede a do WhatsApp", () => {
    const engine = ler("src/lib/comm/engine.ts");
    expect(engine).toContain('reaproveitarBolha: "do-catalogo"');
    expect(engine).toContain('input.mediaType === "TEXT"');
    expect(ler("src/app/api/catalog/order/route.ts")).toContain('reaproveitarBolha: "do-whatsapp"');
  });
});
