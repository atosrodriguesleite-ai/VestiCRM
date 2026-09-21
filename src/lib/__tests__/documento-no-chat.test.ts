import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ehPdf } from "../documento-no-chat";

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

describe("a bolha do documento nunca navega para fora do app", () => {
  const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
  const trecho = inbox.slice(inbox.indexOf('if (m.mediaType === "DOCUMENT")'), inbox.indexOf("function VisorDeFoto"));

  it("PDF abre no visor (botão), não em link com target=_blank", () => {
    expect(trecho).toContain("ehPdf(m.fileName) && aoAbrirDocumento");
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
  it("oferece salvar como arquivo com o nome", () => {
    expect(visor).toContain("linkParaSalvar(src)");
    expect(visor).toContain("download={nome}");
  });
});
