import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { imagensColadas, rotuloDosAnexos } from "../colar-imagem";

/**
 * COLAR IMAGEM NO CAMPO DE MENSAGEM (16/09/2026): o print colado fica preso
 * no campo até o Enter, sem pergunta, e sai pelo mesmo caminho do clipe;
 * texto continua colando como texto.
 */
const arq = (nome: string, tipo: string) => new File(["x"], nome, { type: tipo });

describe("o que vem da área de transferência", () => {
  it("só imagem fica presa no campo; texto, PDF e lista vazia ficam de fora", () => {
    const lista = [arq("print.png", "image/png"), arq("doc.pdf", "application/pdf"), arq("foto.jpg", "image/jpeg")];
    expect(imagensColadas(lista).map((f) => f.name)).toEqual(["print.png", "foto.jpg"]);
    expect(imagensColadas([])).toEqual([]);
    expect(imagensColadas(null)).toEqual([]);
    expect(imagensColadas(undefined)).toEqual([]);
  });

  it("a faixa diz quantas e como enviar", () => {
    expect(rotuloDosAnexos(1)).toBe("1 imagem pronta para enviar · Enter envia");
    expect(rotuloDosAnexos(3)).toBe("3 imagens prontas para enviar · Enter envia");
  });
});

describe("a tela: colar PRENDE no campo, Enter/botão ENVIA pelo caminho do clipe, sem pergunta", () => {
  const tela = readFileSync(join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"), "utf8");
  const colar = tela.slice(tela.indexOf("function onColar("), tela.indexOf("async function enviarArquivos("));
  const enviar = tela.slice(tela.indexOf("function sendMessage() {"), tela.indexOf("/** Começo do toque na bolha"));

  it("colar só prende (setAnexosColados), não envia nem pergunta", () => {
    expect(tela).toContain("onPaste={onColar}");
    expect(colar).toContain("setAnexosColados((atuais) => {");
    expect(colar).not.toContain("enviarArquivos(");
    expect(colar).not.toContain("confirm(");
    // texto colado segue colando: preventDefault só quando veio imagem
    expect(colar.indexOf("if (imagens.length === 0) return;")).toBeLessThan(colar.indexOf("e.preventDefault();"));
  });

  it("Enter/botão manda as imagens presas PRIMEIRO e o texto atrás, e o botão liga só com imagem", () => {
    expect(enviar).toContain('await enviarArquivos(imagens, "IMAGE");');
    expect(enviar.indexOf('await enviarArquivos(imagens, "IMAGE");')).toBeLessThan(enviar.indexOf("await mandarTexto();"));
    expect(enviar).toContain("if (!body && imagens.length === 0) return;");
    expect(tela).toContain("disabled={(!draft.trim() && anexosColados.length === 0) || sending}");
  });

  it("trocar de conversa solta as imagens coladas (não vão para outra cliente)", () => {
    expect(tela).toContain("limparAnexosColados();\n  }, [selectedId, limparAnexosColados]);");
  });

  it("o clipe continua pelo mesmo caminho", () => {
    expect(tela).toContain("await enviarArquivos(Array.from(e.target.files ?? []), fileKindRef.current);");
  });
});
