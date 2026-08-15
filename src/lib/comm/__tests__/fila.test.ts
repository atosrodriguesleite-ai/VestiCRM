import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  abaDaConversa,
  clienteEsperando,
  contadorAoMarcarNaoLida,
} from "../fila";

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

/**
 * MARCAR COMO NÃO LIDA — "volto nessa depois".
 *
 * A vendedora lê a mensagem mas não pode responder na hora. Sem esse gesto,
 * a conversa perde o marcador e some no meio das outras.
 */
describe("marcar conversa como não lida", () => {
  it("conversa já lida volta com o marcador", () => {
    expect(contadorAoMarcarNaoLida(0)).toBe(1);
  });

  it("NÃO apaga mensagens não lidas que já existiam", () => {
    // chegaram 3 sem resposta: continuam 3, não viram 1
    expect(contadorAoMarcarNaoLida(3)).toBe(3);
    expect(contadorAoMarcarNaoLida(1)).toBe(1);
  });

  it("valor estranho no banco não vira marcador inválido", () => {
    expect(contadorAoMarcarNaoLida(-2)).toBe(1);
    expect(contadorAoMarcarNaoLida(0.4)).toBe(1);
  });
});

describe("a porta de marcar não lida", () => {
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/conversations/[id]/route.ts"),
    "utf8"
  );
  const inbox = readFileSync(
    join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"),
    "utf8"
  );

  it("o servidor aceita marcar não lida, pela mesma régua", () => {
    expect(rota).toContain("markUnread");
    expect(rota).toContain("contadorAoMarcarNaoLida");
  });

  it("marcar não lida FECHA a conversa", () => {
    // enquanto aberta, o sync zera o marcador a cada 3s ("conversa aberta é
    // conversa lida"): sem fechar, o botão pareceria não funcionar
    const f = inbox.slice(
      inbox.indexOf("const marcarNaoLida"),
      inbox.indexOf("const reabrir")
    );
    expect(f).toContain("setSelectedId(null)");
    expect(f).toContain("markUnread");
  });

  it("o botão existe no cabeçalho do chat (celular e computador)", () => {
    // o cabeçalho é o mesmo nos dois tamanhos de tela — um só lugar para
    // aprender, sem gesto escondido
    expect(inbox).toContain('aria-label="Marcar como não lida"');
  });
});
