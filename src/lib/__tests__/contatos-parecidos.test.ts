import { describe, it, expect } from "vitest";
import {
  acharParecidos,
  distanciaAte1,
  ehContatoParecido,
  nomeParecido,
  telefoneParecido,
} from "../contatos-parecidos";

// Guarda RN-020 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * Guarda do incidente da Toque Leve (20/08/2026): a mesma cliente em dois
 * cadastros, com um dígito trocado no telefone. Cada cadastro tinha a sua
 * conversa, duas vendedoras atendiam metade do assunto cada uma, e o que
 * saía pelo número errado não chegava em ninguém.
 */
const patricia = { id: "1", name: "Patricia Amorim", phone: "7591289574" };
const patriciaCerta = {
  id: "2",
  name: "Patricia Amorim dos Santos",
  phone: "75991289575",
};

describe("o caso real: Patricia Amorim × Patricia Amorim dos Santos", () => {
  it("avisa que os dois cadastros são a mesma pessoa", () => {
    expect(ehContatoParecido(patricia, patriciaCerta)).toBe(true);
  });

  it("o aviso vale nos dois sentidos", () => {
    expect(ehContatoParecido(patriciaCerta, patricia)).toBe(true);
  });

  /** O nome no banco costuma vir COM acento e o outro cadastro sem — foi o
   *  que quase deixou o aviso passar batido no caso real. */
  it("acha mesmo com acento em um dos cadastros", () => {
    expect(
      ehContatoParecido(patricia, {
        ...patriciaCerta,
        name: "Patrícia Amorim dos Santos",
      })
    ).toBe(true);
  });

  it("um cadastro nunca é parecido consigo mesmo", () => {
    expect(ehContatoParecido(patricia, { ...patricia })).toBe(false);
  });
});

describe("nome parecido", () => {
  it("ignora acento e caixa", () => {
    expect(nomeParecido("PATRÍCIA AMORIM", "patricia amorim")).toBe(true);
  });

  it("um nome é o começo do outro", () => {
    expect(nomeParecido("Ana Paula", "Ana Paula dos Santos")).toBe(true);
  });

  it("primeiro nome sozinho NÃO basta (metade da loja se chama Ana)", () => {
    expect(nomeParecido("Ana", "Ana Paula dos Santos")).toBe(false);
  });

  it("não corta no meio da palavra", () => {
    expect(nomeParecido("Ana Bela", "Ana Belarmina")).toBe(false);
  });
});

describe("telefone quase igual", () => {
  it("um dígito trocado", () => {
    expect(telefoneParecido("75991289574", "75991289575")).toBe(true);
  });

  it("com e sem o 9º dígito é o MESMO número", () => {
    expect(telefoneParecido("7591289575", "75991289575")).toBe(true);
  });

  it("com e sem o 9º dígito, e ainda um dígito trocado", () => {
    expect(telefoneParecido("7591289574", "75991289575")).toBe(true);
  });

  it("DDD diferente nunca é a mesma pessoa", () => {
    expect(telefoneParecido("11991289575", "75991289575")).toBe(false);
  });

  it("dois dígitos de diferença já é outro número", () => {
    expect(telefoneParecido("75991289533", "75991289575")).toBe(false);
  });
});

describe("alarme falso é pior que aviso nenhum", () => {
  it("mesmo nome, telefones diferentes: NÃO avisa", () => {
    expect(
      ehContatoParecido(
        { id: "1", name: "Maria Silva", phone: "75991110000" },
        { id: "2", name: "Maria Silva", phone: "75998887777" }
      )
    ).toBe(false);
  });

  it("telefones seguidos, nomes diferentes (irmãs): NÃO avisa", () => {
    expect(
      ehContatoParecido(
        { id: "1", name: "Ana Souza", phone: "75991289574" },
        { id: "2", name: "Carla Souza", phone: "75991289575" }
      )
    ).toBe(false);
  });

  it("telefone sem DDI/bagunçado não gera aviso", () => {
    expect(
      ehContatoParecido(
        { id: "1", name: "Patricia Amorim", phone: "9574" },
        { id: "2", name: "Patricia Amorim", phone: "75991289575" }
      )
    ).toBe(false);
  });
});

describe("distância de edição (teto de 1)", () => {
  it("igual, trocado, faltando e sobrando UM dígito", () => {
    expect(distanciaAte1("91289575", "91289575")).toBe(true);
    expect(distanciaAte1("91289574", "91289575")).toBe(true);
    expect(distanciaAte1("9128957", "91289575")).toBe(true);
    expect(distanciaAte1("912895755", "91289575")).toBe(true);
  });

  it("dois erros já é outro número", () => {
    expect(distanciaAte1("91289544", "91289575")).toBe(false);
    expect(distanciaAte1("912895", "91289575")).toBe(false);
  });
});

describe("acharParecidos", () => {
  it("devolve só os parecidos da lista", () => {
    const achados = acharParecidos(patriciaCerta, [
      patricia,
      { id: "9", name: "Joana Lima", phone: "75991289570" },
      { id: "10", name: "Patricia Amorim dos Santos", phone: "11991289575" },
    ]);
    expect(achados.map((c) => c.id)).toEqual(["1"]);
  });
});
