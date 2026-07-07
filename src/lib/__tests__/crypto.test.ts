import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  maskSecret,
} from "../crypto";

describe("criptografia de credenciais (AES-256-GCM)", () => {
  it("cifra e decifra de volta ao valor original", () => {
    const token = "EAAGm0PX4ZCpsBO7xyz-token-da-meta-1234567890";
    const stored = encryptSecret(token);
    expect(stored).not.toContain(token);
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe(token);
  });

  it("cada cifragem gera um valor diferente (IV aleatório)", () => {
    const a = encryptSecret("mesmo-segredo");
    const b = encryptSecret("mesmo-segredo");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("valor adulterado não decifra (autenticação GCM)", () => {
    const stored = encryptSecret("segredo-importante");
    const tampered = stored.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("valores não cifrados passam direto (compatibilidade)", () => {
    expect(decryptSecret("texto-plano")).toBe("texto-plano");
    expect(isEncrypted("texto-plano")).toBe(false);
  });
});

describe("maskSecret (tokens nunca voltam ao navegador)", () => {
  it("mascara valores cifrados por completo", () => {
    const stored = encryptSecret("EAAGm0PX4ZCpsBO-token");
    const masked = maskSecret(stored)!;
    expect(masked).not.toContain("token");
    expect(masked).toMatch(/^•+/);
  });

  it("mostra apenas os 4 últimos caracteres de valores planos", () => {
    expect(maskSecret("1234567890abcd")).toBe("••••••••abcd");
  });

  it("null permanece null", () => {
    expect(maskSecret(null)).toBeNull();
  });
});
