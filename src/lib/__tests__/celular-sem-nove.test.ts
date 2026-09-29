import { describe, it, expect } from "vitest";
import { celularSemONove } from "../format";
import { fraseNumeroSemWhatsapp, respostaDizSemWhatsapp } from "../comm/numero-sem-whatsapp";
import { lerEvento } from "../comm/eventos";

/**
 * CELULAR SEM O 9 E NÚMERO SEM WHATSAPP (relato do dono, 29/09/2026): pedido
 * do catálogo com "(35) 9971-3320"; a Central tentou responder duas vezes e
 * a bolha mostrava o JSON cru do servidor com `"exists":false`.
 */

describe("celular sem o 9", () => {
  it("oito números começando com 6–9 depois do DDD é celular sem o 9", () => {
    expect(celularSemONove("(35) 9971-3320")).toBe("35999713320");
    expect(celularSemONove("553599713320")).toBe("35999713320");
    expect(celularSemONove("11 8123-4567")).toBe("11981234567");
    expect(celularSemONove("2176543210")).toBe("21976543210");
  });

  it("celular completo, fixo e número torto ficam como estão", () => {
    expect(celularSemONove("(35) 99971-3320")).toBeNull(); // já tem o 9
    expect(celularSemONove("(35) 3221-4567")).toBeNull(); // fixo começa com 2–5
    expect(celularSemONove("(11) 2345-6789")).toBeNull();
    expect(celularSemONove("5535999713320")).toBeNull();
    expect(celularSemONove("99713320")).toBeNull(); // sem DDD
    expect(celularSemONove("")).toBeNull();
    expect(celularSemONove(null)).toBeNull();
  });
});

describe("o WhatsApp disse que o número não existe", () => {
  const recusa = {
    status: 400,
    error: "Bad Request",
    response: { message: [{ jid: "553599713320@s.whatsapp.net", exists: false, number: "553599713320" }] },
  };

  it("reconhece a recusa do servidor de conexão", () => {
    expect(respostaDizSemWhatsapp(recusa)).toBe(true);
    expect(respostaDizSemWhatsapp({ response: { message: [{ exists: true }] } })).toBe(false);
    expect(respostaDizSemWhatsapp({ response: { message: "Bad Request" } })).toBe(false);
    expect(respostaDizSemWhatsapp(null)).toBe(false);
    expect(respostaDizSemWhatsapp("x")).toBe(false);
  });

  it("vira frase em português, com a sugestão do 9 quando cabe", () => {
    const f = fraseNumeroSemWhatsapp("553599713320");
    expect(f).toContain("Este número não tem WhatsApp: (35) 9971-3320");
    expect(f).toContain("Não adianta reenviar");
    expect(f).toContain("(35) 99971-3320");
    expect(f).not.toContain("{");
  });

  it("número completo não ganha sugestão de 9", () => {
    const f = fraseNumeroSemWhatsapp("5535999713320");
    expect(f).toContain("(35) 99971-3320");
    expect(f).not.toContain("faltado o 9");
  });

  it("a Central de Comunicação explica a causa certa, não 'formato do arquivo'", () => {
    const e = lerEvento({ type: "message.sent", status: "ERRO", error: fraseNumeroSemWhatsapp("553599713320") });
    expect(JSON.stringify(e)).toContain("não tem conta");
  });
});
