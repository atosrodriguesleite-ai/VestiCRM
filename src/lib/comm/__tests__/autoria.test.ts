import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoriaDaMensagem, prefixoDaPrevia, primeiroNome } from "../autoria";

/**
 * "Quem respondeu essa cliente?" é pergunta de dono de loja com equipe.
 * O sistema responde — para a EQUIPE. A cliente do outro lado continua
 * conversando com a loja, sem assinatura nenhuma no texto.
 */

describe("mensagem enviada pela Central de Atendimento", () => {
  const msg = { direction: "OUT", kind: "TEXT", authorName: "Júlia Ferreira" };

  it("mostra o nome de quem atendeu", () => {
    const a = autoriaDaMensagem(msg)!;
    expect(a.tipo).toBe("PESSOA");
    expect(a.rotulo).toBe("Júlia");
    expect(a.detalhe).toContain("Júlia Ferreira");
  });

  it("na lista de conversas, a prévia diz quem falou por último", () => {
    expect(prefixoDaPrevia({ ...msg, kind: "TEXT" })).toBe("Júlia: ");
  });
});

describe("mensagem enviada pelo aplicativo do celular", () => {
  const doCelular = { direction: "OUT", kind: "TEXT", authorName: null };

  it("NÃO inventa autor — diz que saiu pelo celular", () => {
    const a = autoriaDaMensagem(doCelular)!;
    expect(a.tipo).toBe("CELULAR");
    expect(a.rotulo).toBe("pelo celular");
  });

  it("explica por que não tem nome e o que fazer para ter", () => {
    const a = autoriaDaMensagem(doCelular)!;
    expect(a.detalhe).toContain("não informa quem digitou");
    expect(a.detalhe).toContain("Central de Atendimento");
  });

  it("na lista, marca com o celular em vez de um nome qualquer", () => {
    expect(prefixoDaPrevia(doCelular)).toBe("📱 ");
  });
});

describe("casos de borda", () => {
  it("mensagem da cliente não tem autoria da loja", () => {
    expect(autoriaDaMensagem({ direction: "IN", authorName: null })).toBeNull();
    expect(prefixoDaPrevia({ direction: "IN", kind: "TEXT", authorName: null })).toBe("");
  });

  it("nota interna sem autor é da equipe — nunca 'pelo celular'", () => {
    // nota interna não sai do sistema, então não pode ter vindo do aparelho
    const a = autoriaDaMensagem({ direction: "OUT", kind: "NOTE", authorName: null })!;
    expect(a.tipo).toBe("EQUIPE");
    expect(prefixoDaPrevia({ direction: "OUT", kind: "NOTE", authorName: null })).toBe("📝 ");
  });

  it("nome com espaços sobrando não quebra o rótulo", () => {
    expect(primeiroNome("  Renata   Alves ")).toBe("Renata");
    expect(autoriaDaMensagem({ direction: "OUT", authorName: "   " })!.tipo).toBe("CELULAR");
  });
});

describe("o nome é da EQUIPE — a cliente nunca recebe assinatura", () => {
  const engine = readFileSync(join(process.cwd(), "src/lib/comm/engine.ts"), "utf8");

  it("o texto enviado ao provedor é exatamente o que foi digitado", () => {
    // se alguém um dia concatenar o autor no texto, a cliente passa a ver o
    // nome da vendedora no WhatsApp dela — é o oposto do pedido
    const chamada = /provider\.send\(\{[\s\S]*?\}\);/.exec(engine)?.[0] ?? "";
    expect(chamada).toContain("text:");
    expect(chamada).toContain("input.body");
    expect(chamada).not.toMatch(/authorName/);
  });

  it("nenhum trecho do envio monta texto com o nome do autor", () => {
    expect(engine).not.toMatch(/text:\s*`?\$\{?\s*input\.authorName/);
  });
});
