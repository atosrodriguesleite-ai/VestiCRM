import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FOTO_VALIDADE_DIAS,
  fotoDoTelefone,
  indexarFotos,
  precisaAtualizar,
} from "../fotos";

/**
 * A Central de Atendimento com a cara do WhatsApp: cada conversa com a foto
 * da cliente. Duas regras cuidam para isso não virar problema:
 *
 *  • guardamos o LINK, nunca a imagem (foto no banco é a dívida nº 1 daqui);
 *  • o link vence, então cada cliente tem a data da última conferida.
 */

const dias = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("quando conferir a foto de novo", () => {
  it("cliente que nunca foi conferida entra na fila", () => {
    expect(precisaAtualizar({ photoSyncAt: null })).toBe(true);
  });

  it("conferida hoje não é perguntada de novo", () => {
    expect(precisaAtualizar({ photoSyncAt: new Date() })).toBe(false);
  });

  it("passou da validade, confere de novo (o link vence)", () => {
    expect(precisaAtualizar({ photoSyncAt: dias(FOTO_VALIDADE_DIAS + 1) })).toBe(true);
    expect(precisaAtualizar({ photoSyncAt: dias(FOTO_VALIDADE_DIAS - 1) })).toBe(false);
  });
});

describe("lendo a agenda que o servidor devolve", () => {
  it("entende os formatos conhecidos (o campo muda conforme a versão)", () => {
    const mapa = indexarFotos([
      { remoteJid: "5511998761001@s.whatsapp.net", profilePicUrl: "https://x/a.jpg" },
      { id: "5531997762002@s.whatsapp.net", profilePictureUrl: "https://x/b.jpg" },
      { remoteJid: "5541995554004@s.whatsapp.net", picture: "https://x/c.jpg" },
    ]);
    expect(mapa.get("5511998761001")).toBe("https://x/a.jpg");
    expect(mapa.get("5531997762002")).toBe("https://x/b.jpg");
    expect(mapa.get("5541995554004")).toBe("https://x/c.jpg");
  });

  it("aceita a resposta embrulhada em { contacts: [...] }", () => {
    const mapa = indexarFotos({
      contacts: [{ remoteJid: "5511999990000@s.whatsapp.net", profilePicUrl: "https://x/d.jpg" }],
    });
    expect(mapa.size).toBe(1);
  });

  it("ignora quem não tem foto e lixo no meio", () => {
    const mapa = indexarFotos([
      { remoteJid: "5511998761001@s.whatsapp.net" }, // sem foto
      { remoteJid: "5511998761002@s.whatsapp.net", profilePicUrl: "" },
      { remoteJid: "5511998761003@s.whatsapp.net", profilePicUrl: "não é link" },
      null,
      "isso não é contato",
    ]);
    expect(mapa.size).toBe(0);
  });

  it("resposta inesperada não quebra nada", () => {
    expect(indexarFotos(null).size).toBe(0);
    expect(indexarFotos({ erro: "deu ruim" }).size).toBe(0);
  });

  it("grupo não vira contato", () => {
    const mapa = indexarFotos([
      { remoteJid: "1234567890-1600000000@g.us", profilePicUrl: "https://x/g.jpg" },
    ]);
    // grupo não tem telefone de cliente; se entrar, entra pelo id cru — nunca
    // casa com o telefone de ninguém
    expect(mapa.get("5511998761001")).toBeUndefined();
  });
});

describe("casar a foto com a cliente", () => {
  const mapa = new Map([["5511998761001", "https://x/a.jpg"]]);

  it("acha pelo telefone exato", () => {
    expect(fotoDoTelefone(mapa, "5511998761001")).toBe("https://x/a.jpg");
  });

  it("tolera o 9º dígito (mesma régua da união de contatos)", () => {
    // o WhatsApp devolve com 9, o cadastro tem sem (ou o contrário)
    expect(fotoDoTelefone(mapa, "551198761001")).toBe("https://x/a.jpg");
  });

  it("quem não está na agenda fica sem foto (e sem chute)", () => {
    expect(fotoDoTelefone(mapa, "5562988880010")).toBeNull();
  });
});

describe("a imagem NUNCA entra no banco", () => {
  const fonte = readFileSync(join(process.cwd(), "src/lib/comm/fotos.ts"), "utf8");

  it("só o link é guardado", () => {
    expect(fonte).not.toMatch(/base64|data:image|getMediaBase64/i);
    expect(fonte).toContain("photoUrl");
  });

  it("a varredura tem freio e teto", () => {
    expect(fonte).toContain("FOTO_INTERVALO_MIN");
    expect(fonte).toContain("FOTO_LIMITE_POR_RODADA");
  });

  it("cliente sem foto também grava a data (não pergunta toda hora)", () => {
    expect(fonte).toContain("photoSyncAt: agora");
  });
});
