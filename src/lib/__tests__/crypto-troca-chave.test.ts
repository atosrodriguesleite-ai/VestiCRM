import { describe, expect, it, vi } from "vitest";
import { createCipheriv, createHash, randomBytes } from "crypto";

/**
 * Guarda a troca de chave do cofre: com uma CRED_SECRET NOVA definida, os
 * tokens gravados na época em que a chave era a AUTH_SECRET continuam
 * legíveis (senão todas as integrações de todas as lojas morreriam juntas
 * no momento em que a variável fosse criada na Vercel).
 */

vi.mock("../env", () => ({
  AUTH_SECRET: "chave-antiga-de-teste-0123456789",
  CRED_SECRET: "chave-nova-de-teste-9876543210ab",
}));

function criptografaCom(segredo: string, texto: string): string {
  const k = createHash("sha256").update(segredo).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:v1:" + Buffer.concat([iv, tag, data]).toString("base64");
}

describe("cofre com chave nova (CRED_SECRET) e chave antiga (AUTH_SECRET)", () => {
  it("token antigo (gravado com a AUTH_SECRET) continua legível", async () => {
    const { decryptSecret } = await import("../crypto");
    const antigo = criptografaCom("chave-antiga-de-teste-0123456789", "token-melhor-envio");
    expect(decryptSecret(antigo)).toBe("token-melhor-envio");
  });

  it("gravação nova usa a chave nova, e lê de volta normal", async () => {
    const { encryptSecret, decryptSecret } = await import("../crypto");
    const novo = encryptSecret("token-bling");
    expect(decryptSecret(novo)).toBe("token-bling");
    // e realmente NÃO abre com a chave antiga (é a nova que assina)
    const soAntiga = criptografaCom("chave-nova-de-teste-9876543210ab", "x");
    expect(decryptSecret(soAntiga)).toBe("x");
  });

  it("lixo continua explodindo (não mascara corrupção)", async () => {
    const { decryptSecret } = await import("../crypto");
    const corrompido = criptografaCom("chave-que-nunca-existiu-xxxxxxxx", "y");
    expect(() => decryptSecret(corrompido)).toThrow();
  });
});
