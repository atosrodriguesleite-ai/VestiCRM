import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A LOJA JÁ CONECTADA PASSA A ESCUTAR O EVENTO NOVO SOZINHA (17/09/2026).
 *
 * A lista de eventos fica gravada na instância no dia da conexão. Quando o
 * sistema passou a precisar do MESSAGES_EDITED, toda loja conectada seguia
 * na lista velha — e a única auto-cura rodava ao abrir a tela de conexão,
 * que a loja conectada não abre nunca mais. O carimbo
 * `evolutionWebhookEventos` é o que decide: diferente da lista atual →
 * reassina e carimba; igual → não vai ao servidor.
 */

const chamadasSet: string[] = [];
let respostaDoServidor: { ok: boolean; status: number } = { ok: true, status: 200 };
vi.mock("../evolution", () => ({
  evolutionEnv: () => ({ configured: true, url: "http://evo", key: "k" }),
  WEBHOOK_EVENTOS_ATUAIS: "A,B,MESSAGES_EDITED",
  evoSetWebhook: async (instance: string) => {
    chamadasSet.push(instance);
    if (respostaDoServidor.status === -1) throw new Error("rede");
    return { ...respostaDoServidor, data: respostaDoServidor.ok ? null : { message: "evento desconhecido" } };
  },
}));

const carimbos: { where: unknown; data: unknown }[] = [];
const recusas: { type: string; error: string }[] = [];
vi.mock("../../db", () => ({
  db: {
    commSettings: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        carimbos.push(args);
        return { count: 1 };
      },
    },
    commEvent: {
      create: async ({ data }: { data: { type: string; error: string } }) => {
        recusas.push(data);
        return data;
      },
    },
  },
}));

import {
  garantirEventosDoWebhook,
  precisaReassinar,
  motivoDaUltimaFalha,
  MS_FREIO_APOS_FALHA,
  _zerarFreioDeAssinatura,
} from "../garantir-webhook";

const loja = (eventos: string | null) => ({
  companyId: "loja-1",
  evolutionInstance: "ap_loja1",
  evolutionWebhookToken: "tok",
  evolutionWebhookEventos: eventos,
});

beforeEach(() => {
  chamadasSet.length = 0;
  carimbos.length = 0;
  recusas.length = 0;
  respostaDoServidor = { ok: true, status: 200 };
  _zerarFreioDeAssinatura();
});

describe("precisaReassinar", () => {
  it("carimbo em dia = não precisa; velho ou ausente = precisa", () => {
    expect(precisaReassinar(loja("A,B,MESSAGES_EDITED"))).toBe(false);
    expect(precisaReassinar(loja("A,B"))).toBe(true);
    expect(precisaReassinar(loja(null))).toBe(true);
  });
  it("sem instância ou sem token não há o que reassinar", () => {
    expect(precisaReassinar({ ...loja(null), evolutionInstance: null })).toBe(false);
    expect(precisaReassinar({ ...loja(null), evolutionWebhookToken: null })).toBe(false);
  });
});

describe("garantirEventosDoWebhook", () => {
  it("loja na lista velha é reassinada e CARIMBADA com a lista confirmada", async () => {
    expect(await garantirEventosDoWebhook(loja("A,B"))).toBe("reassinada");
    expect(chamadasSet).toEqual(["ap_loja1"]);
    expect(carimbos).toHaveLength(1);
    // só carimba se a instância ainda for a mesma (a loja pode ter desconectado)
    expect(carimbos[0].where).toEqual({ companyId: "loja-1", evolutionInstance: "ap_loja1" });
    expect(carimbos[0].data).toEqual({ evolutionWebhookEventos: "A,B,MESSAGES_EDITED" });
  });

  it("carimbo em dia NÃO vai ao servidor (uma vez por loja, de verdade)", async () => {
    expect(await garantirEventosDoWebhook(loja("A,B,MESSAGES_EDITED"))).toBe("em-dia");
    expect(chamadasSet).toEqual([]);
    expect(carimbos).toEqual([]);
  });

  it("`sempre` reassina mesmo em dia (tela de conexão / instância que já existia)", async () => {
    expect(await garantirEventosDoWebhook(loja("A,B,MESSAGES_EDITED"), { sempre: true })).toBe(
      "reassinada"
    );
    expect(chamadasSet).toEqual(["ap_loja1"]);
  });

  it("servidor recusou: NÃO carimba (a próxima batida tenta de novo) e a recusa FICA REGISTRADA", async () => {
    respostaDoServidor = { ok: false, status: 400 };
    expect(await garantirEventosDoWebhook(loja("A,B"))).toBe("falhou");
    expect(carimbos).toEqual([]);
    // recusa calada era o buraco: a Central de Comunicação diz o motivo
    expect(recusas).toHaveLength(1);
    expect(recusas[0].type).toBe("wa.webhook.assinatura-recusada");
    expect(recusas[0].error).toContain("respondeu 400");
    expect(recusas[0].error).toContain("evento desconhecido");
    expect(motivoDaUltimaFalha("ap_loja1")).toContain("respondeu 400");
    // em freio, não registra de novo (uma vez por rodada)
    expect(await garantirEventosDoWebhook(loja("A,B"))).toBe("em-freio");
    expect(recusas).toHaveLength(1);
  });

  it("rede caiu: não lança, não carimba", async () => {
    respostaDoServidor = { ok: false, status: -1 };
    expect(await garantirEventosDoWebhook(loja("A,B"))).toBe("falhou");
    expect(carimbos).toEqual([]);
  });

  it("depois de falhar, FREIA: não bate no servidor a cada mensagem que chega", async () => {
    respostaDoServidor = { ok: false, status: 500 };
    const t0 = 1_000_000;
    expect(await garantirEventosDoWebhook(loja("A,B"), { agora: t0 })).toBe("falhou");
    expect(await garantirEventosDoWebhook(loja("A,B"), { agora: t0 + 1000 })).toBe("em-freio");
    expect(chamadasSet).toHaveLength(1);
    // passado o freio, tenta de novo — e desta vez o servidor aceita
    respostaDoServidor = { ok: true, status: 200 };
    expect(
      await garantirEventosDoWebhook(loja("A,B"), { agora: t0 + MS_FREIO_APOS_FALHA + 1 })
    ).toBe("reassinada");
    expect(chamadasSet).toHaveLength(2);
  });

  it("sem instância não faz nada", async () => {
    expect(await garantirEventosDoWebhook({ ...loja(null), evolutionInstance: null })).toBe(
      "sem-instancia"
    );
    expect(chamadasSet).toEqual([]);
  });

  it("o vigia, a tela de conexão e o conectar chamam a garantia", () => {
    const raiz = process.cwd();
    expect(readFileSync(join(raiz, "src/lib/health.ts"), "utf8")).toContain(
      "await garantirEventosDoWebhook(s)"
    );
    expect(
      readFileSync(join(raiz, "src/app/api/whatsapp/evolution/route.ts"), "utf8")
    ).toContain("garantirEventosDoWebhook(settings, { sempre: true })");
    expect(
      readFileSync(join(raiz, "src/app/api/whatsapp/evolution/connect/route.ts"), "utf8")
    ).toContain("garantirEventosDoWebhook(settings, { sempre: true })");
  });
});
