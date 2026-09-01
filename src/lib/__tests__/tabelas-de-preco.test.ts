import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  faltaParaOMinimo,
  modoValido,
  tabelaNoTexto,
  textoDoMinimo,
} from "../catalogo/tabelas-de-preco";
import { precoSugeridoNoPedido } from "../orders";
import { novoCodigoDeLink } from "../catalogo/tabelas-de-preco-servidor";

// Guarda RN-018, RN-041 (índice em docs/regras.md; texto no CLAUDE.md).
/**
 * TABELAS DE PREÇO POR LINK (17/08/2026) — atacado e varejo no mesmo catálogo.
 *
 * REGRA MAIOR: é recurso GATED e DESLIGADO por padrão. Loja que não ativou
 * não pode notar diferença nenhuma — nem no preço, nem em trava de
 * quantidade, nem na tela. É o que estes guardas protegem.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const produtos = [
  { id: "p1", name: "Regata Alça", minQuantity: 6 },
  { id: "p2", name: "Legging", minQuantity: 1 },
  { id: "p3", name: "Body", minQuantity: 3 },
];

describe("quantidade mínima do atacado", () => {
  it("soma TODAS as cores e tamanhos do mesmo modelo", () => {
    // 2 pretas + 4 azuis da mesma regata = 6, fecha o mínimo
    const faltas = faltaParaOMinimo(
      [
        { productId: "p1", quantity: 2 },
        { productId: "p1", quantity: 4 },
      ],
      produtos,
      "ATACADO"
    );
    expect(faltas).toEqual([]);
  });
  it("acusa o modelo abaixo do mínimo, com o número certo", () => {
    const faltas = faltaParaOMinimo([{ productId: "p1", quantity: 4 }], produtos, "ATACADO");
    expect(faltas).toEqual([
      { productId: "p1", nome: "Regata Alça", pedido: 4, minimo: 6 },
    ]);
  });
  it("produto sem mínimo (1) nunca trava", () => {
    expect(faltaParaOMinimo([{ productId: "p2", quantity: 1 }], produtos, "ATACADO")).toEqual([]);
  });
  it("produto que não está na sacola não entra na conta", () => {
    const faltas = faltaParaOMinimo([{ productId: "p2", quantity: 5 }], produtos, "ATACADO");
    expect(faltas).toEqual([]); // p1 e p3 têm mínimo, mas ninguém pediu
  });
  it("acusa vários modelos de uma vez", () => {
    const faltas = faltaParaOMinimo(
      [
        { productId: "p1", quantity: 1 },
        { productId: "p3", quantity: 2 },
      ],
      produtos,
      "ATACADO"
    );
    expect(faltas.map((f) => f.productId)).toEqual(["p1", "p3"]);
  });

  // O CORAÇÃO DA REGRA: nada muda para quem não ativou
  it("NO VAREJO não existe mínimo nenhum", () => {
    expect(faltaParaOMinimo([{ productId: "p1", quantity: 1 }], produtos, "VAREJO")).toEqual([]);
  });

  it("o recado diz o que falta, em português de gente", () => {
    const texto = textoDoMinimo(
      faltaParaOMinimo([{ productId: "p1", quantity: 2 }], produtos, "ATACADO")
    );
    expect(texto).toContain("Regata Alça");
    expect(texto).toContain("mínimo 6");
    expect(textoDoMinimo([])).toBe("");
  });
});

describe("modo e código do link", () => {
  it("só ATACADO é atacado; qualquer outra coisa é varejo", () => {
    expect(modoValido("ATACADO")).toBe("ATACADO");
    expect(modoValido("VAREJO")).toBe("VAREJO");
    expect(modoValido("banana")).toBe("VAREJO");
    expect(modoValido(null)).toBe("VAREJO");
  });
  it("o código é sorteado (não se adivinha) e não repete", () => {
    const a = novoCodigoDeLink();
    const b = novoCodigoDeLink();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toMatch(/atacado|varejo/i);
  });
});

describe("o pedido colado do WhatsApp cobra pela tabela CERTA", () => {
  it("lê o carimbo da mensagem do catálogo", () => {
    expect(tabelaNoTexto("*Novo pedido*\n_Tabela: Atacado_\n")).toBe("ATACADO");
    expect(tabelaNoTexto("_Tabela: Varejo_")).toBe("VAREJO");
    expect(tabelaNoTexto("Tabela: atacado")).toBe("ATACADO"); // sem itálico
  });
  it("mensagem sem carimbo vale o padrão da loja (nada muda para quem não usa)", () => {
    expect(tabelaNoTexto("*Novo pedido — Loja*\n\n2x Blusa")).toBeNull();
    expect(tabelaNoTexto("")).toBeNull();
  });
  it("o catálogo CARIMBA a tabela na mensagem", () => {
    expect(ler("src/app/catalogo/[slug]/public-catalog.tsx")).toContain(
      'msg += `_Tabela: ${tabela.mode === "ATACADO" ? "Atacado" : "Varejo"}_'
    );
  });
  it("o leitor usa o carimbo (era R$ 89,90 no lugar de R$ 45,00)", () => {
    const rota = ler("src/app/api/orders/ler-mensagem/route.ts");
    expect(rota).toContain("tabelaNoTexto(parsed.data.texto)");
    expect(rota).toContain("loja?.priceTablesEnabled && tabelaDaMensagem");
  });
  /**
   * O COMPORTAMENTO, não a linha: a versão anterior deste guarda exigia o
   * trecho `catalogPrice(p, priceMode)` — e guarda que descreve o CÓDIGO
   * protege o erro em vez de impedi-lo (lição de 28/08/2026). Justamente
   * este: a mesma tela mostrava atacado na lista e criava a linha a varejo.
   */
  it("peça acrescentada depois segue a tabela DO PEDIDO", () => {
    const peca = { retailPrice: 100, wholesalePrice: 80 };
    expect(precoSugeridoNoPedido(peca, { priceMode: "ATACADO" })).toBe(80);
    expect(precoSugeridoNoPedido(peca, { priceMode: "VAREJO" })).toBe(100);
    // e o desconto do link de campanha (RN-040) entra por cima
    expect(precoSugeridoNoPedido(peca, { priceMode: "VAREJO", campaignDiscount: 20 })).toBe(80);
    // a tela recebe a origem do pedido
    expect(ler("src/app/(app)/pedidos/[id]/page.tsx")).toContain("priceMode={order.priceMode}");
    expect(ler("src/app/(app)/pedidos/[id]/page.tsx")).toContain("source={order.source}");
  });

  /**
   * SEM TABELA, QUEM RESPONDE É A ORIGEM (RN-041). `priceMode` é nulo em quase
   * todo pedido — e ele NÃO pode ser carimbado só para resolver isso, porque
   * a porta do Financeiro (RN-033) escolhe a categoria da receita por ele.
   */
  it("sem tabela, o preço sai da ORIGEM do pedido", () => {
    const peca = { retailPrice: 100, wholesalePrice: 80 };
    // loja online: o preço de lá é o varejo — sugerir atacado colocaria uma
    // peça de R$ 80 ao lado de linhas de R$ 100 no mesmo pedido
    expect(precoSugeridoNoPedido(peca, { source: "NUVEMSHOP" })).toBe(100);
    // pedido do catálogo: a tabela que o catálogo daquela loja mostra
    expect(
      precoSugeridoNoPedido(peca, { source: "CATALOGO", catalogPriceMode: "VAREJO" })
    ).toBe(100);
    expect(
      precoSugeridoNoPedido(peca, { source: "CATALOGO", catalogPriceMode: "ATACADO" })
    ).toBe(80);
    // sem origem conhecida (a tela de montar pedido): atacado, como sempre foi
    expect(precoSugeridoNoPedido(peca)).toBe(80);
  });


  /** Peça sem preço de atacado cai no varejo, nunca em zero. */
  it("peça sem preço de atacado não vira R$ 0", () => {
    expect(precoSugeridoNoPedido({ retailPrice: 59.9, wholesalePrice: 0 })).toBe(59.9);
  });

  /**
   * UMA REGRA SÓ, nos três lugares: a listinha de busca mostrava o preço de
   * ATACADO e a linha nascia a VAREJO — na mesma tela, e o `unitPrice` que a
   * tela manda é o que vira o pedido (achado de 01/09/2026).
   */
  it("lista e linha usam a MESMA regra de preço", () => {
    for (const tela of [
      "src/app/(app)/pedidos/[id]/items-editor.tsx",
      "src/app/(app)/pedidos/new-order.tsx",
    ]) {
      const fonte = ler(tela);
      expect(fonte).toContain("precoSugeridoNoPedido");
      // nenhuma conta caseira de preço sobrou por perto
      expect(fonte).not.toContain("wholesalePrice > 0 ? p.wholesalePrice");
    }
  });
});

describe("a vitrine e a tela contam a verdade (revisão 18/08/2026)", () => {
  it("mínimo SEM preço de atacado também avisa (o caso das semijoias)", () => {
    const cat = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    expect(cat).toContain("sheet.product.wholesalePrice <= 0 &&");
    expect(cat).toContain("Mínimo de {sheet.product.minQuantity} peças deste modelo");
  });
  it("vendedora LÊ os links (só criar/desativar é de gerente)", () => {
    const rota = ler("src/app/api/catalog-links/route.ts");
    expect(rota).toContain("guardar(user, false)"); // GET
    expect(rota).toContain("guardar(user, true)"); // POST/PATCH
    expect(rota).toContain("precisaEditar && !isManagerUp");
  });
  it("a conferência conta as peças que a vitrine mostra de verdade", () => {
    expect(ler("src/app/api/catalog-links/route.ts")).toContain("catalogHideOutOfStock");
  });
  it("reativar link respeita o teto de 20", () => {
    expect(ler("src/app/api/catalog-links/route.ts")).toContain(
      "reativar também conta para o teto"
    );
  });
  it("estado vazio, sem permissão e falha de rede são TRÊS coisas diferentes", () => {
    const tela = ler("src/app/(app)/configuracoes/catalogo/links-de-preco.tsx");
    expect(tela).toContain("setSemAcesso");
    expect(tela).toContain("setFalhouCarregar");
    expect(tela).toContain("para não criar link repetido");
  });
  it("o endereço completo aparece na tela (dá para conferir e copiar à mão)", () => {
    expect(ler("src/app/(app)/configuracoes/catalogo/links-de-preco.tsx")).toContain(
      "{enderecoDe(l.code)}"
    );
  });
});

describe("o recurso é gated: desligado, NADA muda", () => {
  const lib = ler("src/lib/catalogo/tabelas-de-preco-servidor.ts");
  it("link só vale para loja com o recurso ligado", () => {
    expect(lib).toContain("if (!recursoLigado || !code) return null");
  });

  it("o build LOCAL é o mesmo da Vercel (turbopack escondia o erro)", () => {
    // o deploy de 17/08 caiu num erro que o build local (turbopack) engolia:
    // "rodei o build e passou" deixou de ser garantia. Agora é o mesmo motor.
    const pkg = JSON.parse(ler("package.json"));
    expect(pkg.scripts.build).not.toContain("--turbopack");
    expect(pkg.scripts.build).toContain("next build");
  });

  it("a regra pura fica SEM servidor — foi o deploy quebrado de 17/08/2026", () => {
    // o catálogo público (navegador) importa este arquivo; node:crypto ou o
    // banco aqui dentro derrubam o build da Vercel (webpack) — o turbopack
    // local engole e não avisa
    const pura = ler("src/lib/catalogo/tabelas-de-preco.ts");
    expect(pura).not.toContain("node:crypto");
    expect(pura).not.toContain('from "../db"');
  });
  it("a chave nasce DESLIGADA para todas as lojas", () => {
    expect(ler("prisma/schema.prisma")).toMatch(/priceTablesEnabled\s+Boolean\s+@default\(false\)/);
    expect(ler("prisma/migrations/20260817210000_tabelas_de_preco/migration.sql")).toContain(
      '"priceTablesEnabled" BOOLEAN NOT NULL DEFAULT false'
    );
  });
  it("a trava de mínimo só existe DENTRO do link de atacado", () => {
    // loja cujo catálogo já é atacado hoje não ganha trava nenhuma
    const rota = ler("src/app/api/catalog/order/route.ts");
    expect(rota).toContain('modoDePreco === "ATACADO" && tabela ? "ATACADO" : "VAREJO"');
  });
  it("a seção de links só aparece para quem ativou", () => {
    expect(ler("src/app/(app)/configuracoes/catalogo/page.tsx")).toContain(
      "company.priceTablesEnabled && ("
    );
  });
  it("as portas de gerenciar links recusam loja sem o recurso", () => {
    const rota = ler("src/app/api/catalog-links/route.ts");
    expect(rota).toContain("priceTablesEnabled");
    // texto sem jargão: "não contratado" não diz nada para a lojista
    expect(rota).toContain("Sua loja não usa tabelas de preço por link.");
    expect(rota).toContain("isManagerUp");
  });
  it("só o Super Admin liga a chave", () => {
    const rota = ler("src/app/api/companies/price-tables/route.ts");
    expect(rota).toContain('user.role !== "SUPERADMIN"');
  });
});

describe("quem manda no preço é o servidor", () => {
  const rota = ler("src/app/api/catalog/order/route.ts");
  it("o preço é recalculado pela tabela do link (nunca vem do navegador)", () => {
    expect(rota).toContain("const tabela = await resolverLink(");
    expect(rota).toContain("catalogPrice(p, modoDePreco)");
  });
  it("o mínimo é conferido no SERVIDOR (a tela é só gentileza)", () => {
    expect(rota).toContain("faltaParaOMinimo(");
    expect(rota).toContain("status: 409");
  });
  /**
   * O carimbo vale SÓ para o link de tabela, e isso é decisão, não descuido
   * (revisão de 01/09/2026): a porta única do Financeiro (RN-033) escolhe a
   * categoria da receita por ele. Carimbar todo pedido do catálogo mudaria a
   * venda de loja VAREJO de "Venda atacado" para "Venda varejo" no meio do
   * ano, quebrando a linha do DRE.
   */
  it("o pedido guarda a tabela que o precificou", () => {
    expect(rota).toContain("priceMode: tabela ? modoDePreco : null");
    expect(ler("prisma/schema.prisma")).toMatch(/priceMode\s+String\?/);
  });
  it("link inválido/desativado NÃO vira catálogo normal disfarçado", () => {
    // a lojista mandou o link de atacado; se ele não resolve, a página some
    // (em vez de mostrar varejo para a cliente lojista sem ninguém perceber)
    expect(ler("src/app/catalogo/[slug]/montar-catalogo.tsx")).toContain(
      "if (!tabela) notFound()"
    );
  });
});

describe("o que a revisão pegou (17/08/2026)", () => {
  it("mesma sacola no varejo e no atacado são DOIS pedidos (protocolo separa)", () => {
    expect(ler("src/lib/catalogo/envio-pedido.ts")).toContain("`#${payload.link ?? \"\"}`");
    // e a sacola guardada no aparelho também não se mistura entre tabelas
    expect(ler("src/app/catalogo/[slug]/public-catalog.tsx")).toContain(
      "tabela ? `:l:${tabela.code}` : \"\""
    );
  });
  it("link que não vale mais RECUSA o pedido (não cobra varejo escondido)", () => {
    const rota = ler("src/app/api/catalog/order/route.ts");
    expect(rota).toContain("if (input.link && !tabela)");
    expect(rota).toContain("linkInvalido: true");
  });
  it("campanha NÃO se soma à tabela de preço", () => {
    expect(ler("src/app/api/catalog/order/route.ts")).toContain(
      "promo?.active && !tabela ? promo : null"
    );
  });
  it("recusa do servidor CHEGA na cliente (senão o pedido some calado)", () => {
    expect(ler("src/lib/catalogo/envio-pedido.ts")).toContain("aoRecusar?.(r.motivo)");
    expect(ler("src/app/catalogo/[slug]/public-catalog.tsx")).toContain("setErroDoEnvio(motivo)");
  });
  it("desativar link que falha volta atrás na tela (não mente que fechou)", () => {
    const tela = ler("src/app/(app)/configuracoes/catalogo/links-de-preco.tsx");
    expect(tela).toContain("ele CONTINUA valendo");
  });
  it("o link copiado é montado no SERVIDOR (domínio de catálogos)", () => {
    const tela = ler("src/app/(app)/configuracoes/catalogo/links-de-preco.tsx");
    expect(tela).not.toContain("window.location.origin");
    expect(ler("src/app/(app)/configuracoes/catalogo/page.tsx")).toContain("baseDoCatalogo");
  });
  it("a tela usa a MESMA régua de permissão da API (gerente+)", () => {
    expect(ler("src/app/(app)/configuracoes/catalogo/page.tsx")).toContain(
      "canEdit={isManagerUp(user)}"
    );
  });
  it("o teto de links conta só os ATIVOS (desativar destrava)", () => {
    expect(ler("src/app/api/catalog-links/route.ts")).toContain(
      "where: { companyId: user.companyId, active: true }"
    );
  });
  it("o carimbo da tabela é LIDO: a tela do pedido mostra", () => {
    expect(ler("src/app/(app)/pedidos/[id]/page.tsx")).toContain("order.priceMode");
  });
});

describe("a conferência antes de mandar o link (17/08/2026)", () => {
  it("peça sem preço de atacado cai no VAREJO — a régua é esta", () => {
    // é o motivo do aviso: no link de atacado, peça sem atacado cadastrado
    // aparece pelo preço cheio, e parece que o recurso não funcionou
    expect(ler("src/lib/orders.ts")).toContain("modo === \"ATACADO\" && product.wholesalePrice > 0");
  });
  it("a API conta as peças sem atacado e sem mínimo (só as da vitrine)", () => {
    const rota = ler("src/app/api/catalog-links/route.ts");
    expect(rota).toContain("wholesalePrice: { lte: 0 }");
    expect(rota).toContain("minQuantity: { lte: 1 }");
    expect(rota).toContain("images: { some: {} }"); // só o que aparece no catálogo
  });
  it("o aviso só aparece quando existe link de ATACADO ativo", () => {
    const tela = ler("src/app/(app)/configuracoes/catalogo/links-de-preco.tsx");
    expect(tela).toContain("temLinkAtacado && conferencia && conferencia.semAtacado > 0");
    expect(tela).toContain("sem preço de\n            atacado cadastrado");
  });
});

describe("o endereço curto e a montagem única", () => {
  it("catalago.net/<loja>/l/<código> é reescrito antes da regra de vendedora", () => {
    const mw = ler("src/middleware.ts");
    expect(mw).toContain('segs.length === 3 && segs[1] === "l"');
    expect(mw.indexOf('segs[1] === "l"')).toBeLessThan(mw.indexOf("url.searchParams.set(\"ref\""));
  });
  it("a vitrine é montada num lugar só (preço não pode divergir entre telas)", () => {
    const pg = ler("src/app/catalogo/[slug]/page.tsx");
    expect(pg).toContain("montarCatalogo({ slug, sp })");
    expect(ler("src/app/catalogo/[slug]/l/[code]/page.tsx")).toContain("linkCode: code");
  });
  it("a tela bloqueia o envio abaixo do mínimo e manda o link junto", () => {
    const cat = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    expect(cat).toContain("disabled={minBlocked || atacadoBloqueado}");
    expect(cat).toContain("link: tabela?.code || undefined");
  });
});
