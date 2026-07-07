import { describe, it, expect } from "vitest";
import { buildPixPayload, crc16 } from "../pix";

describe("crc16", () => {
  it("calcula o CRC-CCITT padrão do BR Code", () => {
    // vetor conhecido: "123456789" → 0x29B1
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("buildPixPayload", () => {
  const input = {
    pixKey: "pix@bellamoda.com.br",
    merchantName: "Bella Moda",
    merchantCity: "São Paulo",
    amount: 249.9,
    txid: "PED0042",
  };

  it("começa com o payload format indicator EMV", () => {
    expect(buildPixPayload(input).startsWith("000201")).toBe(true);
  });

  it("contém o GUI do PIX, a chave, o valor e o txid", () => {
    const payload = buildPixPayload(input);
    expect(payload).toContain("br.gov.bcb.pix");
    expect(payload).toContain("pix@bellamoda.com.br");
    expect(payload).toContain("249.90");
    expect(payload).toContain("PED0042");
  });

  it("remove acentos do nome e da cidade (exigência EMV)", () => {
    const payload = buildPixPayload({
      ...input,
      merchantName: "Coleção Verão",
      merchantCity: "Brasília",
    });
    expect(payload).toContain("Colecao Verao");
    expect(payload).toContain("Brasilia");
  });

  it("termina com CRC válido de 4 dígitos hex", () => {
    const payload = buildPixPayload(input);
    const body = payload.slice(0, -4);
    expect(payload.slice(-4)).toBe(crc16(body));
  });
});
