import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abreNoVisor, ehPdf, medidasDaPagina, pareceUmPdf, TETO_DE_PONTOS, ZOOMS } from "../documento-no-chat";

/**
 * PDF NA CONVERSA ABRE NO VISOR PRÓPRIO, COM X — relato do dono (21/09/2026):
 * "abro o PDF dentro da conversa, não consigo fechar, tenho que fechar o
 * aplicativo". No app instalado (PWA, scope "/") `target="_blank"` não abre
 * aba: o PDF toma a tela sem volta.
 */
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("o que é PDF", () => {
  it("pela extensão, sem diferenciar maiúscula", () => {
    expect(ehPdf("romaneio-0122.pdf")).toBe(true);
    expect(ehPdf("ORCAMENTO.PDF")).toBe(true);
    expect(ehPdf(" nota.pdf ")).toBe(true);
    expect(ehPdf("planilha.xlsx")).toBe(false);
    expect(ehPdf("pdf-antigo.docx")).toBe(false);
    expect(ehPdf(null)).toBe(false);
    expect(ehPdf(undefined)).toBe(false);
  });
});

describe("o que vale tentar abrir no visor", () => {
  it("o PDF pelo nome e o documento sem extensão nenhuma", () => {
    expect(abreNoVisor("romaneio-0122.pdf")).toBe(true);
    expect(abreNoVisor("Catálogo de inverno")).toBe(true);
    expect(abreNoVisor("documento")).toBe(true);
    expect(abreNoVisor(null)).toBe(true);
    expect(abreNoVisor("")).toBe(true);
  });
  it("arquivo com OUTRA extensão vai direto para salvar", () => {
    expect(abreNoVisor("planilha.xlsx")).toBe(false);
    expect(abreNoVisor("contrato.docx")).toBe(false);
    expect(abreNoVisor("fotos.zip")).toBe(false);
    expect(abreNoVisor("pdf-antigo.docx")).toBe(false);
  });
});

describe("é PDF pelo conteúdo, não pelo nome", () => {
  const bytes = (t: string) => new TextEncoder().encode(t);
  it("a marca %PDF- no começo", () => {
    expect(pareceUmPdf(bytes("%PDF-1.7\n%âãÏÓ"))).toBe(true);
  });
  it("lixo antes da marca, dentro dos primeiros 1024 bytes", () => {
    expect(pareceUmPdf(bytes("\n\n  %PDF-1.4"))).toBe(true);
    expect(pareceUmPdf(bytes("x".repeat(1019) + "%PDF-"))).toBe(true);
    expect(pareceUmPdf(bytes("x".repeat(1020) + "%PDF-"))).toBe(false);
  });
  it("página HTML, planilha e arquivo vazio não são PDF", () => {
    expect(pareceUmPdf(bytes("<!doctype html><script>alert(1)</script>"))).toBe(false);
    expect(pareceUmPdf(bytes("PK\u0003\u0004"))).toBe(false);
    expect(pareceUmPdf(new Uint8Array(0))).toBe(false);
    expect(pareceUmPdf(bytes("%PDF"))).toBe(false);
  });
});

describe("as medidas da página no visor", () => {
  const a4 = { larguraPdf: 595, alturaPdf: 842 };
  it("no celular a página ocupa a largura da tela e é desenhada nos pontos reais", () => {
    const m = medidasDaPagina({ ...a4, larguraDisponivel: 374, zoom: 1, dpr: 3 });
    expect(m.larguraCss).toBe(374);
    expect(m.alturaCss).toBe(Math.round((374 * 842) / 595));
    // nitidez no máximo 2× (3× triplicaria a memória sem ganho visível)
    expect(m.escala).toBeCloseTo((374 / 595) * 2, 5);
  });
  it("no computador a página não passa da largura máxima em zoom 1", () => {
    expect(medidasDaPagina({ ...a4, larguraDisponivel: 1800, zoom: 1, dpr: 1 }).larguraCss).toBe(900);
  });
  it("o zoom multiplica o tamanho na tela", () => {
    const m = medidasDaPagina({ ...a4, larguraDisponivel: 374, zoom: 2, dpr: 2 });
    expect(m.larguraCss).toBe(748);
  });
  it("nenhum degrau do zoom passa do teto de memória, em nenhuma tela", () => {
    for (const larguraDisponivel of [320, 374, 768, 1280, 2400]) {
      for (const dpr of [1, 2, 3]) {
        for (const zoom of ZOOMS) {
          const m = medidasDaPagina({ ...a4, larguraDisponivel, zoom, dpr });
          const pontos = 595 * m.escala * 842 * m.escala;
          expect(pontos).toBeLessThanOrEqual(TETO_DE_PONTOS * 1.01);
          expect(m.escala).toBeGreaterThan(0);
        }
      }
    }
  });
  it("página torta (medida zero) não vira divisão por zero", () => {
    const m = medidasDaPagina({ larguraPdf: 0, alturaPdf: 0, larguraDisponivel: 374, zoom: 1, dpr: 2 });
    expect(Number.isFinite(m.escala)).toBe(true);
    expect(m.larguraCss).toBeGreaterThan(0);
  });
});

describe("a bolha do documento nunca navega para fora do app", () => {
  const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
  const trecho = inbox.slice(inbox.indexOf('if (m.mediaType === "DOCUMENT")'), inbox.indexOf("function VisorDeFoto"));

  it("PDF abre no visor (botão), não em link com target=_blank", () => {
    expect(trecho).toContain("abreNoVisor(m.fileName) && aoAbrirDocumento");
    expect(trecho).toContain("aoAbrirDocumento(src, m.fileName");
    expect(trecho).not.toContain('target="_blank"');
  });

  it("outro documento vai como arquivo para salvar (?baixar=1)", () => {
    expect(trecho).toContain("linkParaSalvar(m.mediaUrl)");
  });

  it("o visor é ligado na tela e sai pelo Portal", () => {
    expect(inbox).toContain("aoAbrirDocumento={(src, nome) => setDocumentoAberto({ src, nome })}");
    expect(inbox).toContain("<VisorDeDocumento");
  });
});

describe("o visor de documento", () => {
  const visor = ler("src/components/visor-de-documento.tsx");
  it("tem o X, fecha no Esc e trava a página de trás", () => {
    expect(visor).toContain('aria-label="Fechar"');
    expect(visor).toContain('e.key === "Escape"');
    expect(visor).toContain("useTravarFundo(true)");
  });
  it("desenha as páginas ele mesmo — nunca numa moldura do navegador", () => {
    // a moldura (`<iframe>`) só mostrava o PDF no computador: no iPhone saía
    // só a primeira página e no Android, nada (15/11/2026)
    expect(visor).not.toContain("<iframe");
    expect(visor).toContain('import("pdfjs-dist/legacy/build/pdf.mjs")');
    expect(visor).toContain("pareceUmPdf(");
  });
  it("oferece salvar como arquivo com o nome", () => {
    expect(visor).toContain("linkParaSalvar(src)");
    expect(visor).toContain("download={nome}");
  });
});
