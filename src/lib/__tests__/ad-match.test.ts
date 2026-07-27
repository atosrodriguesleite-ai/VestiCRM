import { describe, it, expect } from "vitest";
import { adCode, normalizaRefDigitada, refsDaCampanha, campanhaDoAnuncio } from "../ad-match";

/**
 * A dona da loja cola o LINK do post na campanha; o WhatsApp manda o link do
 * anúncio na prévia. Os dois caminhos têm que chegar no MESMO código, senão a
 * atribuição automática não acontece.
 */
describe("adCode (código do anúncio que veio do WhatsApp)", () => {
  it("tira o código de um post do Instagram", () => {
    // caso real da loja Toque Leve
    expect(adCode({ sourceUrl: "https://www.instagram.com/p/DbN-U8QsQK4/" })).toBe("dbn-u8qsqk4");
    expect(adCode({ sourceUrl: "https://instagram.com/reel/ABC123xyz_-/?igsh=1" })).toBe("abc123xyz_-");
  });

  it("tira o id de um post do Facebook", () => {
    expect(adCode({ sourceUrl: "https://www.facebook.com/loja/posts/1234567890123" })).toBe("1234567890123");
    expect(adCode({ sourceUrl: "https://facebook.com/story.php?story_fbid=987654321098&id=1" })).toBe("987654321098");
  });

  it("usa o id do anúncio quando não há link aproveitável", () => {
    expect(adCode({ sourceId: "120210000000012345" })).toBe("120210000000012345");
    expect(adCode({ sourceUrl: "https://loja.com.br/promo", sourceId: "ABC-99" })).toBe("abc-99");
  });

  it("sem prévia utilizável, não inventa código", () => {
    expect(adCode(null)).toBeNull();
    expect(adCode({})).toBeNull();
    expect(adCode({ title: "Só um título" })).toBeNull();
  });
});

describe("normalizaRefDigitada (o que a loja cola no cadastro)", () => {
  it("aceita o link inteiro, com ou sem https", () => {
    expect(normalizaRefDigitada("https://www.instagram.com/p/DbN-U8QsQK4/")).toBe("dbn-u8qsqk4");
    expect(normalizaRefDigitada("instagram.com/p/DbN-U8QsQK4")).toBe("dbn-u8qsqk4");
  });

  it("aceita só o código, de qualquer jeito que a pessoa digite", () => {
    expect(normalizaRefDigitada("DbN-U8QsQK4")).toBe("dbn-u8qsqk4");
    expect(normalizaRefDigitada("  #DbN-U8QsQK4/ ")).toBe("dbn-u8qsqk4");
  });

  it("linha vazia é ignorada", () => {
    expect(normalizaRefDigitada("")).toBeNull();
    expect(normalizaRefDigitada("   ")).toBeNull();
  });
});

describe("casamento anúncio → campanha", () => {
  const campanhas = [
    { id: "c1", active: true, adRefs: "https://www.instagram.com/p/DbN-U8QsQK4/\nabc123" },
    { id: "c2", active: true, adRefs: "outro-anuncio" },
    { id: "c3", active: false, adRefs: "pausada123" }, // pausada não puxa
  ];

  it("o link colado na campanha casa com a prévia que veio do WhatsApp", () => {
    const code = adCode({ sourceUrl: "https://www.instagram.com/p/DbN-U8QsQK4/?igshid=xyz" });
    expect(campanhaDoAnuncio(code, campanhas)?.id).toBe("c1");
  });

  it("código digitado direto também casa", () => {
    expect(campanhaDoAnuncio("abc123", campanhas)?.id).toBe("c1");
    expect(campanhaDoAnuncio("outro-anuncio", campanhas)?.id).toBe("c2");
  });

  it("campanha pausada não recebe atribuição nova", () => {
    expect(campanhaDoAnuncio("pausada123", campanhas)).toBeNull();
  });

  it("anúncio desconhecido não cai em campanha errada", () => {
    expect(campanhaDoAnuncio("naoexiste", campanhas)).toBeNull();
    expect(campanhaDoAnuncio(null, campanhas)).toBeNull();
  });

  it("separa a lista por linha, vírgula ou ponto-e-vírgula", () => {
    expect(refsDaCampanha("a1\nb2, c3; d4")).toEqual(["a1", "b2", "c3", "d4"]);
    expect(refsDaCampanha(null)).toEqual([]);
  });
});
