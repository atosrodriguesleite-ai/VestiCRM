import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerContatos, nomeDeQuemMandou, nomeUtil } from "../nome-do-contato";

/**
 * NOME DA CLIENTE — incidente Toque Leve, 31/07/2026.
 *
 * Entrou uma conversa chamada "Lead 9621". A cliente tem nome no WhatsApp,
 * mas o sistema lia o nome em UM lugar só e, não achando, batizava o contato
 * com o telefone.
 */

const EVENTO = (extra: Record<string, unknown>) => ({
  key: { id: "A", remoteJid: "5582996649621@s.whatsapp.net", fromMe: false },
  message: { conversation: "Olá! Posso ter mais informações sobre isso?" },
  ...extra,
});

describe("de onde o nome pode vir", () => {
  it.each([
    ["pushName (o mais comum)", { pushName: "Sibelle" }],
    ["pushname minúsculo", { pushname: "Sibelle" }],
    ["notifyName", { notifyName: "Sibelle" }],
    ["conta de empresa (verifiedBizName)", { verifiedBizName: "Sibelle" }],
    ["profileName", { profileName: "Sibelle" }],
  ])("acha em %s", (_nome, campos) => {
    expect(nomeDeQuemMandou(EVENTO(campos))).toBe("Sibelle");
  });

  it("acha na RAIZ do aviso quando não veio na mensagem", () => {
    expect(nomeDeQuemMandou(EVENTO({}), { pushName: "Sibelle" })).toBe("Sibelle");
  });

  it("a mensagem vence a raiz (é o nome de quem mandou esta mensagem)", () => {
    expect(nomeDeQuemMandou(EVENTO({ pushName: "Sibelle" }), { pushName: "Outra" })).toBe(
      "Sibelle"
    );
  });
});

describe("o que NÃO pode virar nome de cliente", () => {
  it("mensagem enviada pela LOJA: o pushName é o nome da própria loja", () => {
    const daLoja = {
      key: { id: "A", remoteJid: "5582996649621@s.whatsapp.net", fromMe: true },
      pushName: "Toque Leve",
    };
    expect(nomeDeQuemMandou(daLoja)).toBe("");
  });

  it("número não é nome (trocaria um crachá por outro)", () => {
    for (const n of ["5582996649621", "+55 82 99664-9621", "(82) 9664-9621", "82 9664 9621"]) {
      expect(nomeUtil(n)).toBe("");
    }
  });

  it("vazio, letra solta e texto gigante ficam de fora", () => {
    expect(nomeUtil("")).toBe("");
    expect(nomeUtil("  ")).toBe("");
    expect(nomeUtil("A")).toBe("");
    expect(nomeUtil("x".repeat(200))).toBe("");
  });

  it("evento torto não quebra", () => {
    for (const nada of [null, undefined, {}, [], "texto", 42]) {
      expect(nomeDeQuemMandou(nada)).toBe("");
    }
  });

  it("nome com acento e sobrenome passa inteiro", () => {
    expect(nomeUtil(" Sibelle Araújo ")).toBe("Sibelle Araújo");
  });
});

describe("aviso de contato (é ele que traz o nome quando chega depois)", () => {
  it("lê uma lista de contatos", () => {
    expect(
      lerContatos([
        { id: "5582996649621@s.whatsapp.net", pushName: "Sibelle" },
        { id: "5577981014696@s.whatsapp.net", name: "Cassia" },
      ])
    ).toEqual([
      { jid: "5582996649621@s.whatsapp.net", nome: "Sibelle" },
      { jid: "5577981014696@s.whatsapp.net", nome: "Cassia" },
    ]);
  });

  it("lê um contato solto (algumas versões mandam objeto, não lista)", () => {
    expect(lerContatos({ id: "5582996649621@s.whatsapp.net", pushName: "Sibelle" })).toEqual([
      { jid: "5582996649621@s.whatsapp.net", nome: "Sibelle" },
    ]);
  });

  it("GRUPO e transmissão ficam de fora (não é cliente)", () => {
    expect(
      lerContatos([
        { id: "12345@g.us", pushName: "Atacado SP" },
        { id: "status@broadcast", pushName: "Status" },
      ])
    ).toEqual([]);
  });

  it("contato sem nome útil é ignorado (não vira crachá pior)", () => {
    expect(
      lerContatos([
        { id: "5582996649621@s.whatsapp.net" },
        { id: "5582996649621@s.whatsapp.net", pushName: "5582996649621" },
      ])
    ).toEqual([]);
  });

  it("lixo não quebra", () => {
    for (const nada of [null, undefined, {}, [], "texto", 42]) {
      expect(lerContatos(nada)).toEqual([]);
    }
  });
});

describe("o sistema realmente usa isso", () => {
  const hook = readFileSync(
    join(process.cwd(), "src/app/api/whatsapp/evolution/webhook/[token]/route.ts"),
    "utf8"
  );
  const evolution = readFileSync(join(process.cwd(), "src/lib/comm/evolution.ts"), "utf8");
  const intake = readFileSync(join(process.cwd(), "src/lib/intake.ts"), "utf8");

  it("a mensagem lê o nome em todos os campos, não só em pushName", () => {
    expect(hook).toContain("nomeDeQuemMandou(m, body.data)");
    expect(hook).not.toContain("name: m.pushName || undefined");
  });

  it("o aviso de contato é tratado (era jogado fora)", () => {
    expect(hook).toContain('event === "contacts.upsert"');
    expect(hook).toContain('event === "contacts.update"');
  });

  it("só troca CRACHÁ PROVISÓRIO — nome escrito por gente é sagrado", () => {
    expect(hook).toContain("nomeProvisorio(cliente.name)");
  });

  it("a loja passa a RECEBER esses avisos do servidor", () => {
    expect(evolution).toContain('"CONTACTS_UPSERT"');
    expect(evolution).toContain('"CONTACTS_UPDATE"');
  });

  it("sem nome nenhum, o crachá mostra o NÚMERO INTEIRO (não “Lead 9621”)", () => {
    expect(intake).toContain("`Contato ${formatPhone(phone)}`");
    expect(intake).not.toContain("`Lead ${phone.slice(-4)}`");
  });
});
