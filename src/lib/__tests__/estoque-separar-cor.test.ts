import { describe, it, expect } from "vitest";
import { gruposParaSeparar, produtoNsDaVariacao } from "../estoque/dono-do-estoque";

/**
 * A COR QUE JÁ É DE OUTRO PRODUTO NA NUVEMSHOP SE SEPARA EM PRODUTO PRÓPRIO
 * (relato da Entre Linhas, 01/10/2026): a "Azul" ganhou produto próprio lá,
 * a sync a religou dentro da peça antiga (ao lado da "Laranja") e a trava
 * "remova lá" não tinha saída. A regra pura diz QUAIS grupos podem sair; o
 * mover (sem apagar) mora em `lib/estoque/separar-variacoes.ts`.
 */

const v = (id: string, nuvemshopId: string | null, nuvemshopProductId: string | null) => ({
  id,
  nuvemshopId,
  nuvemshopProductId,
});
const ids = (gs: { nsProdutoId: string; variantes: { id: string }[] }[]) =>
  gs.map((g) => [g.nsProdutoId, g.variantes.map((x) => x.id)]);

describe("a cor pertence a qual produto da Nuvemshop", () => {
  it("a da própria variação manda; sem ela, a do produto daqui (vínculo antigo)", () => {
    expect(produtoNsDaVariacao(v("a", "1", "N2"), { nuvemshopId: "N1" })).toBe("N2");
    expect(produtoNsDaVariacao(v("a", "1", null), { nuvemshopId: "N1" })).toBe("N1");
    expect(produtoNsDaVariacao(v("a", "1", null), { nuvemshopId: null })).toBeNull();
  });
});

describe("quais cores podem virar produto próprio", () => {
  it("o caso da Entre Linhas: a peça espelha N1 e a Azul já é de N2 — só a Azul sai", () => {
    const g = gruposParaSeparar({ nuvemshopId: "N1", jueriId: null }, [v("laranja", "11", "N1"), v("azul", "22", "N2")]);
    expect(ids(g)).toEqual([["N2", ["azul"]]]);
  });

  it("as irmãs do mesmo produto de lá saem juntas (deixar uma faria a sync voltar a achar a peça)", () => {
    const g = gruposParaSeparar({ nuvemshopId: "N1", jueriId: null }, [
      v("laranja", "11", "N1"),
      v("azulP", "21", "N2"),
      v("azulM", "22", "N2"),
    ]);
    expect(ids(g)).toEqual([["N2", ["azulP", "azulM"]]]);
  });

  it("peça montada aqui (sem produto de lá) que junta dois produtos: os dois grupos podem sair", () => {
    const g = gruposParaSeparar({ nuvemshopId: null, jueriId: null }, [v("l", "1", "M1"), v("a", "2", "M2")]);
    expect(ids(g)).toEqual([
      ["M1", ["l"]],
      ["M2", ["a"]],
    ]);
  });

  it("tudo do mesmo produto de lá: nada a separar", () => {
    expect(gruposParaSeparar({ nuvemshopId: null, jueriId: null }, [v("p", "1", "M1"), v("m", "2", "M1")])).toEqual([]);
    expect(gruposParaSeparar({ nuvemshopId: "N1", jueriId: null }, [v("p", "1", "N1"), v("m", "2", null)])).toEqual([]);
  });

  it("a peça inteira em outro produto de lá não 'se separa' de si mesma (ficaria vazia)", () => {
    expect(gruposParaSeparar({ nuvemshopId: "N1", jueriId: null }, [v("a", "1", "N2")])).toEqual([]);
  });

  it("vínculo antigo sem produto de lá conhecido trava tudo — a próxima sync preenche", () => {
    expect(gruposParaSeparar({ nuvemshopId: null, jueriId: null }, [v("a", "1", "M1"), v("b", "2", "M2"), v("c", "3", null)])).toEqual([]);
  });

  it("variação sem vínculo fica (é nossa) e peça do Jueri não entra", () => {
    const g = gruposParaSeparar({ nuvemshopId: "N1", jueriId: null }, [v("l", "1", "N1"), v("a", "2", "N2"), v("solta", null, null)]);
    expect(ids(g)).toEqual([["N2", ["a"]]]);
    expect(gruposParaSeparar({ nuvemshopId: "N1", jueriId: "J" }, [v("l", "1", "N1"), v("a", "2", "N2")])).toEqual([]);
  });
});
