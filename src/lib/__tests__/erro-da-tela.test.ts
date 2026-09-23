import { describe, it, expect } from "vitest";
import {
  MAX_RECARGAS_NA_JANELA,
  MS_ENTRE_RECARGAS,
  MS_JANELA_DE_RECARGAS,
  MS_VALIDADE_DO_RELATO,
  TETO_CAMINHO,
  TETO_DETALHE,
  TETO_MENSAGEM,
  caminhoSemCodigos,
  deveRelatar,
  lerRecargas,
  pareceVersaoVelha,
  podeRecarregarSozinho,
  recargasComEsta,
  relatoAindaVale,
  relatoDoErro,
  relatoEsperado,
  soOCaminho,
} from "../erro-da-tela";

// Guarda RN-065
/**
 * A TELA QUE QUEBROU SE RECUPERA — E CONTA O QUE HOUVE.
 *
 * Relato do dono (20/09/2026): o app aberto no iPhone por muito tempo
 * voltava com a frase crua do Next em inglês, sem botão nenhum. A regra
 * pura mora aqui; a tela que a aplica tem teste próprio, renderizado
 * (`components/__tests__/tela-de-erro.test.tsx`).
 */

describe("o que é 'versão velha' (e só isso recarrega sozinho)", () => {
  it("o pedaço de código que não veio, como o webpack diz", () => {
    const e = new Error("Loading chunk 482 failed.\n(error: https://x/_next/static/chunks/482.js)");
    e.name = "ChunkLoadError";
    expect(pareceVersaoVelha(e)).toBe(true);
    expect(pareceVersaoVelha(new Error("Loading chunk app-pedidos failed."))).toBe(true);
    expect(pareceVersaoVelha(new Error("Loading CSS chunk 12 failed."))).toBe(true);
  });

  it("o mesmo caso dito pelos navegadores — o Safari do iPhone inclusive", () => {
    expect(pareceVersaoVelha(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(pareceVersaoVelha(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(pareceVersaoVelha(new TypeError("Importing a module script failed."))).toBe(true);
  });

  it("erro comum NÃO recarrega sozinho — nem se citar 'chunk' por acaso", () => {
    // recarregar às escondidas esconderia defeito de verdade
    expect(pareceVersaoVelha(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(pareceVersaoVelha(new Error("chunk de dados veio vazio"))).toBe(false);
    expect(pareceVersaoVelha(new Error("Failed to fetch"))).toBe(false);
  });

  it("o que nem é erro não quebra a regra", () => {
    expect(pareceVersaoVelha(null)).toBe(false);
    expect(pareceVersaoVelha(undefined)).toBe(false);
    expect(pareceVersaoVelha("Loading chunk 1 failed")).toBe(false);
    expect(pareceVersaoVelha({ message: 42 })).toBe(false);
  });
});

describe("a trava contra o loop de recarregar", () => {
  const agora = 1_800_000_000_000;
  const min = 60_000;

  it("nunca recarregou nesta aba: pode", () => {
    expect(podeRecarregarSozinho([], agora)).toBe(true);
  });

  it("recarregou há pouco: NÃO pode — seria loop se a recarga não curar", () => {
    expect(podeRecarregarSozinho([agora - 1_000], agora)).toBe(false);
    expect(podeRecarregarSozinho([agora - (MS_ENTRE_RECARGAS - 1)], agora)).toBe(false);
  });

  it("passou um minuto: pode de novo (a próxima versão nova também se cura)", () => {
    expect(podeRecarregarSozinho([agora - MS_ENTRE_RECARGAS], agora)).toBe(true);
  });

  it("peça que falta DE VERDADE e quebra 61s depois de abrir: para na terceira", () => {
    // o achado da revisão: só a janela de 1 min recarregava a cada minuto,
    // para sempre, disfarçado de "atualizando"
    let recargas: number[] = [];
    let t = agora;
    let feitas = 0;
    for (let i = 0; i < 20; i++) {
      if (podeRecarregarSozinho(recargas, t)) {
        recargas = recargasComEsta(recargas, t);
        feitas++;
      }
      t += 61_000;
    }
    expect(feitas).toBe(MAX_RECARGAS_NA_JANELA);
  });

  it("passada a meia hora, a conta recomeça — tela aberta por dias segue se curando", () => {
    const antigas = [agora - 40 * min, agora - 39 * min, agora - 38 * min];
    expect(podeRecarregarSozinho(antigas, agora)).toBe(true);
    // e a lista gravada não carrega o que já saiu da janela
    expect(recargasComEsta(antigas, agora)).toEqual([agora]);
    expect(MS_JANELA_DE_RECARGAS).toBe(30 * min);
  });

  it("carimbo no futuro (relógio acertado para trás) é descartado — senão a aba nunca mais se curava", () => {
    // o iPhone que dormiu horas acerta o relógio ao acordar: tratar esse
    // carimbo como "agora" travava a recarga daquela aba para sempre
    expect(podeRecarregarSozinho([agora + 5_000], agora)).toBe(true);
    expect(recargasComEsta([agora + 5_000], agora)).toEqual([agora]);
    // e não abre brecha: com uma recarga de verdade há pouco, segue travado
    expect(podeRecarregarSozinho([agora + 5_000, agora - 1_000], agora)).toBe(false);
  });

  it("lista torta no armazenamento conta como 'nunca recarregou'", () => {
    expect(lerRecargas(null)).toEqual([]);
    expect(lerRecargas("abc")).toEqual([]);
    expect(lerRecargas('{"a":1}')).toEqual([]);
    expect(lerRecargas(`[${agora}, "x", null]`)).toEqual([agora]);
  });
});

describe("o caminho vai para o painel SEM os códigos de acesso", () => {
  it("todo parâmetro da rota vira o NOME dele — o código mora no caminho", () => {
    // /dados/<token> escreve na ficha da cliente; /ficha/<código> abre o RH;
    // /catalogo/<loja>/l/<código> é o link de atacado sorteado
    expect(caminhoSemCodigos("/dados/Xy12AbCdEfG", { token: "Xy12AbCdEfG" })).toBe("/dados/[token]");
    expect(caminhoSemCodigos("/ficha/Q9w8e7r6t5y", { codigo: "Q9w8e7r6t5y" })).toBe("/ficha/[codigo]");
    expect(
      caminhoSemCodigos("/catalogo/toque-leve/l/ATAC999", { slug: "toque-leve", code: "ATAC999" })
    ).toBe("/catalogo/[slug]/l/[code]");
    expect(caminhoSemCodigos("/pedidos/ckx1/romaneio", { id: "ckx1" })).toBe("/pedidos/[id]/romaneio");
  });

  it("parâmetro com acento ou espaço (codificado no endereço) também some", () => {
    expect(caminhoSemCodigos("/bio/moda%20ver%C3%A3o", { slug: "moda verão" })).toBe("/bio/[slug]");
  });

  it("rota pega-tudo ([...x]) troca cada pedaço", () => {
    expect(caminhoSemCodigos("/a/um/dois", { x: ["um", "dois"] })).toBe("/a/[x]/[x]");
  });

  it("rota sem parâmetro fica como está", () => {
    expect(caminhoSemCodigos("/whatsapp", {})).toBe("/whatsapp");
  });

  it("sem saber os parâmetros (o roteador caiu junto): só o primeiro pedaço", () => {
    expect(caminhoSemCodigos("/dados/Xy12AbCdEfG", null)).toBe("/dados/…");
    expect(caminhoSemCodigos("/whatsapp", null)).toBe("/whatsapp");
    expect(caminhoSemCodigos("/", null)).toBe("/");
  });

  it("e a busca e o '#' nunca entram", () => {
    expect(caminhoSemCodigos("/catalogo/x?c=SEGREDO#topo", { slug: "x" })).toBe("/catalogo/[slug]");
  });
});

describe("o relato que vai para o painel de Saúde", () => {
  const quando = new Date("2026-09-23T15:00:00.000Z");
  const EXTRA = { id: "rel-123456", recarregouSozinho: false };

  it("leva o id sorteado e se a recarga aconteceu", () => {
    const r = relatoDoErro(new Error("x"), "/x", quando, { id: "abc-12345", recarregouSozinho: true });
    expect(r.id).toBe("abc-12345");
    expect(r.recarregouSozinho).toBe(true);
  });

  it("só versão velha QUE RECARREGOU é o caso esperado — a barrada pela trava é quebra", () => {
    expect(relatoEsperado({ versaoVelha: true, recarregouSozinho: true })).toBe(true);
    // a peça faltando de verdade: a trava barrou, e escondê-la seria o pior
    expect(relatoEsperado({ versaoVelha: true, recarregouSozinho: false })).toBe(false);
    expect(relatoEsperado({ versaoVelha: false, recarregouSozinho: true })).toBe(false);
  });

  it("erro que veio do servidor (com digest) não é relatado de novo — lá já foi registrado", () => {
    expect(deveRelatar(Object.assign(new Error("x"), { digest: "123" }))).toBe(false);
    expect(deveRelatar(new Error("x"))).toBe(true);
    expect(deveRelatar(null)).toBe(true);
  });

  it("diz o nome e a mensagem do erro, e se foi versão velha", () => {
    const e = new TypeError("x.map is not a function");
    const r = relatoDoErro(e, "https://www.atacadopro.com/pedidos", quando, EXTRA);
    expect(r.mensagem).toBe("TypeError: x.map is not a function");
    expect(r.versaoVelha).toBe(false);
    expect(r.quando).toBe("2026-09-23T15:00:00.000Z");
  });

  it("o caminho vai SEM a busca e sem o '#' (a segunda tranca do servidor usa o mesmo)", () => {
    const r = relatoDoErro(new Error("x"), "https://www.atacadopro.com/catalogo/loja?ref=ana&c=SEGREDO#topo", quando, EXTRA);
    expect(r.caminho).toBe("/catalogo/loja");
    expect(r.caminho).not.toContain("SEGREDO");
    expect(soOCaminho("/whatsapp?conv=1")).toBe("/whatsapp");
    expect(soOCaminho("")).toBe("/");
  });

  it("relato guardado há mais de uma semana não viaja mais", () => {
    const agora = Date.parse("2026-09-23T15:00:00.000Z");
    expect(relatoAindaVale("2026-09-22T15:00:00.000Z", agora)).toBe(true);
    expect(relatoAindaVale(new Date(agora - MS_VALIDADE_DO_RELATO - 1).toISOString(), agora)).toBe(false);
    expect(relatoAindaVale("ontem", agora)).toBe(false);
    expect(relatoAindaVale(undefined, agora)).toBe(false);
  });

  it("o código do Next (digest) e a pilha entram no detalhe", () => {
    const e = Object.assign(new Error("quebrou"), { digest: "123456" });
    const r = relatoDoErro(e, "/x", quando, EXTRA);
    expect(r.detalhe).toContain("digest: 123456");
    expect(r.detalhe).toContain("quebrou");
  });

  it("tudo tem teto — é texto vindo do aparelho", () => {
    const e = new Error("m".repeat(5_000));
    e.stack = "s".repeat(50_000);
    const r = relatoDoErro(e, "/" + "p".repeat(5_000), quando, EXTRA);
    expect(r.mensagem.length).toBeLessThanOrEqual(TETO_MENSAGEM);
    expect(r.detalhe!.length).toBeLessThanOrEqual(TETO_DETALHE);
    expect(r.caminho.length).toBeLessThanOrEqual(TETO_CAMINHO);
  });

  it("erro sem forma de erro vira relato legível, sem quebrar o relator", () => {
    expect(relatoDoErro("texto solto", "/x", quando, EXTRA).mensagem).toBe("Erro: texto solto");
    expect(relatoDoErro(null, "/x", quando, EXTRA).mensagem).toBe("Erro: Erro sem mensagem");
    expect(relatoDoErro(null, "/x", quando, EXTRA).detalhe).toBeNull();
  });
});
