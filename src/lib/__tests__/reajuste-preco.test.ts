// Guarda RN-056
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { podeReajustarPreco } from "../scope";
import {
  aplicarReajuste,
  donoDoPreco,
  novoPreco,
  planejarReajuste,
  validarReajuste,
  type ProdutoParaReajuste,
} from "../reajuste-preco";

/**
 * BANCO FINGIDO para o `aplicarReajuste`: guarda o que a transação PEDE
 * (travar por loja + categoria) e o que ela GRAVA (por loja, com o número
 * recontado), sem descrever o texto do código — guarda de texto protege o
 * erro em vez de impedi-lo (incidente de 28/08/2026).
 */
type LinhaDoBanco = {
  id: string;
  companyId: string;
  category: string;
  name: string;
  wholesalePrice: number;
  retailPrice: number;
  nuvemshopId: string | null;
  jueriId: string | null;
};
const banco = new Map<string, LinhaDoBanco>();
const variantesNuvemshop = new Set<string>();
const consultas: { sql: string; values: unknown[] }[] = [];
const gravacoes: { sql: string; values: unknown[] }[] = [];
const eventos: { companyId: string; type: string; payload: string }[] = [];

const montar = (strings: TemplateStringsArray, values: unknown[]) => {
  // o mesmo montador do Prisma: aninhado vira texto + lista de valores
  const q = Prisma.sql(strings, ...values);
  return { sql: q.sql.replace(/\s+/g, " ").trim(), values: q.values };
};

vi.mock("../db", () => ({
  db: {
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const q = montar(strings, values);
          consultas.push(q);
          const [companyId, category] = q.values as [string, string];
          return [...banco.values()]
            .filter((l) => l.companyId === companyId && l.category === category)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ companyId: _c, category: _k, ...resto }) => resto);
        },
        productVariant: {
          async findMany({ where }: { where: { productId: { in: string[] } } }) {
            return where.productId.in
              .filter((id) => variantesNuvemshop.has(id))
              .map((productId) => ({ productId }));
          },
        },
        async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          const q = montar(strings, values);
          gravacoes.push(q);
          // aplica de verdade no banco fingido: pares (id, para) + companyId no fim
          const coluna = q.sql.includes('"wholesalePrice"') ? "wholesalePrice" : "retailPrice";
          const companyId = q.values[q.values.length - 1] as string;
          const pares = q.values.slice(0, -1);
          let n = 0;
          for (let i = 0; i < pares.length; i += 2) {
            const l = banco.get(pares[i] as string);
            if (l && l.companyId === companyId) {
              l[coluna] = pares[i + 1] as number;
              n++;
            }
          }
          return n;
        },
        commEvent: {
          async create({ data }: { data: { companyId: string; type: string; payload: string } }) {
            eventos.push(data);
            return data;
          },
        },
      };
      return fn(tx);
    },
  },
}));

/**
 * RN-056 · REAJUSTE DE PREÇO EM LOTE POR CATEGORIA (pedido do dono,
 * 15/09/2026). A conta é pura e conferível: centavos, nunca negativo,
 * percentual não inventa preço onde está zero, e quem vende fora manda no
 * preço dele (varejo da Nuvemshop, os dois do Jueri).
 */
const peca = (extra: Partial<ProdutoParaReajuste> = {}): ProdutoParaReajuste => ({
  id: "p1",
  name: "Blusa",
  wholesalePrice: 79.9,
  retailPrice: 129.9,
  nuvemshopId: null,
  jueriId: null,
  variants: [{ nuvemshopId: null }],
  ...extra,
});

describe("novoPreco: centavos, nunca negativo, zero não vira preço", () => {
  it("percentual arredonda a centavos", () => {
    expect(novoPreco(79.9, "percentual", 10)).toBe(87.89);
    expect(novoPreco(100, "percentual", -5)).toBe(95);
    expect(novoPreco(33.33, "percentual", 3)).toBe(34.33);
  });

  it("percentual sobre preço ZERO não muda nada (10% de nada é nada)", () => {
    expect(novoPreco(0, "percentual", 10)).toBeNull();
  });

  it("valor fixo vale para todos, inclusive quem estava sem preço", () => {
    expect(novoPreco(0, "fixo", 89.9)).toBe(89.9);
    expect(novoPreco(120, "fixo", 89.9)).toBe(89.9);
  });

  it("nunca negativo", () => {
    expect(novoPreco(10, "percentual", -90)).toBe(1);
    expect(novoPreco(10, "fixo", -5)).toBe(0);
  });
});

describe("validarReajuste: erro de digitação não vira preço", () => {
  it("percentual dentro de −90% e +500%; zero não muda nada", () => {
    expect(validarReajuste("percentual", 10)).toBeNull();
    expect(validarReajuste("percentual", 0)).toMatch(/zero/);
    expect(validarReajuste("percentual", -95)).toMatch(/entre/);
    expect(validarReajuste("percentual", 1000)).toMatch(/entre/);
  });

  it("fixo: não negativo, não absurdo, não NaN", () => {
    expect(validarReajuste("fixo", 89.9)).toBeNull();
    expect(validarReajuste("fixo", -1)).toMatch(/negativo/);
    expect(validarReajuste("fixo", 1_000_000)).toMatch(/alto/);
    expect(validarReajuste("fixo", NaN)).toMatch(/número/);
  });
});

describe("donoDoPreco: quem vende fora manda no preço dele", () => {
  it("peça nossa: os dois são nossos", () => {
    expect(donoDoPreco(peca())).toEqual({ atacado: null, varejo: null });
  });

  it("Nuvemshop (no produto ou em qualquer variação): o VAREJO é dela, o atacado é nosso", () => {
    expect(donoDoPreco(peca({ nuvemshopId: "9" }))).toEqual({ atacado: null, varejo: "NUVEMSHOP" });
    expect(donoDoPreco(peca({ variants: [{ nuvemshopId: null }, { nuvemshopId: "v2" }] }))).toEqual({
      atacado: null,
      varejo: "NUVEMSHOP",
    });
  });

  it("Jueri: os dois preços são de lá", () => {
    expect(donoDoPreco(peca({ jueriId: "j1" }))).toEqual({ atacado: "JUERI", varejo: "JUERI" });
  });
});

describe("planejarReajuste: o que muda, o que fica de fora e por quê", () => {
  it("atacado e varejo de peça nossa mudam; a prévia mostra antes e depois", () => {
    const { linhas, resumo } = planejarReajuste([peca()], ["atacado", "varejo"], "percentual", 10);
    expect(linhas[0].atacado).toEqual({ de: 79.9, para: 87.89 });
    expect(linhas[0].varejo).toEqual({ de: 129.9, para: 142.89 });
    expect(resumo).toEqual({ total: 1, alterados: 1, semPreco: 0, presos: { nuvemshop: 0, jueri: 0 } });
  });

  it("peça da Nuvemshop: atacado muda, varejo fica de fora com o motivo dito", () => {
    const { linhas, resumo } = planejarReajuste(
      [peca({ nuvemshopId: "9" })],
      ["atacado", "varejo"],
      "percentual",
      10
    );
    expect(linhas[0].atacado).toEqual({ de: 79.9, para: 87.89 });
    expect(linhas[0].varejo).toBeUndefined();
    expect(linhas[0].avisos).toEqual(["varejo: é da Nuvemshop, muda lá"]);
    expect(resumo.presos.nuvemshop).toBe(1);
    expect(resumo.alterados).toBe(1);
  });

  it("peça do Jueri: nada muda, os dois avisos aparecem, não conta como alterada", () => {
    const { linhas, resumo } = planejarReajuste(
      [peca({ jueriId: "j" })],
      ["atacado", "varejo"],
      "fixo",
      50
    );
    expect(linhas[0].atacado).toBeUndefined();
    expect(linhas[0].varejo).toBeUndefined();
    expect(linhas[0].avisos).toHaveLength(2);
    expect(resumo).toMatchObject({ alterados: 0, presos: { jueri: 2 } });
  });

  it("percentual em peça sem atacado: fica de fora e é CONTADA (não vira preço do nada)", () => {
    const { linhas, resumo } = planejarReajuste(
      [peca({ wholesalePrice: 0 })],
      ["atacado"],
      "percentual",
      10
    );
    expect(linhas[0].atacado).toBeUndefined();
    expect(linhas[0].avisos).toEqual(["atacado: sem preço cadastrado, fica de fora"]);
    expect(resumo.semPreco).toBe(1);
    expect(resumo.alterados).toBe(0);
  });

  it("valor fixo igual ao atual não conta como mudança", () => {
    const { linhas, resumo } = planejarReajuste([peca()], ["atacado"], "fixo", 79.9);
    expect(linhas[0].atacado).toBeUndefined();
    expect(resumo.alterados).toBe(0);
  });

  it("só os campos pedidos entram: pedir atacado não toca no varejo", () => {
    const { linhas } = planejarReajuste([peca()], ["atacado"], "percentual", 10);
    expect(linhas[0].varejo).toBeUndefined();
  });
});

describe("aplicarReajuste: trava por loja e categoria, reconta, grava por loja e registra", () => {
  const LOJA = "loja-a";
  const OUTRA = "loja-b";

  beforeEach(() => {
    banco.clear();
    variantesNuvemshop.clear();
    consultas.length = 0;
    gravacoes.length = 0;
    eventos.length = 0;
    const linha = (id: string, extra: Partial<LinhaDoBanco>): LinhaDoBanco => ({
      id,
      companyId: LOJA,
      category: "Blusas",
      name: id,
      wholesalePrice: 100,
      retailPrice: 200,
      nuvemshopId: null,
      jueriId: null,
      ...extra,
    });
    banco.set("nossa", linha("nossa", {}));
    banco.set("da-nuvemshop", linha("da-nuvemshop", { nuvemshopId: "ns-1" }));
    banco.set("do-jueri", linha("do-jueri", { jueriId: "j-1" }));
    banco.set("sem-atacado", linha("sem-atacado", { wholesalePrice: 0 }));
    banco.set("calca", linha("calca", { category: "Calças" }));
    banco.set("de-outra-loja", linha("de-outra-loja", { companyId: OUTRA }));
  });

  const pedido = { categoria: "Blusas", campos: ["atacado", "varejo"] as ("atacado" | "varejo")[], modo: "percentual" as const, valor: 10 };
  const quem = { id: "u1", name: "Gerente" };

  it("TRAVA só as peças da loja e da categoria pedidas (FOR UPDATE), e grava só nelas", async () => {
    const resumo = await aplicarReajuste(LOJA, pedido, quem);

    expect(consultas).toHaveLength(1);
    expect(consultas[0].sql).toMatch(/FOR UPDATE$/);
    expect(consultas[0].values).toEqual([LOJA, "Blusas"]);

    // toda gravação leva a loja como condição — nunca só o id (RN-013)
    for (const g of gravacoes) {
      expect(g.sql).toContain('p."companyId" =');
      expect(g.values[g.values.length - 1]).toBe(LOJA);
    }

    expect(banco.get("nossa")).toMatchObject({ wholesalePrice: 110, retailPrice: 220 });
    // varejo da Nuvemshop fica de fora; o atacado é nosso e muda
    expect(banco.get("da-nuvemshop")).toMatchObject({ wholesalePrice: 110, retailPrice: 200 });
    // Jueri manda nos dois
    expect(banco.get("do-jueri")).toMatchObject({ wholesalePrice: 100, retailPrice: 200 });
    // percentual não inventa preço onde está zero
    expect(banco.get("sem-atacado")).toMatchObject({ wholesalePrice: 0, retailPrice: 220 });
    // outra categoria e outra loja: intocadas
    expect(banco.get("calca")).toMatchObject({ wholesalePrice: 100, retailPrice: 200 });
    expect(banco.get("de-outra-loja")).toMatchObject({ wholesalePrice: 100, retailPrice: 200 });

    expect(resumo).toEqual({
      total: 4,
      alterados: 3,
      semPreco: 1,
      presos: { nuvemshop: 1, jueri: 2 },
    });
  });

  it("Nuvemshop vinculada só na VARIAÇÃO também tranca o varejo", async () => {
    variantesNuvemshop.add("nossa");
    await aplicarReajuste(LOJA, pedido, quem);
    expect(banco.get("nossa")).toMatchObject({ wholesalePrice: 110, retailPrice: 200 });
  });

  it("reconta com o número do BANCO na hora, não com a prévia (a ficha pode ter mudado)", async () => {
    banco.get("nossa")!.wholesalePrice = 50; // alguém salvou a ficha depois da prévia
    await aplicarReajuste(LOJA, pedido, quem);
    expect(banco.get("nossa")!.wholesalePrice).toBe(55);
  });

  it("deixa registro na Central com quem fez e o antes/depois de cada peça", async () => {
    await aplicarReajuste(LOJA, pedido, quem);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ companyId: LOJA, type: "produtos.reajuste-de-preco" });
    const payload = JSON.parse(eventos[0].payload);
    expect(payload.por).toEqual({ id: "u1", nome: "Gerente" });
    expect(payload.categoria).toBe("Blusas");
    expect(payload.mudancas).toHaveLength(3);
    expect(payload.mudancas.find((m: { id: string }) => m.id === "nossa")).toMatchObject({
      atacado: { de: 100, para: 110 },
      varejo: { de: 200, para: 220 },
    });
    expect(payload.mudancas.find((m: { id: string }) => m.id === "da-nuvemshop")).toMatchObject({
      atacado: { de: 100, para: 110 },
      varejo: null,
    });
  });

  it("categoria sem peça: nada grava, mas o registro fica (a pessoa clicou)", async () => {
    const resumo = await aplicarReajuste(LOJA, { ...pedido, categoria: "Vestidos" }, quem);
    expect(gravacoes).toHaveLength(0);
    expect(resumo.total).toBe(0);
    expect(eventos).toHaveLength(1);
  });
});

describe("a porta e a tela", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("gerência E suporte reajustam preço (decisão do dono, 15/09/2026); vendedora não", () => {
    const rota = ler("src/app/api/products/reajuste/route.ts");
    expect(rota).toContain("if (!podeReajustarPreco(user))");
    const papel = (role: string) =>
      podeReajustarPreco({ role } as Parameters<typeof podeReajustarPreco>[0]);
    expect(papel("ADMIN")).toBe(true);
    expect(papel("MANAGER")).toBe(true);
    expect(papel("SUPPORT")).toBe(true);
    expect(papel("SELLER")).toBe(false);
  });

  it("a tela nunca manda preço pronto: prévia e aplicar passam pela MESMA conta no servidor", () => {
    const rota = ler("src/app/api/products/reajuste/route.ts");
    expect(rota).toContain("preverReajuste(user.companyId");
    expect(rota).toContain("aplicarReajuste(user.companyId");
    // o corpo aceito é só categoria/campos/modo/valor/aplicar — sem lista de preços
    expect(rota).not.toMatch(/precos|linhas|para:/);
  });

  it("a tela só aplica DEPOIS da prévia, e só para gerência", () => {
    const tela = ler("src/app/(app)/produtos/reajuste-preco.tsx");
    expect(tela).toContain("Ver prévia");
    expect(tela).toMatch(/\{!feito && previa && \(/);
    const page = ler("src/app/(app)/produtos/page.tsx");
    expect(page).toContain("{podeReajustarPreco(user) && <ReajustePreco categories={categories} />}");
  });

  it("a ficha do produto TRANCA o preço de dono externo e não o manda ao servidor", () => {
    const tela = ler("src/app/(app)/produtos/products-view.tsx");
    expect(tela).toContain("disabled={!!product.precoDono.atacado}");
    expect(tela).toContain("disabled={!!product.precoDono.varejo}");
    expect(tela).toContain("product.precoDono.atacado ? undefined : num(form.wholesalePrice)");
    expect(tela).toContain("product.precoDono.varejo ? undefined : num(form.retailPrice)");
  });
});
