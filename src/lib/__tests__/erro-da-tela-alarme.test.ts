import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * O ALARME DO "🚨 ERRO EM PRODUÇÃO" (`logServerError`) — RN-066.
 *
 * O alarme é o canal ÚNICO das emergências do servidor e do WhatsApp, com um
 * intervalo de 15 min compartilhado: o relato de tela (vindo do aparelho,
 * digitável por quem estiver logado) NÃO toca — senão ganhava o intervalo e
 * calava o alarme de uma mensagem de cliente perdida. Quem não pede nada
 * segue como sempre (corpo = mensagem).
 */

const estado = vi.hoisted(() => ({
  gravados: 0,
  pushes: [] as Array<{ title: string; body: string }>,
}));

vi.mock("../db", () => ({
  db: {
    errorLog: {
      create: async () => {
        estado.gravados++;
      },
    },
    systemHealth: { updateMany: async () => ({ count: 1 }) },
    user: { findFirst: async () => ({ companyId: "plataforma" }) },
  },
}));
vi.mock("../push", () => ({
  sendToCompany: async (_c: string, p: { title: string; body: string }) => {
    estado.pushes.push(p);
  },
}));
vi.mock("../comm/evolution", () => ({ evolutionEnv: () => null, evoState: async () => null }));
vi.mock("../comm/garantir-webhook", () => ({ garantirEventosDoWebhook: async () => {} }));

const { logServerError } = await import("../health");

beforeEach(() => {
  estado.gravados = 0;
  estado.pushes = [];
});

describe("o alarme do erro em produção", () => {
  it("relato de tela (alarme: false): grava no painel, NÃO toca — nem o texto do aparelho", async () => {
    await logServerError({
      source: "client",
      message: "[tela] Pagamento pendente, acesse http://golpe",
      alarme: false,
    });
    expect(estado.gravados).toBe(1);
    expect(estado.pushes).toHaveLength(0);
  });

  it("quem não pede nada segue como sempre: o corpo é a mensagem", async () => {
    await logServerError({ source: "server", message: "Falha no banco" });
    expect(estado.pushes[0].body).toBe("Falha no banco");
  });
});
