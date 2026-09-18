import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  barrasEan13,
  digitoVerificadorEan13,
  ean13Interno,
  ean13Valido,
  lerCodigoBipado,
  modulosEan13,
  MODULOS_EAN13,
  TABELA_G,
  TABELA_L,
  TABELA_R,
} from "../etiquetas/ean13";
import { etiquetasLiberado } from "../etiquetas/gate";
import { MODULOS } from "../modulos";

// Guarda RN-059
/**
 * RN-059 — CÓDIGO DE BARRAS POR VARIAÇÃO, NASCE COM A PEÇA E NUNCA MUDA.
 *
 * O módulo Etiquetas (decisão do dono, 18/09/2026) começa por aqui: cada cor ×
 * tamanho tem um EAN-13 interno gerado pelo BANCO num gatilho (ADR-017), único
 * na plataforma; a conta do dígito verificador existe em SQL e em TypeScript
 * e as duas concordam (o script confere-codigo-de-barras.ts prova contra o
 * Postgres). Sem código não há o que bipar na separação.
 */
const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("EAN-13: a conta do dígito verificador", () => {
  it("bate com códigos conhecidos do mundo real", () => {
    expect(digitoVerificadorEan13("590123412345")).toBe(7); // 5901234123457
    expect(digitoVerificadorEan13("400638133393")).toBe(1); // 4006381333931
    expect(ean13Valido("5901234123457")).toBe(true);
    expect(ean13Valido("5901234123456")).toBe(false);
  });

  it("o código interno é o MESMO que o banco gera (prefixo 2 + 11 dígitos + verificador)", () => {
    // conferido contra `select ean13_interno(1), ean13_interno(2)` no Postgres
    expect(ean13Interno(1)).toBe("2000000000015");
    expect(ean13Interno(2)).toBe("2000000000022");
    expect(ean13Interno(0)).toBe("2000000000008");
    expect(ean13Interno(12345)).toBe("2000000123455");
    expect(ean13Interno(99_999_999_999)).toHaveLength(13);
    expect(() => ean13Interno(100_000_000_000)).toThrow();
  });

  it("o que o leitor mandou vira código limpo, e dígito errado é recusado sem ir ao servidor", () => {
    expect(lerCodigoBipado("2000000000015\n")).toBe("2000000000015");
    expect(lerCodigoBipado(" 2000-0000-0001-5 ")).toBe("2000000000015");
    expect(lerCodigoBipado("2000000000016")).toBeNull();
    expect(lerCodigoBipado("abc")).toBeNull();
    expect(lerCodigoBipado("")).toBeNull();
  });
});

describe("EAN-13: as tabelas de codificação são as do padrão GS1", () => {
  const inverter = (p: string) => p.replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
  const espelhar = (p: string) => p.split("").reverse().join("");

  it("R é o L invertido e G é o R espelhado (a primeira versão derivava G do L — achado da revisão)", () => {
    for (let d = 0; d < 10; d++) {
      expect(TABELA_R[d]).toBe(inverter(TABELA_L[d]));
      expect(TABELA_G[d]).toBe(espelhar(TABELA_R[d]));
      expect(TABELA_G[d]).not.toBe(espelhar(TABELA_L[d]));
    }
    // valores conhecidos da tabela
    expect(TABELA_L[0]).toBe("0001101");
    expect(TABELA_G[0]).toBe("0100111");
    expect(TABELA_R[0]).toBe("1110010");
  });

  it("um código inteiro conhecido, bit a bit (dígito 2 na frente → paridade LLGGLG)", () => {
    // 2000000000015: guarda, 0(L) 0(L) 0(G) 0(G) 0(L) 0(G), meio, 0(R)×4 1(R) 5(R), guarda
    const esperado =
      "101" +
      "0001101" + "0001101" + "0100111" + "0100111" + "0001101" + "0100111" +
      "01010" +
      "1110010" + "1110010" + "1110010" + "1110010" + "1100110" + "1001110" +
      "101";
    expect(modulosEan13("2000000000015").bits.join("")).toBe(esperado);
  });
});

describe("EAN-13: as barras", () => {
  it("são 95 módulos, começam e terminam com guarda 101 e têm a guarda do meio", () => {
    const { bits, guarda } = modulosEan13("5901234123457");
    expect(bits).toHaveLength(MODULOS_EAN13);
    expect(bits.slice(0, 3)).toEqual([1, 0, 1]);
    expect(bits.slice(-3)).toEqual([1, 0, 1]);
    expect(bits.slice(45, 50)).toEqual([0, 1, 0, 1, 0]);
    expect(guarda.filter(Boolean)).toHaveLength(3 + 5 + 3);
    // cada dígito tem 7 módulos com 2 barras: total de módulos pretos é par
    // e nunca zero — e o primeiro dígito decide a paridade dos seis da esquerda
    const outro = modulosEan13("4006381333931");
    expect(outro.bits).not.toEqual(bits);
  });

  it("viram retângulos em mm dentro da área pedida, com zona de silêncio", () => {
    const r = barrasEan13("2000000000015", 45, 10);
    expect(r.length).toBeGreaterThan(20);
    expect(r[0].x).toBeGreaterThan(0); // silêncio à esquerda
    const fim = r[r.length - 1];
    expect(fim.x + fim.w).toBeLessThan(45);
    // guarda desce mais que os dígitos
    expect(Math.max(...r.map((x) => x.h))).toBe(10);
    expect(Math.min(...r.map((x) => x.h))).toBeCloseTo(9.2, 5);
    expect(() => barrasEan13("123", 45, 10)).toThrow();
  });
});

describe("o código nasce no BANCO, para toda variação, e é único (ADR-017)", () => {
  const migracao = ler("prisma/migrations/20260918100000_etiquetas_codigo_de_barras/migration.sql");
  const schema = ler("prisma/schema.prisma");

  it("gatilho BEFORE INSERT + sequência + backfill + índice único", () => {
    expect(migracao).toContain('BEFORE INSERT ON "ProductVariant"');
    expect(migracao).toContain('CREATE SEQUENCE IF NOT EXISTS "ProductVariant_barcode_seq"');
    expect(migracao).toContain('WHERE "barcode" IS NULL');
    expect(migracao).toContain('CREATE UNIQUE INDEX "ProductVariant_barcode_key"');
    // a conta em SQL é a do EAN-13 (ímpar pesa 1, par pesa 3)
    expect(migracao).toContain("IF i % 2 = 1 THEN soma := soma + d; ELSE soma := soma + d * 3;");
    expect(schema).toMatch(/barcode\s+String\? @unique/);
  });

  it("nenhum caminho do código reescreve o código de barras", () => {
    // o gatilho é só de INSERT; e nenhuma rota manda `barcode` num update
    const rotas = [
      "src/app/api/products/route.ts",
      "src/app/api/products/[id]/route.ts",
      "src/lib/nuvemshop.ts",
      "src/lib/catalog-import.ts",
    ].map(ler);
    for (const r of rotas) expect(r).not.toMatch(/barcode:\s/);
  });
});

describe("a porteira do módulo", () => {
  it("toda a equipe entra; sem a chave da loja, nada", () => {
    expect(etiquetasLiberado(true)).toBe(true);
    expect(etiquetasLiberado(false)).toBe(false);
  });

  it("a rota de impressão passa pela porteira e recorta pela loja (RN-013)", () => {
    expect(ler("src/app/api/etiquetas/imprimir/route.ts")).toContain("porteiraEtiquetas()");
    expect(ler("src/lib/etiquetas/imprimir.ts")).toContain("product: { companyId }");
  });

  it("o módulo está no catálogo com preço de tabela 0 até o dono definir", () => {
    const m = MODULOS.find((x) => x.key === "ETIQUETAS")!;
    expect(m).toBeTruthy();
    expect(m.flag).toBe("etiquetasEnabled");
    expect(m.precoTabela).toBe(0);
  });
});
