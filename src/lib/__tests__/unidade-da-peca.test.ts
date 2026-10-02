// Guarda RN-068
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LIMITE_UNIDADE,
  UNIDADE_PADRAO,
  aplicarParDaUnidade,
  contar,
  definirUnidade,
  lerUnidade,
  parseCategoryUnits,
  removerUnidade,
  renomearUnidade,
  unidadeDaCategoria,
  unidadeDaLoja,
  unidadeDaPeca,
} from "../catalogo/unidade";

/**
 * RN-068 · COMO CHAMAR A UNIDADE NO CATÁLOGO PÚBLICO.
 *
 * "R$ 86,90 / peça" está errado para quem vende conjunto. A regra tem três
 * partes e cada uma tem um teste aqui: o PAR (singular e plural), a ESCADA
 * (peça > categoria > loja) e a FRONTEIRA (texto de um produto usa a palavra
 * dele; texto do pedido inteiro usa a da loja; telas internas não mudam).
 */

describe("o par singular/plural", () => {
  it("os dois vazios = não configurado (segue o degrau de cima)", () => {
    expect(lerUnidade("", "")).toEqual({ ok: true, unidade: null });
    expect(lerUnidade(null, undefined)).toEqual({ ok: true, unidade: null });
  });

  it("metade preenchida é RECUSADA — gravar só o singular deixava '3 conjunto' na vitrine", () => {
    expect(lerUnidade("conjunto", "").ok).toBe(false);
    expect(lerUnidade("", "conjuntos").ok).toBe(false);
  });

  it("limpa o que a lojista digitou: maiúscula, espaço dobrado, sobra nas pontas", () => {
    expect(lerUnidade("  Conjunto ", "CONJUNTOS")).toEqual({
      ok: true,
      unidade: { singular: "conjunto", plural: "conjuntos" },
    });
    expect(lerUnidade("par de  meias", "pares de meias")).toEqual({
      ok: true,
      unidade: { singular: "par de meias", plural: "pares de meias" },
    });
  });

  it("número, emoji e símbolo não entram — a palavra vai para o catálogo público", () => {
    expect(lerUnidade("kit 2", "kits 2").ok).toBe(false);
    expect(lerUnidade("peça🎁", "peças🎁").ok).toBe(false);
    expect(lerUnidade("<b>kit</b>", "kits").ok).toBe(false);
  });

  it("palavra comprida demais é recusada com o motivo", () => {
    const r = lerUnidade("a".repeat(LIMITE_UNIDADE + 1), "b");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toMatch(/letras/);
  });

  it("a porta de escrita confere e normaliza o par no próprio payload (uma função para as três portas)", () => {
    const ok = { unidadeSingular: " Conjunto", unidadePlural: "CONJUNTOS" };
    expect(aplicarParDaUnidade(ok)).toBeNull();
    expect(ok).toEqual({ unidadeSingular: "conjunto", unidadePlural: "conjuntos" });
    // os dois vazios = tirar (grava null, não string vazia)
    const limpa = { unidadeSingular: "", unidadePlural: "" };
    expect(aplicarParDaUnidade(limpa)).toBeNull();
    expect(limpa).toEqual({ unidadeSingular: null, unidadePlural: null });
    // metade: recusa com frase, e não mexe no payload
    const meio = { unidadeSingular: "kit" };
    expect(aplicarParDaUnidade(meio)).toMatch(/singular e o plural/);
    // payload sem os campos: nada a fazer
    expect(aplicarParDaUnidade({})).toBeNull();
  });

  it("a cor separada pela Nuvemshop leva a unidade da peça junto (achado da revisão)", () => {
    const fonte = readFileSync("src/lib/estoque/separar-variacoes.ts", "utf8");
    expect(fonte).toMatch(/unidadeSingular: p\.unidadeSingular/);
    expect(fonte).toMatch(/unidadePlural: p\.unidadePlural/);
  });

  it("a prévia do link de campanha também fala a língua da loja", () => {
    const fonte = readFileSync("src/app/catalogo/[slug]/c/[promo]/page.tsx", "utf8");
    expect(fonte).not.toMatch(/OFF em peças selecionadas/);
    expect(fonte).toMatch(/unidadeDaLoja\(company\)\.plural/);
  });

  it("conta no singular e no plural", () => {
    const u = { singular: "conjunto", plural: "conjuntos" };
    expect(contar(1, u)).toBe("1 conjunto");
    expect(contar(3, u)).toBe("3 conjuntos");
    expect(contar(0, u)).toBe("0 conjuntos");
  });
});

describe("a escada: peça > categoria > loja > 'peça'", () => {
  const conjunto = { singular: "conjunto", plural: "conjuntos" };
  const kit = { singular: "kit", plural: "kits" };
  const porCategoria = definirUnidade({}, "Conjuntos", conjunto);

  it("loja sem nada configurado continua 'peça' — nada muda para quem não mexer", () => {
    expect(unidadeDaLoja({})).toEqual(UNIDADE_PADRAO);
    expect(unidadeDaLoja({ unidadeSingular: null, unidadePlural: null })).toEqual(UNIDADE_PADRAO);
    expect(unidadeDaPeca({ category: "Bermudas" }, {}, UNIDADE_PADRAO)).toEqual(UNIDADE_PADRAO);
  });

  it("a categoria manda sobre a loja", () => {
    expect(unidadeDaPeca({ category: "Conjuntos" }, porCategoria, UNIDADE_PADRAO)).toEqual(conjunto);
    // e a categoria é comparada como no resto do sistema: sem acento nem caixa
    expect(unidadeDaPeca({ category: "CONJUNTOS " }, porCategoria, UNIDADE_PADRAO)).toEqual(conjunto);
  });

  it("a peça manda sobre a categoria (o kit solto dentro de 'Conjuntos')", () => {
    expect(
      unidadeDaPeca(
        { category: "Conjuntos", unidadeSingular: "kit", unidadePlural: "kits" },
        porCategoria,
        UNIDADE_PADRAO
      )
    ).toEqual(kit);
  });

  it("par torto gravado num degrau é PULADO, não derruba a conta", () => {
    // só o singular na peça: cai na categoria
    expect(
      unidadeDaPeca({ category: "Conjuntos", unidadeSingular: "kit" }, porCategoria, UNIDADE_PADRAO)
    ).toEqual(conjunto);
    // loja com par torto: cai no padrão
    expect(unidadeDaLoja({ unidadeSingular: "kit", unidadePlural: "" })).toEqual(UNIDADE_PADRAO);
  });

  it("a peça sem nada segue a loja quando a categoria não tem", () => {
    const loja = { singular: "peça íntima", plural: "peças íntimas" };
    expect(unidadeDaPeca({ category: "Calcinhas" }, porCategoria, loja)).toEqual(loja);
  });
});

describe("o mapa por categoria (gravado como JSON na loja)", () => {
  it("lê o JSON e ignora lixo sem derrubar", () => {
    const mapa = parseCategoryUnits(
      JSON.stringify({
        Conjuntos: { singular: "conjunto", plural: "conjuntos" },
        Kits: { singular: "kit" }, // metade: fora
        Lixo: "não é objeto",
      })
    );
    expect(unidadeDaCategoria(mapa, "Conjuntos")).toEqual({ singular: "conjunto", plural: "conjuntos" });
    expect(unidadeDaCategoria(mapa, "Kits")).toBeNull();
    expect(parseCategoryUnits("isso não é json")).toEqual({});
    expect(parseCategoryUnits(null)).toEqual({});
  });

  it("renomear a categoria leva a unidade junto (a lição da descrição)", () => {
    let mapa = definirUnidade({}, "Conjuntos", { singular: "conjunto", plural: "conjuntos" });
    mapa = renomearUnidade(mapa, "Conjuntos", "Conjuntos Fitness");
    expect(unidadeDaCategoria(mapa, "Conjuntos")).toBeNull();
    expect(unidadeDaCategoria(mapa, "Conjuntos Fitness")?.singular).toBe("conjunto");
  });

  it("apagar a categoria não deixa unidade órfã; gravar null tira", () => {
    let mapa = definirUnidade({}, "Conjuntos", { singular: "conjunto", plural: "conjuntos" });
    expect(Object.keys(removerUnidade(mapa, "Conjuntos"))).toHaveLength(0);
    mapa = definirUnidade(mapa, "Conjuntos", null);
    expect(Object.keys(mapa)).toHaveLength(0);
  });
});

describe("a fronteira: onde a palavra muda e onde NÃO muda", () => {
  const vitrine = readFileSync("src/app/catalogo/[slug]/public-catalog.tsx", "utf8");

  it("a vitrine não tem mais 'peça' escrito à mão nos textos da cliente", () => {
    // o "/ peça" do card e da ficha, o atacado, o adicionar e a mensagem
    // do pedido passam todos pela unidade — um esquecido é a cliente lendo
    // "conjunto" num lugar e "peça" no outro
    expect(vitrine).not.toMatch(/\/ peça\b/);
    expect(vitrine).not.toMatch(/\? "peças" : "peça"/);
    expect(vitrine).not.toMatch(/=== 1 \? "peça" : "peças"/);
  });

  it("o mínimo da SACOLA (que mistura categorias) usa a palavra da LOJA", () => {
    expect(vitrine).toMatch(/contar\(falta, unidadeDaLoja\)/);
    expect(vitrine).toMatch(/contar\(minTarget - minCurrent, unidadeDaLoja\)/);
  });

  it("o texto de UM produto usa a palavra DELE", () => {
    expect(vitrine).toMatch(/card\.product\.unidade\.singular/);
    expect(vitrine).toMatch(/sheet\.product\.unidade\.singular/);
    expect(vitrine).toMatch(/contar\(q, c\.product\.unidade\)/);
  });

  it("os DOIS produtores da vitrine resolvem a unidade no servidor", () => {
    for (const p of [
      "src/app/catalogo/[slug]/montar-catalogo.tsx",
      "src/app/catalogo/[slug]/c/[promo]/page.tsx",
    ]) {
      const fonte = readFileSync(p, "utf8");
      expect(fonte, p).toMatch(/unidade: unidadeDaPeca\(/);
      expect(fonte, p).toMatch(/unidadeDaLoja=\{unidadeLoja\}/);
    }
  });

  it("as telas internas NÃO mudam: a Separação continua contando 'peças'", () => {
    // um pedido mistura categorias e "4 de 4 peças bipadas" precisa ser uma
    // palavra só para quem está na arara — a regra é só da vitrine
    const separacao = readFileSync("src/lib/etiquetas/separacao.ts", "utf8");
    expect(separacao).toMatch(/peças bipadas/);
    expect(separacao).not.toMatch(/unidadeDaPeca|unidadeDaLoja/);
  });
});
