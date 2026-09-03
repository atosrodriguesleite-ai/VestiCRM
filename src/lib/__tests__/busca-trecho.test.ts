import { describe, it, expect } from "vitest";
import { consultaDePalavras, localizarTermo, palavrasDaBusca, trechoDaBusca } from "../busca";

/**
 * A LUPA DA CENTRAL ACHA PALAVRA DENTRO DA CONVERSA (pedido do dono,
 * 03/09/2026): "quero pesquisar uma palavra e ver onde ela aparece, como
 * no aplicativo do WhatsApp". O trecho mostrado na lista tem que apontar
 * para a palavra CERTA no texto ORIGINAL — com acento e maiúscula do jeito
 * que a cliente escreveu.
 */
describe("localizarTermo: acha ignorando acento e maiúscula, devolve a posição original", () => {
  it("acha 'vermelha' em 'Blusa VERMELHA'", () => {
    expect(localizarTermo("Blusa VERMELHA tam M", "vermelha")).toEqual({ inicio: 6, fim: 14 });
  });

  it("acento no texto não atrapalha, e a posição é a do texto original", () => {
    const t = "Mando para Goiânia amanhã";
    const onde = localizarTermo(t, "goiania")!;
    expect(t.slice(onde.inicio, onde.fim)).toBe("Goiânia");
  });

  it("acento no que foi digitado também não atrapalha", () => {
    const t = "chegou a blusa";
    const onde = localizarTermo(t, "Blúsa")!;
    expect(t.slice(onde.inicio, onde.fim)).toBe("blusa");
  });

  it("duas palavras com espaço casam (o espaço não some na normalização)", () => {
    const t = "quero a blusa vermelha";
    const onde = localizarTermo(t, "blusa vermelha")!;
    expect(t.slice(onde.inicio, onde.fim)).toBe("blusa vermelha");
  });

  it("emoji antes da palavra não desloca a posição", () => {
    const t = "🎉 Promoção de hoje";
    const onde = localizarTermo(t, "promocao")!;
    expect(t.slice(onde.inicio, onde.fim)).toBe("Promoção");
  });

  it("texto já decomposto (NFD) também acha no lugar certo", () => {
    const t = "Pedido de Goiânia".normalize("NFD");
    const onde = localizarTermo(t, "goiânia")!;
    expect(t.slice(onde.inicio, onde.fim).normalize("NFC")).toBe("Goiânia");
  });

  it("não acha o que não está lá, e termo vazio não acha nada", () => {
    expect(localizarTermo("blusa", "calça")).toBeNull();
    expect(localizarTermo("blusa", "  ")).toBeNull();
  });
});

describe("trechoDaBusca: o pedaço em volta da palavra, pronto para pintar", () => {
  it("separa antes / palavra / depois", () => {
    expect(trechoDaBusca("quero a blusa vermelha tamanho M", "vermelha")).toEqual({
      antes: "quero a blusa ",
      casa: "vermelha",
      depois: " tamanho M",
    });
  });

  it("texto longo é cortado com reticências dos dois lados", () => {
    const longo = `${"a".repeat(100)} vermelha ${"b".repeat(100)}`;
    const t = trechoDaBusca(longo, "vermelha", 10)!;
    expect(t.antes).toBe("…aaaaaaaaa ");
    expect(t.casa).toBe("vermelha");
    expect(t.depois).toBe(" bbbbbbbbb…");
  });

  it("quebra de linha vira espaço (a lista tem uma linha só)", () => {
    const t = trechoDaBusca("*Novo pedido*\n\n2x Blusa\n1x Calça", "calça")!;
    expect(t.antes).not.toContain("\n");
    expect(t.casa).toBe("Calça");
  });

  it("sem a palavra, não há trecho", () => {
    expect(trechoDaBusca("oi", "blusa")).toBeNull();
  });
});

describe("palavrasDaBusca e consultaDePalavras: o que vai para o to_tsquery", () => {
  it("cada palavra vira prefixo, todas obrigatórias", () => {
    expect(consultaDePalavras("blusa vermelha")).toBe("blusa:* & vermelha:*");
  });

  it("acento e maiúscula somem; pontuação e emoji não entram; barra separa", () => {
    expect(consultaDePalavras("Calça JEANS, 50%!")).toBe("calca:* & jeans:* & 50:*");
    expect(consultaDePalavras("🎉 promoção")).toBe("promocao:*");
    expect(consultaDePalavras("azul/branco")).toBe("azul:* & branco:*");
  });

  it("letra solta cai fora: 'R$ 100' procura 100, não 'r' (que casaria 'reais')", () => {
    expect(palavrasDaBusca("R$ 100")).toEqual(["100"]);
    expect(consultaDePalavras("R$ 100")).toBe("100:*");
  });

  it("sem uma palavra de 3 letras não há busca ('a b', 'ab' abririam a loja inteira)", () => {
    expect(palavrasDaBusca("a b")).toEqual([]);
    expect(consultaDePalavras("ab")).toBeNull();
    // mas 'tam 38' vale: 'tam' tem 3 e o 38 vai junto
    expect(consultaDePalavras("tam 38")).toBe("tam:* & 38:*");
  });

  it("caractere especial do tsquery nunca chega ao banco", () => {
    expect(consultaDePalavras("blusa & !x | (d) 'e' :*")).toBe("blusa:*");
  });

  it("sem letra nem número, não há consulta", () => {
    expect(consultaDePalavras("🎉🎉")).toBeNull();
    expect(consultaDePalavras("  ")).toBeNull();
  });
});
