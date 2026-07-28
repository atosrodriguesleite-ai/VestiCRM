import { describe, it, expect } from "vitest";
import { abaDaConversa, clienteEsperando } from "../fila";

/**
 * FILA É CLIENTE ESPERANDO. A regra antiga ("sem responsável = fila") jogava
 * na fila a conversa que a PRÓPRIA LOJA começou — como se a cliente estivesse
 * esperando atendimento que ninguém pediu.
 */

const agora = new Date("2026-07-28T12:00:00Z");
const antes = new Date("2026-07-28T11:00:00Z");

describe("cliente esperando resposta", () => {
  it("escreveu e ninguém respondeu depois → está esperando", () => {
    expect(clienteEsperando({ status: "OPEN", lastInboundAt: agora, lastOutboundAt: antes })).toBe(true);
  });

  it("escreveu e foi respondida → não está esperando", () => {
    expect(clienteEsperando({ status: "OPEN", lastInboundAt: antes, lastOutboundAt: agora })).toBe(false);
  });

  it("nunca escreveu (a loja é que puxou assunto) → ninguém espera", () => {
    expect(clienteEsperando({ status: "OPEN", lastInboundAt: null, lastOutboundAt: agora })).toBe(false);
  });

  it("data inválida não inventa espera", () => {
    expect(clienteEsperando({ status: "OPEN", lastInboundAt: "não é data" })).toBe(false);
  });
});

describe("em que aba a conversa aparece", () => {
  it("cliente chamou e ninguém assumiu → FILA", () => {
    expect(
      abaDaConversa({ status: "OPEN", assignee: null, lastInboundAt: agora, lastOutboundAt: null })
    ).toBe("fila");
  });

  it("a LOJA começou a conversa → CHATS, nunca fila", () => {
    // era exatamente a queixa: "mandei mensagem para a cliente e a conversa
    // foi parar na fila"
    expect(
      abaDaConversa({ status: "OPEN", assignee: null, lastInboundAt: null, lastOutboundAt: agora })
    ).toBe("chats");
  });

  it("cliente chamou, alguém respondeu pelo celular → CHATS", () => {
    expect(
      abaDaConversa({ status: "OPEN", assignee: null, lastInboundAt: antes, lastOutboundAt: agora })
    ).toBe("chats");
  });

  it("respondeu e a cliente escreveu de novo → volta para a FILA", () => {
    expect(
      abaDaConversa({ status: "OPEN", assignee: null, lastInboundAt: agora, lastOutboundAt: antes })
    ).toBe("fila");
  });

  it("com responsável é atendimento em curso, mesmo com a cliente esperando", () => {
    expect(
      abaDaConversa({
        status: "OPEN",
        assignee: { id: "u1" },
        lastInboundAt: agora,
        lastOutboundAt: antes,
      })
    ).toBe("chats");
  });

  it("encerrada é histórico", () => {
    expect(
      abaDaConversa({ status: "CLOSED", assignee: null, lastInboundAt: agora, lastOutboundAt: null })
    ).toBe("contatos");
  });
});

describe("responder é assumir (regra no servidor, não só na tela)", () => {
  it("o motor de envio assume a conversa e reabre a encerrada", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const engine = readFileSync(join(process.cwd(), "src/lib/comm/engine.ts"), "utf8");
    // sem isto, responder deixava o atendimento parecendo fila/histórico
    expect(engine).toMatch(/conv\.status === "CLOSED" \? \{ status: "OPEN"/);
    expect(engine).toMatch(/!conv\.assigneeId && input\.authorId \? \{ assigneeId: input\.authorId \}/);
  });

  it("nota interna NÃO assume o atendimento (anotar não é atender)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const engine = readFileSync(join(process.cwd(), "src/lib/comm/engine.ts"), "utf8");
    const trecho = /\.\.\.\(isNote[\s\S]*?\n    \},\n  \}\);/.exec(engine)?.[0] ?? "";
    expect(trecho).toContain("assigneeId");
    expect(trecho).toMatch(/isNote\s*\n?\s*\?\s*\{\}/);
  });
});
