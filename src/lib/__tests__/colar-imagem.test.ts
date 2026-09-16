import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fraseDeConfirmacaoDaColagem, imagensColadas } from "../colar-imagem";

/**
 * COLAR IMAGEM NO CAMPO DE MENSAGEM (16/09/2026): o print colado vira envio
 * pelo mesmo caminho do clipe; texto continua colando como texto.
 */
const arq = (nome: string, tipo: string) => new File(["x"], nome, { type: tipo });

describe("o que vem da área de transferência", () => {
  it("só imagem vira envio; texto, PDF e lista vazia ficam de fora", () => {
    const lista = [arq("print.png", "image/png"), arq("doc.pdf", "application/pdf"), arq("foto.jpg", "image/jpeg")];
    expect(imagensColadas(lista).map((f) => f.name)).toEqual(["print.png", "foto.jpg"]);
    expect(imagensColadas([])).toEqual([]);
    expect(imagensColadas(null)).toEqual([]);
    expect(imagensColadas(undefined)).toEqual([]);
  });

  it("a confirmação fala com a pessoa pelo primeiro nome e conta certo", () => {
    expect(fraseDeConfirmacaoDaColagem(1, "Nívia")).toBe("Enviar a imagem colada para Nívia?");
    expect(fraseDeConfirmacaoDaColagem(3, "Nívia")).toBe("Enviar as 3 imagens coladas para Nívia?");
  });
});

describe("a tela liga o colar ao MESMO caminho do clipe", () => {
  const tela = readFileSync(join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"), "utf8");
  it("o campo principal tem onPaste, e o clipe e o colar chamam enviarArquivos", () => {
    expect(tela).toContain("onPaste={onColar}");
    expect(tela).toContain('void enviarArquivos(imagens, "IMAGE");');
    expect(tela).toContain("await enviarArquivos(Array.from(e.target.files ?? []), fileKindRef.current);");
  });
  it("texto colado segue colando: só há preventDefault quando veio imagem", () => {
    const trecho = tela.slice(tela.indexOf("function onColar("), tela.indexOf("async function enviarArquivos("));
    expect(trecho.indexOf("if (imagens.length === 0) return;")).toBeLessThan(trecho.indexOf("e.preventDefault();"));
    // e pede confirmação (colar sem querer mandaria o print para a cliente)
    expect(trecho).toContain("if (!confirm(fraseDeConfirmacaoDaColagem(");
  });
});
