// Guarda RN-076
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import {
  aProduzir,
  origemDaEncomenda,
  pecaVinculada,
  variacoesSobEncomenda,
  vendeSobEncomenda,
} from "../sob-encomenda";
import { reservarComExtras, reservarEstoque, reservarOQueTiver } from "../reservations";
import { extrasPrevistos } from "../pedido-extras";
import { disponivelNaVitrine, TETO_POR_LINHA } from "../catalogo/teto-do-estoque";
import { ondeNaoEscondePorEstoque } from "../catalogo/sob-encomenda-na-vitrine";
import { chegouAoMinimo, passaNoFiltro, resumirLinhas, type LinhaDoInventario } from "../estoque/inventario";
import { decidirAlertas } from "../estoque/alerta";
import { analisarPeca } from "../estoque/analise";
import { ehListaDeProducao, faltaParaOMinimo } from "../estoque/contagem";
import { pecasAcimaDoEstoque, repetirNaLinha, somarOQueOPedidoSegura, tetoDaVariacao, TETO_COM_EXTRA } from "../pedido-grade";
import { montarGaleria } from "../fotos/regra";

/**
 * RN-076 — VENDE SOB ENCOMENDA: a chavinha (categoria e peça) deixa a peça
 * vender além do estoque, que fica NEGATIVO ("−3" = 3 a produzir).
 *
 * Pedido do dono (09/10/2026): *"tenho clientes de confecção — às vezes não
 * tem pronto, mas pode produzir; uma chavinha por produto ou categoria para
 * vender infinitamente, mesmo que o estoque fique negativo; nasce desligada".*
 *
 * O caminho inteiro (rotas de verdade, banco de verdade: catálogo, Novo
 * pedido, edição, cancelamento, produção) é provado por
 * `scripts/e2e-sob-encomenda.ts`.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("a escada: peça > categoria, e a peça vinculada nunca", () => {
  it("nasce desligada: sem chavinha em lugar nenhum, não vende sob encomenda", () => {
    expect(vendeSobEncomenda({ peca: null, categoria: false })).toBe(false);
    expect(origemDaEncomenda({ peca: null, categoria: false })).toBeNull();
  });

  it("a categoria liga a peça que segue a categoria", () => {
    expect(origemDaEncomenda({ peca: null, categoria: true })).toBe("CATEGORIA");
    expect(origemDaEncomenda({ peca: undefined, categoria: true })).toBe("CATEGORIA");
  });

  it("a peça manda mais que a categoria, nos dois sentidos", () => {
    expect(origemDaEncomenda({ peca: true, categoria: false })).toBe("PECA");
    // "liga em Conjuntos e desliga só no kit que não se produz"
    expect(origemDaEncomenda({ peca: false, categoria: true })).toBeNull();
  });

  it("peça da Nuvemshop (vínculo na VARIAÇÃO) ou do Jueri (no produto) nunca vende sob encomenda", () => {
    expect(pecaVinculada({ nuvemshopId: "9", jueriId: null })).toBe(true);
    expect(pecaVinculada({ nuvemshopId: null, jueriId: "7" })).toBe(true);
    expect(vendeSobEncomenda({ peca: true, categoria: true, nuvemshopId: "9" })).toBe(false);
    expect(vendeSobEncomenda({ peca: true, categoria: true, jueriId: "7" })).toBe(false);
  });

  it("o conjunto de variações livres sai da MESMA escada, por variação", () => {
    const livres = variacoesSobEncomenda(
      [
        { id: "a", nuvemshopId: null, product: { sobEncomenda: null, category: "Conjuntos", jueriId: null } },
        { id: "b", nuvemshopId: "ns", product: { sobEncomenda: null, category: "Conjuntos", jueriId: null } },
        { id: "c", nuvemshopId: null, product: { sobEncomenda: false, category: "Conjuntos", jueriId: null } },
        { id: "d", nuvemshopId: null, product: { sobEncomenda: true, category: "Regatas", jueriId: null } },
        { id: "e", nuvemshopId: null, product: { sobEncomenda: null, category: "Regatas", jueriId: null } },
      ],
      new Set(["Conjuntos"])
    );
    expect([...livres].sort()).toEqual(["a", "d"]);
  });

  it("'a produzir' é o negativo, nunca o zero", () => {
    expect(aProduzir(-3)).toBe(3);
    expect(aProduzir(0)).toBe(0);
    expect(aProduzir(5)).toBe(0);
  });
});

/** Banco de mentira com o comportamento do Postgres: condicional, salvo a peça LIVRE. */
function bancoFake(estoque: Record<string, number>) {
  return {
    productVariant: {
      async updateMany({ where, data }: { where: { id: string; stock?: { gte: number } }; data: { stock: { decrement: number } } }) {
        const atual = estoque[where.id] ?? 0;
        if (where.stock && atual < where.stock.gte) return { count: 0 };
        estoque[where.id] = atual - data.stock.decrement;
        return { count: 1 };
      },
      async findUnique({ where }: { where: { id: string } }) {
        return { stock: estoque[where.id] ?? 0 };
      },
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        return where.id.in.map((id) => ({ id, stock: estoque[id] ?? 0 }));
      },
    },
    async $queryRaw(sql: Prisma.Sql) {
      const v = sql.values as (string | number | boolean)[];
      const ok: { id: string }[] = [];
      for (let i = 0; i < v.length; i += 3) {
        const id = String(v[i]);
        const q = Number(v[i + 1]);
        const livre = v[i + 2] === true;
        if (livre || (estoque[id] ?? 0) >= q) {
          estoque[id] = (estoque[id] ?? 0) - q;
          ok.push({ id });
        }
      }
      return ok;
    },
  };
}

describe("a reserva: a peça livre baixa sem condição e fica negativa; as outras seguem a RN-003", () => {
  it("lote: a livre sai inteira mesmo sem estoque; a presa falta como sempre", async () => {
    const estoque = { livre: 1, presa: 1 };
    const faltas = await reservarEstoque(
      bancoFake(estoque) as never,
      [
        { variantId: "livre", quantity: 4, label: "Conjunto (Preto M)" },
        { variantId: "presa", quantity: 4, label: "Regata (Preto M)" },
      ],
      new Set(["livre"])
    );
    expect(estoque).toEqual({ livre: -3, presa: 1 });
    expect(faltas.map((f) => f.variantId)).toEqual(["presa"]);
  });

  it("a baixa unitária (catálogo, Pix, edição) idem", async () => {
    const estoque = { livre: 0, presa: 0 };
    const r = await reservarOQueTiver(
      bancoFake(estoque) as never,
      [
        { variantId: "livre", quantity: 2, label: "Conjunto" },
        { variantId: "presa", quantity: 2, label: "Regata" },
      ],
      new Set(["livre"])
    );
    expect(estoque).toEqual({ livre: -2, presa: 0 });
    expect(r.seguradas).toEqual([{ variantId: "livre", quantity: 2 }]);
    expect(r.faltas.map((f) => f.variantId)).toEqual(["presa"]);
  });

  it("com extras (RN-075): a livre nunca vira extra — o livro guarda a quantidade inteira", async () => {
    const estoque = { livre: 1, presa: 1 };
    const r = await reservarComExtras(
      bancoFake(estoque) as never,
      [
        { variantId: "livre", quantity: 5, label: "Conjunto" },
        { variantId: "presa", quantity: 5, label: "Regata" },
      ],
      new Set(["livre"])
    );
    expect(estoque).toEqual({ livre: -4, presa: 0 });
    expect(r.seguradas).toEqual([
      { variantId: "livre", quantity: 5 },
      { variantId: "presa", quantity: 1 },
    ]);
    expect(r.extras.map((e) => e.variantId)).toEqual(["presa"]);
  });

  it("sem conjunto de livres, nada muda: nunca negativo", async () => {
    const estoque = { a: 1 };
    await reservarEstoque(bancoFake(estoque) as never, [{ variantId: "a", quantity: 4, label: "x" }]);
    expect(estoque.a).toBe(1);
  });

  it("a conferência de extras pula a peça livre (não pergunta 'estou ciente' por ela)", () => {
    const previstos = extrasPrevistos(
      [
        { variantId: "livre", label: "Conjunto", precisa: 5 },
        { variantId: "presa", label: "Regata", precisa: 5 },
      ],
      new Map([
        ["livre", 0],
        ["presa", 2],
      ]),
      new Set(["livre"])
    );
    expect(previstos.map((p) => p.variantId)).toEqual(["presa"]);
  });

  it("as portas de pedido passam o conjunto (criar, editar, restaurar, catálogo, Pix, Colar)", () => {
    expect(ler("src/app/api/orders/route.ts")).toContain("reservarComExtras(tx, itensDeEstoque, livres)");
    const patch = ler("src/app/api/orders/[id]/route.ts");
    expect(patch).toContain("reservarOQueTiver(tx, [{ variantId, quantity: baixar, label }], livres)");
    expect(patch).toContain("reservarComExtras(tx, itensParaEstoque.map(itemDeEstoque), livresDoRestauro)");
    expect(ler("src/app/api/catalog/order/route.ts")).toMatch(/reservarOQueTiver\([\s\S]*?livres\s*\)/);
    expect(ler("src/lib/settle-order.ts")).toMatch(/reservarOQueTiver\([\s\S]*?livres\s*\)/);
    expect(ler("src/app/api/orders/ler-mensagem/route.ts")).toContain("vendeSobEncomenda({");
  });
});

describe("a vitrine: a peça não some ao zerar e a quantidade não para", () => {
  it("o disponível da vitrine vira o teto da linha", () => {
    expect(disponivelNaVitrine(0, true)).toBe(TETO_POR_LINHA);
    expect(disponivelNaVitrine(-5, true)).toBe(TETO_POR_LINHA);
    expect(disponivelNaVitrine(0, false)).toBe(0);
  });

  it("'esconder sem estoque' não esconde a peça ligada nem a de categoria ligada (salvo a desligada na ficha)", () => {
    // e só a peça que pode ser livre: fora do Jueri, com alguma variação fora da Nuvemshop
    const livre = { jueriId: null, variants: { some: { nuvemshopId: null } } };
    expect(ondeNaoEscondePorEstoque(new Set(["Conjuntos"]))).toEqual({
      OR: [
        { variants: { some: { stock: { gt: 0 } } } },
        { sobEncomenda: true, ...livre },
        { sobEncomenda: null, category: { in: ["Conjuntos"] }, ...livre },
      ],
    });
    // sem categoria ligada, só a ficha ligada passa
    expect(ondeNaoEscondePorEstoque(new Set())).toEqual({
      OR: [{ variants: { some: { stock: { gt: 0 } } } }, { sobEncomenda: true, ...livre }],
    });
  });

  it("os dois produtores da vitrine e a API de produtos resolvem a chavinha no SERVIDOR", () => {
    for (const rel of [
      "src/app/catalogo/[slug]/montar-catalogo.tsx",
      "src/app/catalogo/[slug]/c/[promo]/page.tsx",
      "src/app/api/products/route.ts",
    ]) {
      expect(ler(rel)).toContain("categoriasSobEncomenda(");
    }
  });
});

describe("a grade e o carrinho: a peça livre não para no estoque e não vira extra", () => {
  it("o teto da célula é o da digitação", () => {
    expect(tetoDaVariacao({ stock: 0, sobEncomenda: true })).toBe(TETO_COM_EXTRA);
    expect(tetoDaVariacao({ stock: 3 })).toBe(3);
    expect(tetoDaVariacao({ stock: 3 }, true)).toBe(TETO_COM_EXTRA);
  });

  it("'repetir' preenche a célula livre mesmo zerada", () => {
    const novo = repetirNaLinha({ a: "3" }, [
      { id: "a", color: "Preto", size: "P", stock: 5 },
      { id: "b", color: "Preto", size: "M", stock: 0, sobEncomenda: true },
      { id: "c", color: "Preto", size: "G", stock: 0 },
    ]);
    expect(novo).toEqual({ a: "3", b: "3" });
  });

  it("a linha livre acima do estoque não é aviso", () => {
    const base = { productId: "p", variantId: "v", name: "x", color: "", size: "", unitPrice: 1 };
    expect(pecasAcimaDoEstoque([{ ...base, quantity: 5, stock: 0, sobEncomenda: true }])).toEqual([]);
    expect(pecasAcimaDoEstoque([{ ...base, quantity: 5, stock: 0 }])).toHaveLength(1);
  });

  it("o teto da edição soma o segurado ao número CRU da peça livre: −3 com 5 seguradas são 2 na arara", () => {
    const [livre, presa] = somarOQueOPedidoSegura(
      [
        { id: "a", stock: -3, sobEncomenda: true },
        { id: "b", stock: -3 },
      ],
      new Map([
        ["a", 5],
        ["b", 5],
      ])
    );
    expect(livre.stock).toBe(2);
    expect(presa.stock).toBe(5);
  });

  it("a galeria de fotos (RN-071, 'só com estoque') mostra a peça livre zerada", () => {
    const g = montarGaleria(
      [
        {
          id: "p",
          name: "Conjunto",
          category: "Conjuntos",
          images: [{ id: "i", color: "Preto", order: 0 }],
          variants: [{ color: "Preto", stock: -2, sobEncomenda: true }],
        },
      ],
      { categorias: [], soComEstoque: true }
    );
    expect(g).toHaveLength(1);
  });

  it("o carrinho da Central e o editor de itens leem a chavinha da variação", () => {
    expect(ler("src/components/order-composer.tsx")).toContain("!l.sobEncomenda");
    expect(ler("src/app/(app)/pedidos/[id]/items-editor.tsx")).toContain("l.sobEncomenda");
  });
});

describe("o Estoque: fora do mínimo, dentro de 'A produzir'", () => {
  const linha = (disponivel: number, sobEncomenda: boolean): LinhaDoInventario => ({
    variantId: `v${disponivel}${sobEncomenda}`,
    productId: "p",
    produto: "Conjunto",
    categoria: "Conjuntos",
    cor: "Preto",
    tamanho: "M",
    sku: "s",
    ativo: true,
    disponivel,
    reservado: 5,
    emEstoque: disponivel + 5,
    dono: null,
    minimo: 2,
    origemDoMinimo: "LOJA",
    sobEncomenda,
    custo: 10,
    atacado: 20,
    cadastradoEm: "2026-01-01T00:00:00.000Z",
  });

  it("'chegou ao mínimo' é a régua da RN-051 menos a peça livre — nos cinco lugares", () => {
    expect(chegouAoMinimo(linha(-3, false))).toBe(true);
    expect(chegouAoMinimo(linha(-3, true))).toBe(false);
    expect(passaNoFiltro("baixo", linha(1, true))).toBe(false);
    expect(passaNoFiltro("baixo", linha(1, false))).toBe(true);
    // alerta: a livre nunca avisa; carimbada, solta o carimbo
    const d = decidirAlertas([{ ...linha(-3, true), variantId: "a" }, { ...linha(-3, false), variantId: "b" }], new Set(["a"]), new Set(["a", "b"]));
    expect(d.avisar).toEqual(["b"]);
    expect(d.limpar).toEqual(["a"]);
    // painel
    expect(analisarPeca(linha(-3, true), undefined, new Date("2026-06-01")).situacao).toBe("A_PRODUZIR");
    expect(analisarPeca(linha(-3, true), undefined, new Date("2026-06-01")).repor).toBe(0);
    // Dashboard: a SQL carrega a mesma escada e a exceção da vinculada
    const sql = ler("src/lib/estoque/inventario.ts");
    expect(sql).toContain('LEFT JOIN "SobEncomendaCategoria" s');
    expect(sql).toContain('COALESCE(p."sobEncomenda", s."id" IS NOT NULL)');
    expect(sql).toContain('v."nuvemshopId" IS NULL AND p."jueriId" IS NULL');
    // monitor da tela Produtos
    expect(ler("src/app/(app)/produtos/stock-monitor.tsx")).toContain("!v.sobEncomenda &&");
  });

  it("o chip 'A produzir' é só a livre devendo, e vira lista de produção com o negativo como falta", () => {
    expect(passaNoFiltro("produzir", linha(-3, true))).toBe(true);
    expect(passaNoFiltro("produzir", linha(0, true))).toBe(false);
    expect(passaNoFiltro("produzir", linha(-3, false))).toBe(false);
    expect(ehListaDeProducao("produzir")).toBe(true);
    expect(faltaParaOMinimo({ disponivel: -3, minimo: 2, sobEncomenda: true })).toBe(3);
    expect(faltaParaOMinimo({ disponivel: 1, minimo: 2 })).toBe(1);
  });

  it("os cartões: 'na loja' fecha com o negativo, 'disponíveis' não desce de zero, e 'a produzir' é contado", () => {
    const r = resumirLinhas([linha(-3, true), linha(4, false)]);
    // −3 + 5 reservadas = 2 na loja (as 2 que a cliente levou antes); 4 + 5 = 9
    expect(r.pecas).toBe(11);
    expect(r.disponiveis).toBe(4);
    expect(r.aProduzir).toBe(3);
    expect(r.baixas).toBe(0);
  });

  it("dinheiro parado nunca é negativo", () => {
    const a = analisarPeca({ ...linha(-9, true), emEstoque: -4 }, undefined, new Date("2026-06-01"));
    expect(a.valorParadoCusto).toBe(0);
    expect(a.coberturaDias).toBeNull();
  });

  it("o ajuste digitado continua só de 0 para cima, e a tela avisa que apaga a conta a produzir", () => {
    expect(ler("src/app/api/estoque/variacoes/[id]/route.ts")).toContain("estoque: z.number().int().min(0)");
    expect(ler("src/app/(app)/estoque/inventario-view.tsx")).toContain("apagaAProduzir");
  });
});

describe("quem liga: gerência; a peça vinculada recusa", () => {
  it("categoria: só gerência, acompanha renomear e apagar", () => {
    const rota = ler("src/app/api/categories/route.ts");
    expect(rota).toContain("parsed.data.sobEncomenda !== undefined && !isManagerUp(g.user)");
    expect(rota).toContain("db.sobEncomendaCategoria.updateMany({ where: { companyId, category: from }, data: { category: to } })");
    expect(rota).toContain("db.sobEncomendaCategoria.deleteMany({ where: { companyId, category: name } })");
  });

  it("peça: só gerência muda, e a vinculada não liga", () => {
    const rota = ler("src/app/api/products/[id]/route.ts");
    expect(rota).toContain("data.sobEncomenda !== undefined && data.sobEncomenda !== product.sobEncomenda");
    expect(rota).toContain("product.variants.some((v) => !!v.nuvemshopId)");
    expect(rota).toContain("não vende sob encomenda");
  });
});
