import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  metaPixelValido,
  gaIdValido,
  metaPixelSeguro,
  gaIdSeguro,
} from "../pixel-id";

/**
 * LOTE 0 — HOTFIX DE SEGURANÇA (auditoria 07/08/2026).
 *  1. XSS na bio via metaPixelId/gaId (interpolados crus no <Script> público).
 *  2. Rotas de intake fail-open sem INTAKE_SECRET.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("IDs de pixel/analytics: o payload de ataque é barrado", () => {
  const ATAQUE = "x');alert(document.domain);('";

  it("o ataque do relatório é recusado na validação e vira null na exibição", () => {
    expect(metaPixelValido(ATAQUE)).toBe(false);
    expect(gaIdValido(ATAQUE)).toBe(false);
    expect(metaPixelSeguro(ATAQUE)).toBe(null);
    expect(gaIdSeguro(ATAQUE)).toBe(null);
  });

  it("nenhum caractere que quebra a string do script passa", () => {
    for (const lixo of ["1234'", "12;34", "12)34", "12<34", "12 34", "abc"]) {
      expect(metaPixelSeguro(lixo)).toBe(null);
    }
  });

  it("ids de verdade continuam funcionando", () => {
    expect(metaPixelValido("123456789012345")).toBe(true);
    expect(metaPixelSeguro("123456789012345")).toBe("123456789012345");
    expect(gaIdValido("G-ABC1234XYZ")).toBe(true);
    expect(gaIdValido("UA-12345678-1")).toBe(true);
    expect(gaIdValido("AW-1234567890")).toBe(true);
    expect(gaIdSeguro("G-ABC1234XYZ")).toBe("G-ABC1234XYZ");
  });

  it("vazio/nulo é válido (campo opcional, desligar o pixel)", () => {
    expect(metaPixelValido("")).toBe(true);
    expect(metaPixelValido(null)).toBe(true);
    expect(gaIdValido(undefined)).toBe(true);
    // mas não renderiza script para vazio
    expect(metaPixelSeguro("")).toBe(null);
  });
});

describe("a bio pública higieniza antes de interpolar", () => {
  const page = ler("src/app/bio/[slug]/page.tsx");
  it("os dois <Script> usam a versão SEGURA, nunca o campo cru", () => {
    expect(page).toContain("metaPixelSeguro(page.metaPixelId)");
    expect(page).toContain("gaIdSeguro(page.gaId)");
    expect(page).not.toContain("fbq('init','${page.metaPixelId}')");
    expect(page).not.toContain("gtag('config','${page.gaId}')");
  });
  it("a API valida na gravação", () => {
    const api = ler("src/app/api/marketing/bio/route.ts");
    expect(api).toContain("metaPixelValido");
    expect(api).toContain("gaIdValido");
  });
});

describe("rotas de intake: fail-closed sem INTAKE_SECRET", () => {
  it("intake genérico nega (503) quando a env não está setada", () => {
    const rota = ler("src/app/api/intake/[channel]/route.ts");
    expect(rota).toContain("if (!secret)");
    expect(rota).toContain("status: 503");
    // o jeito antigo fail-open (só nega se secret existe) não pode voltar
    expect(rota).not.toContain("if (secret && req.headers.get");
  });
  it("formato simulado do webhook também fecha sem a env", () => {
    const rota = ler("src/app/api/whatsapp/webhook/route.ts");
    expect(rota).toContain("if (!secret)");
    expect(rota).not.toContain("if (secret && req.headers.get");
  });
});
