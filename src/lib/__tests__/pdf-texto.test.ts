import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { textoPdf, paginaSegura } from "../pdf-texto";

/**
 * ROMANEIO EM PDF — incidente Entre Linhas, pedido #0137 (30/07/2026).
 *
 * Abrir o romaneio devolvia ERRO 500 e a loja ficava sem o papel da separação.
 * As fontes padrão do PDF só escrevem a tabela WinAnsi (alfabeto ocidental) e
 * ESTOURAM no que não conhecem — um 💜 no nome da cliente, no nome da peça ou
 * na observação derrubava o romaneio inteiro. Justamente onde mais tem emoji:
 * pedido que veio do WhatsApp.
 */

const COM_EMOJI = "LOJA DA GABI 💜 — pedido ✨ confirmado 🖤";

describe("o que a fonte do PDF sabe escrever", () => {
  it("acento do português passa (não pode sumir da nota)", () => {
    expect(textoPdf("Coração · Café · Búzios · Ação")).toBe(
      "Coração · Café · Búzios · Ação"
    );
  });

  it("emoji sai fora, o resto do texto continua", () => {
    expect(textoPdf(COM_EMOJI)).toBe("LOJA DA GABI — pedido confirmado");
  });

  it("pontuação que o WhatsApp usa continua (travessão, aspas, reticências)", () => {
    expect(textoPdf("“Vestido” — 3 peças… • R$ 90")).toBe(
      "“Vestido” — 3 peças… • R$ 90"
    );
  });

  it("quebra de linha vira espaço (o PDF escreve numa linha só)", () => {
    expect(textoPdf("Rua das Flores\n120\tCentro")).toBe("Rua das Flores 120 Centro");
  });

  it("texto vazio ou nulo não quebra", () => {
    expect(textoPdf(null)).toBe("");
    expect(textoPdf(undefined)).toBe("");
    expect(textoPdf("   ")).toBe("");
  });

  it("emoji sozinho vira vazio (não deixa espaço solto)", () => {
    expect(textoPdf("💜")).toBe("");
    expect(textoPdf("Ana 💜 Maria")).toBe("Ana Maria");
  });
});

describe("o PDF de verdade (prova do erro e da correção)", () => {
  it("SEM proteção, o emoji derruba a geração — era o erro 500", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    expect(() => page.drawText(COM_EMOJI, { x: 40, y: 800, size: 11, font })).toThrow();
  });

  it("COM proteção, o PDF sai normalmente", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = paginaSegura(pdf.addPage([595, 842]));
    expect(() => page.drawText(COM_EMOJI, { x: 40, y: 800, size: 11, font })).not.toThrow();
    const bytes = await pdf.save();
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("a proteção vale para TUDO que for escrito na página", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = paginaSegura(pdf.addPage([595, 842]));
    for (const t of ["Cliente 💖", "Peça 🧵 P", "Obs: chegou ✅", "Total 💰 R$ 90"]) {
      expect(() => page.drawText(t, { x: 40, y: 700, size: 10, font })).not.toThrow();
    }
  });
});

describe("todos os PDFs do sistema estão blindados", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const PDFS = [
    "src/app/api/orders/[id]/pdf/route.ts", // romaneio
    "src/app/api/orders/[id]/resale-pdf/route.ts", // catálogo de revenda
    "src/app/api/comissoes/relatorio/route.ts", // relatório de comissões
  ];

  it.each(PDFS)("%s cria página blindada", (arquivo) => {
    const fonte = ler(arquivo);
    expect(fonte).toContain("paginaSegura(pdf.addPage(");
    // nenhuma página crua sobrou (bastava UMA para o PDF cair de novo)
    expect(fonte).not.toMatch(/(?<!paginaSegura\()pdf\.addPage\(A4\)/);
  });
});
