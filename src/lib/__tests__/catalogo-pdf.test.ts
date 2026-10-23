import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  A4_ALTURA,
  A4_LARGURA,
  LAYOUT,
  alturaDoCard,
  alturaUtil,
  larguraDoCard,
  paginar,
  textoDosTamanhos,
  xDaColuna,
} from "@/lib/catalogo/pdf-layout";
import {
  cardsDaPeca,
  categoriasNaOrdem,
  contarCards,
  rotulosCanonicos,
  secoesDaVitrine,
} from "@/lib/catalogo/secoes";
import { nomeDoArquivo } from "@/lib/catalogo/pdf";

// Guarda RN-094

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const peca = (
  id: string,
  category: string,
  variants: { color: string; size: string; disponivel: number }[]
) => ({ id, category, variants });

describe("RN-094 · as seções do PDF são as MESMAS da vitrine", () => {
  it("um card por COR, tamanhos na ordem da arara", () => {
    const p = peca("p1", "Blusas", [
      { color: "Preto", size: "G", disponivel: 2 },
      { color: "Preto", size: "P", disponivel: 5 },
      { color: "Avelã", size: "M", disponivel: 1 },
    ]);
    const cards = cardsDaPeca(p, false);
    expect(cards.map((c) => c.color)).toEqual(["Preto", "Avelã"]);
    expect(cards[0].sizes.map((s) => s.size)).toEqual(["P", "G"]);
    expect(cards[0].key).toBe("p1|Preto");
  });

  it("a chavinha 'esconder sem estoque' esconde a COR esgotada, não o modelo", () => {
    const p = peca("p1", "Blusas", [
      { color: "Preto", size: "P", disponivel: 0 },
      { color: "Preto", size: "M", disponivel: 0 },
      { color: "Avelã", size: "P", disponivel: 3 },
    ]);
    expect(cardsDaPeca(p, false).map((c) => c.color)).toEqual(["Preto", "Avelã"]);
    expect(cardsDaPeca(p, true).map((c) => c.color)).toEqual(["Avelã"]);
  });

  it("'tem/não tem' é derivado do número uma vez só", () => {
    const [card] = cardsDaPeca(
      peca("p1", "Blusas", [{ color: "Preto", size: "P", disponivel: 0 }]),
      false
    );
    expect(card.sizes[0]).toEqual({ size: "P", available: false, disponivel: 0 });
  });

  it("categorias byte-diferentes que se LEEM iguais são UMA seção", () => {
    // "Calças" com o ç decomposto (o que o iOS e a Nuvemshop gravam)
    const decomposto = "Calças";
    const rotulos = rotulosCanonicos([{ category: "Calças" }, { category: decomposto }]);
    expect(rotulos.size).toBe(1);

    const secoes = secoesDaVitrine([
      peca("a", "Calças", [{ color: "Preto", size: "P", disponivel: 1 }]),
      peca("b", decomposto, [{ color: "Avelã", size: "P", disponivel: 1 }]),
    ]);
    expect(secoes).toHaveLength(1);
    expect(secoes[0].cards).toHaveLength(2);
  });

  it("a ordem das seções é a que a loja escolheu", () => {
    const rotulos = rotulosCanonicos([
      { category: "Blusas" },
      { category: "Vestidos" },
      { category: "Shorts" },
    ]);
    expect(
      categoriasNaOrdem(rotulos, { categoryOrder: ["Shorts", "Blusas", "Vestidos"] })
    ).toEqual(["Shorts", "Blusas", "Vestidos"]);
  });

  it("os TIPOS reagrupam as seções (a causa do 'o short não aparece')", () => {
    const rotulos = rotulosCanonicos([
      { category: "Shorts" },
      { category: "Blusas" },
      { category: "Bermudas" },
    ]);
    const ordem = categoriasNaOrdem(rotulos, {
      categoryOrder: ["Shorts", "Blusas", "Bermudas"],
      categoryTypes: { shorts: "Parte de baixo", bermudas: "Parte de baixo" },
    });
    // tudo de um tipo junto; a categoria sem guarda-chuva cai em "Outros", no fim
    expect(ordem).toEqual(["Shorts", "Bermudas", "Blusas"]);
  });

  it("seção sem nenhum card sai da lista (no papel seria página em branco)", () => {
    const secoes = secoesDaVitrine(
      [
        peca("a", "Blusas", [{ color: "Preto", size: "P", disponivel: 0 }]),
        peca("b", "Shorts", [{ color: "Avelã", size: "P", disponivel: 4 }]),
      ],
      { hideSoldOut: true }
    );
    expect(secoes.map((s) => s.categoria)).toEqual(["Shorts"]);
    expect(contarCards(secoes)).toBe(1);
  });
});

describe("RN-094 · a paginação do PDF", () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

  it("as medidas fecham dentro da folha A4", () => {
    const larg = larguraDoCard();
    // três colunas + duas calhas + duas margens = a largura da folha
    expect(larg * LAYOUT.colunas + LAYOUT.calha * 2 + LAYOUT.margem * 2).toBeCloseTo(
      A4_LARGURA,
      6
    );
    expect(xDaColuna(0)).toBe(LAYOUT.margem);
    expect(xDaColuna(2) + larg).toBeCloseTo(A4_LARGURA - LAYOUT.margem, 6);
  });

  it("cabem TRÊS fileiras por página, com o título — o que matou o terço vazio", () => {
    const precisa = LAYOUT.tituloAltura + 3 * alturaDoCard() + 2 * LAYOUT.entreLinhas;
    expect(precisa).toBeLessThanOrEqual(alturaUtil());
    // e QUATRO não cabem (se coubessem, o layout estaria desperdiçando folha)
    expect(
      LAYOUT.tituloAltura + 4 * alturaDoCard() + 3 * LAYOUT.entreLinhas
    ).toBeGreaterThan(alturaUtil());
  });

  it("nenhuma linha desenhada invade o rodapé", () => {
    const paginas = paginar([{ categoria: "Blusas", cards: cards(40) }]);
    for (const p of paginas) {
      for (const l of p.linhas) {
        expect(l.topoY - alturaDoCard()).toBeGreaterThanOrEqual(LAYOUT.rodape);
        expect(l.topoY).toBeLessThanOrEqual(A4_ALTURA - LAYOUT.topo);
      }
    }
  });

  it("cada categoria começa em fileira nova (nunca duas na mesma linha)", () => {
    const paginas = paginar([
      { categoria: "Blusas", cards: cards(4) },
      { categoria: "Shorts", cards: cards(2) },
    ]);
    const linhas = paginas.flatMap((p) => p.linhas);
    // 4 blusas = 2 fileiras (3 + 1); 2 shorts = 1 fileira
    expect(linhas.map((l) => l.cards.length)).toEqual([3, 1, 2]);
    expect(linhas.filter((l) => l.titulo).map((l) => l.titulo!.categoria)).toEqual([
      "Blusas",
      "Shorts",
    ]);
  });

  it("o TÍTULO nunca fica órfão no pé da página", () => {
    // uma categoria que enche a página e outra que começaria no finalzinho
    const paginas = paginar([
      { categoria: "Blusas", cards: cards(9) },
      { categoria: "Shorts", cards: cards(3) },
    ]);
    for (const p of paginas) {
      const comTitulo = p.linhas.filter((l) => l.titulo);
      for (const l of comTitulo) {
        // onde há título há card: o título desce junto com a primeira fileira
        expect(l.cards.length).toBeGreaterThan(0);
      }
    }
    // o título de Shorts foi para a página 2, junto das peças dele
    expect(paginas).toHaveLength(2);
    expect(paginas[1].linhas[0].titulo?.categoria).toBe("Shorts");
  });

  it("o cabeçalho corrido diz a categoria da PRIMEIRA linha da página", () => {
    const paginas = paginar([{ categoria: "Vestidos", cards: cards(20) }]);
    for (const p of paginas) expect(p.categoria).toBe("Vestidos");
  });

  it("o título conta as peças da SEÇÃO inteira, não as da página", () => {
    const paginas = paginar([{ categoria: "Blusas", cards: cards(20) }]);
    expect(paginas[0].linhas[0].titulo?.totalDeCards).toBe(20);
  });

  it("seção vazia não cria página", () => {
    expect(paginar([{ categoria: "Blusas", cards: [] }])).toEqual([]);
  });
});

describe("RN-094 · a linha de tamanhos do card", () => {
  const sizes = [
    { size: "P", available: true },
    { size: "M", available: false },
    { size: "G", available: true },
  ];

  it("só os tamanhos que a cliente PODE pedir — com ou sem a chavinha da loja", () => {
    /*
     * No papel não há como apagar uma palavra, e o tamanho esgotado na
     * lista faria a cliente pedir o M que não existe — o estrago que a
     * RN-067 existe para evitar. A regra não depende de configuração: o
     * esgotado nunca entra.
     */
    expect(textoDosTamanhos(sizes)).toBe("P · G");
  });

  it("sem nenhum tamanho disponível a linha some (o card diz 'Indisponível')", () => {
    expect(textoDosTamanhos([{ size: "P", available: false }])).toBe("");
  });
});

describe("RN-094 · o nome do arquivo", () => {
  const dia = new Date("2026-10-23T15:00:00.000Z");

  it("leva a loja e a data, só com letra, número e hífen", () => {
    expect(nomeDoArquivo("toque-leve", dia)).toBe("catalogo-toque-leve-2026-10-23.pdf");
  });

  it("acento e sinal viram hífen (o download quebra com nome torto)", () => {
    expect(nomeDoArquivo("Atacadão Moda & Cia", dia)).toBe(
      "catalogo-atacadao-moda-cia-2026-10-23.pdf"
    );
  });

  it("apelido que não sobra nada ainda dá um nome", () => {
    expect(nomeDoArquivo("🛍️", dia)).toBe("catalogo-loja-2026-10-23.pdf");
  });

  it("a data é a de São Paulo, não a do servidor", () => {
    // 23/10 às 22h em SP = 24/10 às 01h em UTC: o nome tem que dizer 23
    expect(nomeDoArquivo("loja", new Date("2026-10-24T01:00:00.000Z"))).toContain(
      "2026-10-23"
    );
  });
});

describe("RN-094 · o papel sai da MESMA fonte da vitrine", () => {
  it("a vitrine e o PDF leem o acervo pela mesma lib", () => {
    expect(ler("src/app/catalogo/[slug]/montar-catalogo.tsx")).toContain(
      "acervoDaVitrine(company,"
    );
    expect(ler("src/app/api/catalogo/pdf/route.ts")).toContain("acervoDaVitrine(company,");
  });

  it("a vitrine e o PDF montam os cards pela mesma lib", () => {
    expect(ler("src/app/catalogo/[slug]/public-catalog.tsx")).toContain(
      'from "@/lib/catalogo/secoes"'
    );
    expect(ler("src/app/api/catalogo/pdf/route.ts")).toContain("secoesDaVitrine(acervo,");
  });

  it("a foto de cada cor é a MESMA escolha do site (capa por cor)", () => {
    expect(ler("src/lib/catalogo/pdf.ts")).toContain("fotoDaCor(");
  });

  it("o preço do papel é o `precoCatalogo` da vitrine, nunca recalculado", () => {
    const fonte = ler("src/lib/catalogo/pdf.ts");
    expect(fonte).toContain("card.product.precoCatalogo");
    // o papel não tem conta de preço própria (RN-002: frete nunca entra aqui)
    expect(fonte).not.toMatch(/wholesalePrice|retailPrice|shippingFee|\.total\b/);
  });

  it("todo texto do PDF passa pelo filtro de emoji (RN-038)", () => {
    const fonte = ler("src/lib/catalogo/pdf.ts");
    // nenhuma página é criada sem o paginaSegura em volta
    const criadas = fonte.match(/pdf\.addPage\(/g)?.length ?? 0;
    const protegidas = fonte.match(/paginaSegura\(pdf\.addPage\(/g)?.length ?? 0;
    expect(criadas).toBeGreaterThan(0);
    expect(protegidas).toBe(criadas);
  });

  it("o PDF é a fotografia de AGORA: nunca guardado na CDN", () => {
    expect(ler("src/app/api/catalogo/pdf/route.ts")).toContain('"Cache-Control": "no-store"');
  });

  it("a rota é recortada pela loja da sessão (RN-013)", () => {
    const rota = ler("src/app/api/catalogo/pdf/route.ts");
    expect(rota).toContain("requireUser()");
    expect(rota).toContain("where: { id: user.companyId }");
    // o acervo nunca é lido por um companyId vindo da URL
    expect(rota).not.toMatch(/searchParams\.get\(["']company/);
  });

  it("código de tabela que não vale é RECUSADO (nunca cai no varejo calado)", () => {
    const rota = ler("src/app/api/catalogo/pdf/route.ts");
    expect(rota).toContain("if (codigo && !tabela)");
    expect(rota).toContain("status: 404");
  });
});
