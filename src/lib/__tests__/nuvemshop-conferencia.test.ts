import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { conferirVinculo, resumir, type VariacaoAqui } from "../nuvemshop-conferencia";
import { mesmaCor, corDoNome, type VariacaoNs } from "../nuvemshop";

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
  it("mostra a peça e o histórico dos ajustes do mesmo minuto", () => {
    const v = aqui({ produto: "Baby Look — Branco", cor: "Branco", estoque: 395 });
    const achados = conferirVinculo([v], [], [
      { variantId: v.id, quando: new Date("2026-07-30T12:44:00Z"), quantos: 2, historico: ["(197 → 3)", "(3 → 198)"] },
    ]);
    const a = achados.find((x) => x.tipo === "BRIGA_DE_SYNC");
    expect(a).toBeDefined();
    expect(a!.gravidade).toBe("ALTA");
    expect(a!.peca).toContain("Baby Look");
    expect(a!.detalhe).toContain("197 → 3");
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
