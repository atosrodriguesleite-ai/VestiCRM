// Guarda RN-067
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ajustarTamanhoNaSacola,
  eventoDoAjuste,
  avisoDoMinimoSemEstoque,
  avisoDoTeto,
  disponivelNaVitrine,
  limitarQuantidade,
  limitarSacola,
  TETO_POR_LINHA,
} from "../catalogo/teto-do-estoque";

/**
 * RN-067 — a quantidade no catálogo público PARA no estoque disponível.
 *
 * Relato da Entre Linhas (25/09/2026): peça com 1 no P, a cliente pôs 8 na
 * sacola e enviou. O servidor reservava a única e anotava a falta (RN-003,
 * RN-010), mas a vitrine só conhecia "tem / não tem".
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("RN-067 · o disponível que a vitrine recebe", () => {
  it("é o stock da peça, nunca negativo e nunca acima do que a rota aceita numa linha", () => {
    expect(disponivelNaVitrine(1)).toBe(1);
    expect(disponivelNaVitrine(0)).toBe(0);
    expect(disponivelNaVitrine(-3)).toBe(0);
    expect(disponivelNaVitrine(2.7)).toBe(2);
    expect(disponivelNaVitrine(50_000)).toBe(TETO_POR_LINHA);
    expect(disponivelNaVitrine(null)).toBe(0);
    expect(disponivelNaVitrine(Number.NaN)).toBe(0);
  });
});

describe("RN-067 · a quantidade para no teto", () => {
  it("8 pedidas com 1 disponível viram 1 (o caso da Entre Linhas)", () => {
    expect(limitarQuantidade(8, 1)).toBe(1);
  });

  it("abaixo do teto passa inteira; zero e negativo viram zero; esgotado não aceita nada", () => {
    expect(limitarQuantidade(3, 10)).toBe(3);
    expect(limitarQuantidade(0, 10)).toBe(0);
    expect(limitarQuantidade(-2, 10)).toBe(0);
    expect(limitarQuantidade(2, 0)).toBe(0);
    expect(limitarQuantidade(2, -1)).toBe(0);
  });
});

describe("RN-067 · a frase ao lado do tamanho", () => {
  it("peça quase acabando avisa desde o começo, antes do primeiro toque", () => {
    expect(avisoDoTeto(0, 1)).toBe("só 1 disponível");
    expect(avisoDoTeto(0, 3)).toBe("só 3 disponíveis");
  });

  it("com bastante peça só avisa quando a quantidade ENCOSTA no teto", () => {
    expect(avisoDoTeto(0, 12)).toBeNull();
    expect(avisoDoTeto(5, 12)).toBeNull();
    expect(avisoDoTeto(12, 12)).toBe("só 12 disponíveis");
  });

  it("esgotado não é assunto da frase (o rótulo 'esgotado' já existe)", () => {
    expect(avisoDoTeto(0, 0)).toBeNull();
  });
});

describe("RN-067 · a sacola que volta passa pelo estoque de hoje", () => {
  const vitrine: Record<string, Record<string, number>> = {
    "regata|Algodão Doce": { P: 1, M: 0 },
    "short|Preto": { M: 5 },
  };
  const disponivelDe = (chave: string, tamanho: string) => vitrine[chave]?.[tamanho];

  it("desce a quantidade ao disponível, tira o tamanho zerado e o que sumiu da vitrine", () => {
    const { sacola, ajustou } = limitarSacola(
      {
        "regata|Algodão Doce": { P: 8, M: 2, GG: 1 },
        "short|Preto": { M: 3 },
        "vestido|Azul": { M: 1 },
      },
      disponivelDe
    );
    expect(sacola).toEqual({
      "regata|Algodão Doce": { P: 1 },
      "short|Preto": { M: 3 },
    });
    expect(ajustou).toBe(true);
  });

  it("sacola que cabe volta igual e diz que não mexeu", () => {
    const { sacola, ajustou } = limitarSacola({ "short|Preto": { M: 5 } }, disponivelDe);
    expect(sacola).toEqual({ "short|Preto": { M: 5 } });
    expect(ajustou).toBe(false);
  });
});

describe("RN-067 · link de atacado: quando o estoque não alcança o mínimo, a sacola DIZ", () => {
  it("modelo com mínimo 6 e 4 peças no total ganha a frase com o caminho (WhatsApp)", () => {
    expect(avisoDoMinimoSemEstoque(6, 4)).toBe(
      "só há 4 peças disponíveis deste modelo — chame a loja no WhatsApp para combinar"
    );
    expect(avisoDoMinimoSemEstoque(6, 1)).toContain("só há 1 peça disponível");
  });

  it("estoque que alcança o mínimo (ou modelo sem mínimo) não diz nada", () => {
    expect(avisoDoMinimoSemEstoque(6, 6)).toBeNull();
    expect(avisoDoMinimoSemEstoque(6, 40)).toBeNull();
    expect(avisoDoMinimoSemEstoque(1, 0)).toBeNull();
  });
});

describe("RN-067 · a vitrine RECEBE a quantidade e USA o teto", () => {
  // o comportamento do `+` é guardado renderizando a linha de verdade em
  // `linha-de-tamanho.test.tsx`; aqui só se confere a LIGAÇÃO: quem manda
  // o número e quem o usa (a linha, e as duas sacolas que voltam)
  it("catálogo geral E catálogo de campanha mandam o disponível por variação (e só ele)", () => {
    // o catálogo normal lê o acervo pela lib (RN-094, a mesma que o PDF usa);
    // o de campanha tem a leitura dele, com o recorte da campanha
    for (const rel of ["src/lib/catalogo/acervo.ts", "src/app/catalogo/[slug]/c/[promo]/page.tsx"]) {
      const fonte = ler(rel);
      expect(fonte).toContain("disponivel: disponivelNaVitrine(");
      // a peça sob encomenda (RN-076) recebe o teto da linha, resolvida no servidor
      expect(fonte).toContain("vendeSobEncomenda({");
      // "tem/não tem" é derivado do número, uma vez, na vitrine
      expect(fonte).not.toContain("available: v.stock > 0");
    }
  });

  it("a folha da peça desenha cada tamanho pela LinhaDeTamanho e as duas sacolas que voltam passam pela mesma régua", () => {
    const vitrine = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    expect(vitrine).toContain("<LinhaDeTamanho");
    expect(vitrine.match(/limitarSacola\(/g)?.length).toBe(2);
  });
});

describe("RN-067 · ajustar um tamanho DENTRO da sacola", () => {
  const ordem = ["P", "M", "G", "GG"];
  const sacola = { "p1|Militar": { P: 3, M: 3, G: 3, GG: 3 }, "p2|Preto": { M: 2 } };

  it("tira só o tamanho pedido e deixa o resto da peça e as outras peças como estavam", () => {
    const r = ajustarTamanhoNaSacola(sacola, "p1|Militar", "G", 0, 10, ordem);
    expect(r["p1|Militar"]).toEqual({ P: 3, M: 3, GG: 3 });
    expect(r["p2|Preto"]).toEqual({ M: 2 });
    // não mexe na sacola de entrada
    expect(sacola["p1|Militar"].G).toBe(3);
  });

  it("a quantidade nova para no estoque, como no + da folha da peça", () => {
    const r = ajustarTamanhoNaSacola(sacola, "p1|Militar", "P", 8, 5, ordem);
    expect(r["p1|Militar"].P).toBe(5);
  });

  it("zerar o último tamanho tira a peça da sacola", () => {
    const r = ajustarTamanhoNaSacola(sacola, "p2|Preto", "M", 0, 10, ordem);
    expect("p2|Preto" in r).toBe(false);
    expect(r["p1|Militar"]).toEqual(sacola["p1|Militar"]);
  });

  it("tamanho acrescentado entra na ordem da arara, não no fim", () => {
    const r = ajustarTamanhoNaSacola({ "p1|Militar": { M: 1, GG: 1 } }, "p1|Militar", "P", 2, 10, ordem);
    expect(Object.keys(r["p1|Militar"])).toEqual(["P", "M", "GG"]);
  });

  it("o ajuste conta UM evento pelo saldo — trocar tamanho com o mesmo total não conta nada", () => {
    expect(eventoDoAjuste(12, 9)).toEqual({ type: "cart_remove", qty: 3 });
    expect(eventoDoAjuste(9, 11)).toEqual({ type: "cart_add", qty: 2 });
    expect(eventoDoAjuste(12, 12)).toBeNull();
  });
});
