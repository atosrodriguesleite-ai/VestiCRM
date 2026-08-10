import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SINCRONIA DA CENTRAL DE ATENDIMENTO (09/08/2026): "respondi pelo celular,
 * voltei para a tela e a cliente continuava como não respondida". O celular
 * reabre a página com a carga VELHA (cache de navegação); a âncora do sync
 * partia do relógio do aparelho e deixava o vão para trás.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("a inbox nunca perde o vão entre a carga e a reabertura", () => {
  it("a página manda o relógio do servidor (carregadoEm) para a tela", () => {
    const pg = ler("src/app/(app)/whatsapp/page.tsx");
    expect(pg).toContain("const carregadoEm = new Date().toISOString()");
    expect(pg).toContain("carregadoEm={carregadoEm}");
  });
  it("a âncora do primeiro sync parte do relógio da CARGA, não do aparelho", () => {
    const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(inbox).toContain("carregadoEm ? new Date(carregadoEm).getTime()");
  });
  it("sincroniza NA HORA ao montar e no pageshow do iPhone (bfcache)", () => {
    const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(inbox).toContain("void sync();\n    const timer = setInterval");
    expect(inbox).toContain('addEventListener("pageshow"');
  });
});
