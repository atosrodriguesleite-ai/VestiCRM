import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  conferirVinculo,
  ehDisputaDeVerdade,
  ORDEM_DE_CONSERTO,
  recortarParaTela,
  resumir,
  type Achado,
  type Briga,
  type VariacaoAqui,
} from "../nuvemshop-conferencia";
import { mesmaCor, corDoNome, norm, skuParecidoNoCadastro, indiceDeSkusParecidos, pistaDoSku, type VariacaoNs } from "../nuvemshop";

// Guarda RN-014 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * CONFERÊNCIA DA INTEGRAÇÃO NUVEMSHOP — guarda do incidente da Toque Leve
 * (30/07/2026).
 *
 * A lojista duplicou SKU na Nuvemshop sem querer, corrigiu depois e criou uma
 * cor nova ("Café"). A cor nova foi criada DENTRO do produto "Baby Look —
 * Branco": o Branco ficou com 395 peças (soma de duas cores) e o catálogo
 * público passou a mostrar SEIS blusas com cinco produtos, uma delas com a
 * foto errada. O relatório do sync dizia "0 pendências" — porque contar quem
 * casou não é o mesmo que conferir se casou CERTO.
 */

const aqui = (p: Partial<VariacaoAqui> & { produto: string; cor: string }): VariacaoAqui => ({
  id: `${p.produto}-${p.cor}-${p.tamanho ?? "M"}`,
  tamanho: "M",
  sku: null,
  estoque: 0,
  nsVarId: null,
  ...p,
});

const la = (p: Partial<VariacaoNs> & { varId: string; produto: string }): VariacaoNs => ({
  prodId: "p1",
  cor: "Único",
  tamanho: "M",
  sku: null,
  estoque: 0,
  ...p,
});

describe("cor morando no produto errado (o caso real)", () => {
  it("acusa a cor nova criada dentro do produto de outra cor", () => {
    const achados = conferirVinculo(
      [
        aqui({ produto: "Baby Look — Branco", cor: "Branco", sku: "BABY-BRANCO", estoque: 197 }),
        aqui({ produto: "Baby Look — Branco", cor: "cafe", sku: "BABY-CAFE", estoque: 198 }),
      ],
      []
    );
    const achado = achados.find((a) => a.tipo === "COR_FORA_DO_PRODUTO");
    expect(achado).toBeDefined();
    expect(achado!.gravidade).toBe("ALTA");
    expect(achado!.peca).toContain("cafe");
    expect(achado!.detalhe).toContain("Baby Look — Branco");
  });

  it("junta os tamanhos num aviso só (não repete P, M e G)", () => {
    const achados = conferirVinculo(
      ["P", "M", "G"].map((t) =>
        aqui({ produto: "Baby Look — Branco", cor: "cafe", tamanho: t })
      ),
      []
    );
    expect(achados.filter((a) => a.tipo === "COR_FORA_DO_PRODUTO")).toHaveLength(1);
    expect(achados[0].detalhe).toContain("3 variação");
  });

  it("produto sem cor no nome nunca acusa (loja que agrupa cores é normal)", () => {
    const achados = conferirVinculo(
      [
        aqui({ produto: "Baby Look", cor: "Branco" }),
        aqui({ produto: "Baby Look", cor: "Café" }),
      ],
      []
    );
    expect(achados.filter((a) => a.tipo === "COR_FORA_DO_PRODUTO")).toHaveLength(0);
  });

  it("jeito de escrever não é cor diferente", () => {
    // acento, caixa e nome que contém o outro passam batido
    const achados = conferirVinculo(
      [
        aqui({ produto: "Baby Look — Café", cor: "cafe" }),
        aqui({ produto: "Vestido — Off White", cor: "White" }),
        aqui({ produto: "Saia — Preto", cor: "Único" }),
      ],
      []
    );
    expect(achados.filter((a) => a.tipo === "COR_FORA_DO_PRODUTO")).toHaveLength(0);
  });
});

describe("SKU duplicado", () => {
  it("acusa SKU repetido AQUI (uma das duas fica com estoque congelado)", () => {
    const achados = conferirVinculo(
      [
        aqui({ produto: "Baby Look — Branco", cor: "Branco", sku: "BABY-1" }),
        aqui({ produto: "Baby Look — Preto", cor: "Preto", sku: "baby-1" }),
      ],
      []
    );
    const a = achados.find((x) => x.tipo === "SKU_DUPLICADO_AQUI");
    expect(a).toBeDefined();
    expect(a!.gravidade).toBe("ALTA");
    expect(a!.peca).toContain("SKU BABY-1");
  });

  it("acusa SKU repetido LÁ (duas peças brigando pela mesma daqui)", () => {
    const achados = conferirVinculo(
      [],
      [
        la({ varId: "1", produto: "Baby Look", cor: "Branco", sku: "BABY-1" }),
        la({ varId: "2", produto: "Baby Look", cor: "Café", sku: "BABY-1" }),
      ]
    );
    expect(achados.some((x) => x.tipo === "SKU_DUPLICADO_LA")).toBe(true);
  });

  it("o MESMO SKU repetido dos dois lados é UM aviso, não dois", () => {
    // era o que inflava a lista: 12 SKUs repetidos viravam 24 linhas
    const achados = conferirVinculo(
      [
        aqui({ produto: "Regata Quadrada", cor: "Terracota", tamanho: "G", sku: "RQD-TER-G" }),
        aqui({ produto: "Regata Quadrada", cor: "Terracota", tamanho: "GG", sku: "RQD-TER-G" }),
      ],
      [
        la({ varId: "1", produto: "Regata Quadrada", cor: "Terracota", tamanho: "G", sku: "RQD-TER-G" }),
        la({ varId: "2", produto: "Regata Quadrada", cor: "Terracota", tamanho: "GG", sku: "RQD-TER-G" }),
      ]
    );
    const doSku = achados.filter((x) => x.tipo.startsWith("SKU_DUPLICADO"));
    expect(doSku).toHaveLength(1);
    expect(doSku[0].tipo).toBe("SKU_DUPLICADO_NOS_DOIS");
    // e diz o que fazer primeiro: a Nuvemshop
    expect(doSku[0].detalhe).toContain("primeiro na Nuvemshop");
  });

  it("SKU vazio não conta como duplicado", () => {
    const achados = conferirVinculo(
      [
        aqui({ produto: "A", cor: "Branco", sku: null }),
        aqui({ produto: "B", cor: "Preto", sku: "" }),
      ],
      []
    );
    expect(achados.filter((x) => x.tipo === "SKU_DUPLICADO_AQUI")).toHaveLength(0);
  });
});

describe("vínculo (o carimbo) contra o SKU", () => {
  it("acusa quando o vínculo aponta pra uma peça com SKU diferente", () => {
    const achados = conferirVinculo(
      [aqui({ produto: "Baby Look — Branco", cor: "Branco", sku: "BABY-BRANCO", nsVarId: "9", estoque: 197 })],
      [la({ varId: "9", produto: "Baby Look", cor: "Café", sku: "BABY-CAFE", estoque: 198 })]
    );
    const a = achados.find((x) => x.tipo === "CARIMBO_CRUZADO");
    expect(a).toBeDefined();
    expect(a!.gravidade).toBe("ALTA");
    expect(a!.estoqueAqui).toBe(197);
    expect(a!.estoqueLa).toBe(198);
    expect(a!.detalhe).toContain("peça errada");
  });

  it("acusa vínculo órfão (peça apagada na Nuvemshop)", () => {
    const achados = conferirVinculo(
      [aqui({ produto: "Baby Look — Branco", cor: "Branco", sku: "X", nsVarId: "sumiu" })],
      []
    );
    expect(achados.some((x) => x.tipo === "CARIMBO_ORFAO")).toBe(true);
  });

  it("vínculo saudável com estoque igual não acusa nada", () => {
    const achados = conferirVinculo(
      [aqui({ produto: "Baby Look — Branco", cor: "Branco", sku: "BABY-BRANCO", nsVarId: "9", estoque: 197 })],
      [la({ varId: "9", produto: "Baby Look", cor: "Branco", sku: "BABY-BRANCO", estoque: 197 })]
    );
    expect(achados).toHaveLength(0);
  });

  it("estoque diferente com vínculo certo é aviso, não erro grave", () => {
    const achados = conferirVinculo(
      [aqui({ produto: "Baby Look — Branco", cor: "Branco", sku: "S1", nsVarId: "9", estoque: 190 })],
      [la({ varId: "9", produto: "Baby Look", cor: "Branco", sku: "S1", estoque: 197 })]
    );
    const a = achados.find((x) => x.tipo === "ESTOQUE_DIFERENTE");
    expect(a?.gravidade).toBe("MEDIA");
  });
});

describe("briga de sincronização (a impressão digital)", () => {
  const briga = (over: Partial<Briga> & { variantId: string }): Briga => ({
    quando: new Date("2026-07-30T12:44:00Z"),
    rodadas: 1,
    historico: ["(197 → 3)", "(3 → 198)"],
    ...over,
  });

  it("mostra a peça e o histórico dos ajustes do mesmo minuto", () => {
    const v = aqui({ produto: "Baby Look — Branco", cor: "Branco", sku: "DUP", estoque: 395 });
    const achados = conferirVinculo(
      [v],
      // o SKU repetido LÁ é a causa viva da disputa
      [la({ varId: "1", produto: "Baby Look", sku: "DUP" }), la({ varId: "2", produto: "Baby Look", sku: "DUP" })],
      [briga({ variantId: v.id })]
    );
    const a = achados.find((x) => x.tipo === "BRIGA_DE_SYNC");
    expect(a).toBeDefined();
    expect(a!.gravidade).toBe("ALTA");
    expect(a!.peca).toContain("Baby Look");
    expect(a!.detalhe).toContain("197 → 3");
  });

  /**
   * O caso Entre Linhas (19/08/2026): a disputa se repete em TODA
   * sincronização enquanto o SKU estiver duplicado. Contando cada repetição,
   * meia dúzia de peças viraram 564 avisos — e empurraram para fora da tela
   * os achados do fim da fila.
   */
  it("peça disputada em 300 sincronizações vira UM aviso, não 300", () => {
    const v = aqui({ produto: "Regata tule", cor: "Lilás" });
    const achados = conferirVinculo([v], [], [
      briga({ variantId: v.id, rodadas: 300 }),
    ]);
    const brigas = achados.filter((x) => x.tipo === "BRIGA_DE_SYNC");
    expect(brigas).toHaveLength(1);
    expect(brigas[0].detalhe).toContain("300 sincronizações");
  });

  /**
   * SKU já corrigido: a disputa continua no livro de estoque para sempre, mas
   * não pode continuar gritando VERMELHO — senão a lojista conserta tudo e o
   * painel nunca fica limpo.
   */
  it("SKU já corrigido: a disputa vira histórico, não alarme", () => {
    const v = aqui({ produto: "Regata tule", cor: "Lilás", sku: "UNICO" });
    const achados = conferirVinculo(
      [v],
      [la({ varId: "1", produto: "Regata tule", sku: "UNICO" })], // sem repetição hoje
      [briga({ variantId: v.id })]
    );
    const a = achados.find((x) => x.tipo === "BRIGA_DE_SYNC");
    expect(a!.gravidade).toBe("MEDIA");
    expect(a!.detalhe).toContain("histórico");
  });

  /** Achado da revisão: a peça de lá apontada pelo carimbo pode estar SEM
   *  SKU, enquanto outra peça de lá carrega o SKU daqui — as duas escrevem
   *  na mesma variação e a disputa segue viva, sem SKU repetido nenhum. */
  it("carimbo numa peça e SKU em outra: disputa VIVA mesmo sem SKU repetido", () => {
    const v = aqui({ produto: "Regata tule", cor: "Lilás", sku: "S1", nsVarId: "9" });
    const achados = conferirVinculo(
      [v],
      [
        la({ varId: "9", produto: "Regata tule", sku: null }), // carimbo, sem SKU
        la({ varId: "7", produto: "Regata tule", sku: "S1" }), // o SKU leva a OUTRA
      ],
      [briga({ variantId: v.id })]
    );
    expect(achados.find((x) => x.tipo === "BRIGA_DE_SYNC")!.gravidade).toBe("ALTA");
  });

  it("vínculo apontando pra peça errada também mantém a disputa VIVA", () => {
    const v = aqui({ produto: "Regata tule", cor: "Lilás", sku: "AQUI", nsVarId: "9" });
    const achados = conferirVinculo(
      [v],
      [la({ varId: "9", produto: "Regata tule", sku: "OUTRO" })], // carimbo cruzado
      [briga({ variantId: v.id })]
    );
    expect(achados.find((x) => x.tipo === "BRIGA_DE_SYNC")!.gravidade).toBe("ALTA");
  });
});

/**
 * O 156 da Entre Linhas: metade do catálogo "disputado" sem nada de errado.
 * Era sincronização rodada duas vezes ao mesmo tempo gravando o MESMO número.
 */
describe("disputa de verdade × sincronização repetida", () => {
  it("dois ajustes parando em números DIFERENTES é disputa", () => {
    expect(ehDisputaDeVerdade(["(197 → 3)", "(3 → 198)"])).toBe(true);
  });

  it("o MESMO número gravado duas vezes NÃO é disputa (a peça terminou certa)", () => {
    expect(ehDisputaDeVerdade(["(197 → 3)", "(197 → 3)"])).toBe(false);
  });

  it("um ajuste sozinho nunca é disputa", () => {
    expect(ehDisputaDeVerdade(["(197 → 3)"])).toBe(false);
  });

  it("formato antigo, sem os números: continua avisando (na dúvida, avisa)", () => {
    expect(ehDisputaDeVerdade(["ajuste", "ajuste"])).toBe(true);
  });
});

describe("o que cabe na tela (nenhuma categoria some em silêncio)", () => {
  const achado = (tipo: Achado["tipo"], i: number): Achado => ({
    tipo,
    gravidade: "ALTA",
    peca: `peça ${i}`,
    detalhe: "…",
  });

  it("categoria barulhenta não empurra as outras para fora da lista", () => {
    const achados: Achado[] = [
      ...Array.from({ length: 400 }, (_, i) => achado("BRIGA_DE_SYNC", i)),
      ...Array.from({ length: 11 }, (_, i) => achado("CARIMBO_ORFAO", i)),
    ];
    const { mostrados, omitidos } = recortarParaTela(achados);
    // os 11 órfãos CHEGAM na tela (antes o teto global comia todos)
    expect(mostrados.filter((a) => a.tipo === "CARIMBO_ORFAO")).toHaveLength(11);
    // e o que sobrou é contado, nunca sumido
    expect(omitidos).toBe(370);
    expect(mostrados.length + omitidos).toBe(achados.length);
  });

  /** Achado da revisão: com 8 categorias cheias, um teto global de 200 zerava
   *  a última da fila ("estoque não bate") — o mesmo sintoma, de novo. */
  it("TODAS as categorias aparecem, mesmo com todas cheias", () => {
    const achados: Achado[] = ORDEM_DE_CONSERTO.flatMap((tipo) =>
      Array.from({ length: 60 }, (_, i) => achado(tipo, i))
    );
    const { mostrados, omitidos } = recortarParaTela(achados);
    for (const tipo of ORDEM_DE_CONSERTO) {
      expect(mostrados.filter((a) => a.tipo === tipo).length).toBe(30);
    }
    expect(mostrados.length + omitidos).toBe(achados.length);
  });
});

describe("ordem e limpeza", () => {
  it("a lista sai NA ORDEM DE CONSERTAR (SKU da Nuvemshop primeiro)", () => {
    const achados = conferirVinculo(
      [
        // estoque diferente (último da fila)
        aqui({ produto: "A", cor: "Branco", sku: "S1", nsVarId: "1", estoque: 5 }),
        // cor no produto errado (meio da fila)
        aqui({ produto: "B — Preto", cor: "Verde", sku: "S2" }),
      ],
      [
        la({ varId: "1", produto: "A", cor: "Branco", sku: "S1", estoque: 9 }),
        // SKU repetido na Nuvemshop (tem que vir primeiro de todos)
        la({ varId: "7", produto: "C", cor: "Rosa", sku: "DUP" }),
        la({ varId: "8", produto: "C", cor: "Azul", sku: "DUP" }),
      ]
    );
    expect(achados.map((a) => a.tipo)).toEqual([
      "SKU_DUPLICADO_LA",
      "COR_FORA_DO_PRODUTO",
      "ESTOQUE_DIFERENTE",
    ]);
  });

  it("o resumo conta por tipo, na mesma ordem", () => {
    const achados = conferirVinculo(
      [
        aqui({ produto: "B — Preto", cor: "Verde", sku: "S2" }),
        aqui({ produto: "C — Azul", cor: "Rosa", sku: "S3" }),
      ],
      [
        la({ varId: "7", produto: "C", cor: "Rosa", sku: "DUP" }),
        la({ varId: "8", produto: "C", cor: "Azul", sku: "DUP" }),
      ]
    );
    expect(resumir(achados)).toEqual([
      { tipo: "SKU_DUPLICADO_LA", nome: "SKU repetido na Nuvemshop", quantos: 1 },
      { tipo: "COR_FORA_DO_PRODUTO", nome: "Cor no produto errado", quantos: 2 },
    ]);
  });

  it("loja saudável devolve lista vazia (a tela mostra o verde)", () => {
    expect(conferirVinculo([], [])).toEqual([]);
  });
});

describe("a trava na sincronização", () => {
  const fonte = readFileSync(join(process.cwd(), "src/lib/nuvemshop.ts"), "utf8");

  it("cor nova em produto que declara cor NÃO é criada — vira pendência", () => {
    expect(fonte).toContain("TRAVA DA COR");
    expect(fonte).toContain("corDoProduto && !mesmaCor(color, corDoProduto)");
    // a trava tem que ficar ANTES da criação da variação
    expect(fonte.indexOf("TRAVA DA COR")).toBeLessThan(
      fonte.indexOf("const nova = await db.productVariant.create")
    );
  });

  it("a comparação de cor é a mesma nos dois lugares (sync e conferência)", () => {
    expect(mesmaCor("cafe", "Café")).toBe(true);
    expect(mesmaCor("Único", "Branco")).toBe(true);
    expect(mesmaCor("Branco", "cafe")).toBe(false);
    expect(corDoNome("Baby Look — Branco")).toBe("Branco");
    expect(corDoNome("Baby Look")).toBeNull();
  });
});

describe("a conferência não pode alterar nada", () => {
  const fonte = readFileSync(join(process.cwd(), "src/lib/nuvemshop-conferencia.ts"), "utf8");

  it("nenhuma escrita no banco no arquivo da conferência", () => {
    for (const proibido of ["update(", "updateMany", "create(", "createMany", "delete(", "deleteMany", "upsert("]) {
      expect(fonte).not.toContain(`db.productVariant.${proibido}`);
      expect(fonte).not.toContain(`db.product.${proibido}`);
      expect(fonte).not.toContain(`db.inventoryMovement.${proibido}`);
    }
  });

  it("a rota é GET (não tem POST que mexa em nada)", () => {
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/nuvemshop/conferir/route.ts"),
      "utf8"
    );
    expect(rota).toContain("export async function GET");
    expect(rota).not.toContain("export async function POST");
    expect(rota).toContain("isAdmin(user)");
  });
});

describe("SKU digitado à mão não pode travar o estoque (relato da loja, 31/08/2026)", () => {
  // A lojista cadastrou "359003402Rosa Chá" nos dois sistemas e o estoque não
  // puxava. Acento e caixa o casamento já resolvia; o que escapava era o
  // ESPAÇO — o dobrado sem querer e o invisível que vem colado da planilha.
  it("acento, caixa e espaço nas pontas continuam casando", () => {
    expect(norm("359003402Rosa Chá")).toBe(norm("359003402rosa cha"));
    expect(norm("  359003402Rosa Chá  ")).toBe(norm("359003402Rosa Chá"));
    // ç/á gravados decompostos (copiar e colar entre sistemas) também
    expect(norm("359003402Rosa Chá".normalize("NFD"))).toBe(norm("359003402Rosa Chá"));
  });

  it("espaço DUPLO no meio agora casa (era o que travava em silêncio)", () => {
    expect(norm("359003402Rosa  Chá")).toBe(norm("359003402Rosa Chá"));
  });

  it("espaço INVISÍVEL (nbsp, zero-width) também casa — inclusive NO MEIO", () => {
    expect(norm("359003402Rosa\u00a0Chá")).toBe(norm("359003402Rosa Chá"));
    expect(norm("359003402Rosa Chá\u200b")).toBe(norm("359003402Rosa Chá"));
    // largura zero SOME (não vira espaço): na ponta o trim escondia o defeito
    expect(norm("359003402Rosa\u200bCha")).toBe(norm("359003402RosaCha"));
    expect(norm("359003402\ufeffRosaCha")).toBe(norm("359003402RosaCha"));
  });

  it("SKU de VERDADE diferente continua NÃO casando (a régua não afrouxou)", () => {
    // se afrouxasse aqui, o estoque de uma cor cairia em outra — o incidente
    // da Toque Leve que a RN-014 existe para impedir
    expect(norm("359003402Rosa Chá")).not.toBe(norm("359003402Rosa Chá único"));
    expect(norm("359003402Preto")).not.toBe(norm("359003402Prata"));
  });
});

describe("a pendência EXPLICA por que não casou (o quase-igual do cadastro)", () => {
  const pool = [
    { sku: "359003402-Rosa-Cha" },
    { sku: "359003402Preto" },
    { sku: null },
  ];

  it("acha o SKU quase igual (só a pontuação difere) para a lojista comparar", () => {
    expect(skuParecidoNoCadastro("359003402 Rosa Cha", pool)).toBe("359003402-Rosa-Cha");
  });

  it("SKU IGUAL também responde — a função só é consultada quando NÃO casou", () => {
    // é o caso do SKU repetido: o casamento automático já o descartou, então
    // "igual" aqui significa "existe no cadastro e mesmo assim não casou".
    // Devolver null escondia justamente o caso mais óbvio (revisão 31/08).
    expect(skuParecidoNoCadastro("359003402Preto", pool)).toBe("359003402Preto");
  });

  it("o índice é montado UMA vez e responde igual à busca direta", () => {
    const idx = indiceDeSkusParecidos(pool);
    expect(skuParecidoNoCadastro("359003402 Rosa Cha", idx)).toBe("359003402-Rosa-Cha");
    expect(skuParecidoNoCadastro("999999Verde", idx)).toBeNull();
  });

  it("sem nada perto, não inventa sugestão", () => {
    expect(skuParecidoNoCadastro("999999Verde", pool)).toBeNull();
    expect(skuParecidoNoCadastro(null, pool)).toBeNull();
    expect(skuParecidoNoCadastro("   ", pool)).toBeNull();
  });

  // A DECISÃO em si (criar espelho × virar pendência) é comportamento, não
  // texto: descrever a LINHA do código protegeria o erro em vez de impedi-lo
  // (lição de 28/08/2026). Aqui vale a regra pura que a decisão consulta.
  it("SKU quase igual acusa (é o que impede o produto duplicado)", () => {
    for (const skuNs of [
      "359003402 Rosa Cha",   // espaço no lugar do hífen
      "359003402.Rosa.Cha",   // pontuação trocada
      "359003402RosaCha",     // sem separador nenhum
    ])
      expect(skuParecidoNoCadastro(skuNs, pool), skuNs).toBe("359003402-Rosa-Cha");
  });

  it("SKU REPETIDO no cadastro também acusa (não vira espelho em silêncio)", () => {
    // a trava de ambiguidade (Toque Leve) tira SKU repetido do casamento;
    // sem acusar aqui, a peça virava produto novo sem nenhum aviso
    const comRepetido = [{ sku: "359003402Preto" }, { sku: "359003402Preto" }];
    expect(skuParecidoNoCadastro("359003402Preto", comRepetido)).toBe("359003402Preto");
  });

  it("produto GENUINAMENTE novo (sem nada parecido) continua entrando sozinho", () => {
    // a trava é só para o quase-igual: loja que cadastra a peça só na
    // Nuvemshop precisa vê-la chegar no catálogo sem trabalho manual
    expect(skuParecidoNoCadastro("SKU-QUE-NAO-EXISTE-99", pool)).toBeNull();
  });

  it("a PRÉVIA usa a mesma régua do import (prévia que engana é pior que nenhuma)", () => {
    const previa = readFileSync(join(process.cwd(), "src/lib/nuvemshop-simulacao.ts"), "utf8");
    expect(previa).toContain("skuParecidoNoCadastro");
    expect(previa).toContain("idxParecidos");
  });

  it("o total de pendências é o VERDADEIRO (a lista guardada para em 100)", () => {
    const motor = readFileSync(join(process.cwd(), "src/lib/nuvemshop.ts"), "utf8");
    expect(motor).toContain("totalPendencias: report.pendencias.length");
    const tela = readFileSync(
      join(process.cwd(), "src/app/(app)/configuracoes/nuvemshop-connect.tsx"),
      "utf8"
    );
    expect(tela).toContain("estado.report.totalPendencias ??");
  });

  it("variação SEM SKU não sai marcada como 'repetido' (o vazio não é igual a nada)", () => {
    // "" === "" dava true e carimbava repetido em toda pendência sem SKU
    for (const vazio of [null, undefined, "   "]) {
      const r = pistaDoSku(vazio, pool);
      expect(r.repetido, String(vazio)).toBe(false);
      expect(r.skuParecido).toBeNull();
      expect(r.sku).toBeNull();
    }
  });

  it("a pista diz de QUAL peça é o SKU parecido (senão o conselho vira erro)", () => {
    // igualar com o SKU de OUTRA peça criaria SKU duplicado — e SKU duplicado
    // sai do casamento automático, quebrando também a que funcionava
    const comNome = [{ sku: "359003402-Rosa-Cha", product: { name: "Conjunto Samira" } }];
    expect(skuParecidoNoCadastro("359003402 Rosa Cha", comNome)).toBe(
      '359003402-Rosa-Cha (em “Conjunto Samira”)'
    );
    // o rótulo não confunde a conta do "repetido": ela olha o SKU puro
    expect(pistaDoSku("359003402-Rosa-Cha", comNome).repetido).toBe(true);
  });

  it("sem relatório em curso (webhook), a pendência é gravada mesmo assim", () => {
    // o produto barrado não é criado — se também não fosse anotado, sumia em
    // silêncio até alguém clicar em sincronizar
    const motor = readFileSync(join(process.cwd(), "src/lib/nuvemshop.ts"), "utf8");
    expect(motor).toContain("registrarPendenciasAvulsas");
    expect(motor).toContain("else await registrarPendenciasAvulsas(companyId, pendencias);");
  });

  it("a PRÉVIA aplica a mesma trava de SKU repetido do import", () => {
    const previa = readFileSync(join(process.cwd(), "src/lib/nuvemshop-simulacao.ts"), "utf8");
    expect(previa).toContain("vezesPorSku.get(norm(v.sku)) === 1");
  });

  it("a tela mostra a comparação (senão o achado morre no servidor)", () => {
    const tela = readFileSync(
      join(process.cwd(), "src/app/(app)/configuracoes/nuvemshop-connect.tsx"),
      "utf8"
    );
    expect(tela).toContain("p.skuParecido");
    expect(tela).toContain("no seu cadastro existe");
  });
});
