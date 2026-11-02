import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import {
  CAPA_ALTURA_PX,
  CAPA_LARGURA_MINIMA_PX,
  CAPA_LARGURA_PX,
  FORMATO_RECOMENDADO,
  PROPORCAO_A4,
  TETO_FOTOS_DA_CAPA,
  TETO_TITULO,
  lerFotosDaCapa,
  motivoDaRecusa,
  proporcaoCabeNoA4,
  recorteParaA4,
  textoDaCapa,
  tituloDaCapa,
} from "@/lib/catalogo/capa-pdf-regra";
import { capaGuardadaParaOPdf, prepararCapaEnviada } from "@/lib/catalogo/capa-pdf";
import { bufferToDataUrl, dataUrlToBuffer } from "@/lib/img-server";

/**
 * A CAPA DO CATÁLOGO EM PDF É DA LOJA (RN-094, item 6 — o guardião da regra
 * inteira é `catalogo-pdf.test.ts`; este arquivo prova a capa).
 *
 * A régua de formato é UMA para o navegador e o servidor; a imagem gravada é
 * sempre o JPEG no A4 exato, em tabela própria; peça de outra loja é
 * recusada; capa torta nunca derruba o PDF. As portas são provadas
 * CHAMANDO-AS com banco simulado — não lendo o texto do código.
 */

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

async function imagem(largura: number, altura: number, formato: "jpeg" | "png" = "jpeg", alpha = false) {
  const buf = await sharp({
    create: {
      width: largura,
      height: altura,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 40, b: 40, alpha: 0 } : { r: 200, g: 40, b: 40 },
    },
  })
    [formato]()
    .toBuffer();
  return bufferToDataUrl(buf, `image/${formato}`);
}

/* ── o banco e a sessão simulados (as duas portas) ─────────────────────── */

const banco = vi.hoisted(() => ({
  user: { id: "u1", companyId: "loja1", role: "ADMIN" } as { id: string; companyId: string; role: string },
  produtosDaLoja: 0,
  update: null as null | { where: unknown; data: Record<string, unknown> },
  capaGuardada: null as null | { imagem: string },
  findManyProdutos: [] as { where: unknown }[],
  capaLida: [] as unknown[],
  capasApagadas: [] as unknown[],
}));

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {}
  return { AuthError, requireUser: async () => banco.user };
});

vi.mock("@/lib/db", () => ({
  db: {
    company: {
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        banco.update = args;
        return { id: "loja1", catalogoCapa: args.data.catalogoCapa ? { companyId: "loja1" } : null, catalogPdfCapaFotos: "[]" };
      },
      findFirst: async () => null,
      findUnique: async () => ({
        id: "loja1",
        name: "Loja",
        slug: "loja",
        tagline: null,
        whatsapp: null,
        logoUrl: null,
        catalogPrimary: "#95442A",
        catalogSecondary: "#F3E9DD",
        catalogBg: "#FBF7F2",
        catalogPriceMode: "VAREJO",
        catalogHideOutOfStock: false,
        catalogHideColors: false,
        categoryOrder: "",
        categoryTypes: "{}",
        priceTablesEnabled: false,
        catalogPdfCapaFaixa: true,
        catalogPdfTitulo: null,
        catalogPdfSubtitulo: null,
        catalogPdfCapaFotos: '["p-escolhido"]',
      }),
    },
    product: {
      count: async () => banco.produtosDaLoja,
      findMany: async (args: { where: unknown }) => {
        banco.findManyProdutos.push(args);
        return [{ id: "p-escolhido", images: [{ id: "foto-escolhida", color: null }] }];
      },
    },
    companyColor: { findMany: async () => [] },
    catalogoCapa: {
      findUnique: async (args: unknown) => {
        banco.capaLida.push(args);
        return banco.capaGuardada;
      },
      deleteMany: async (args: unknown) => {
        banco.capasApagadas.push(args);
        return { count: 0 };
      },
    },
  },
}));

// a leitura das fotos (banco) é simulada: devolve um JPEG miúdo para cada id
const fotos = vi.hoisted(() => ({ pedidas: [] as string[][] }));
vi.mock("@/lib/catalogo/foto-do-pdf", () => ({
  lerFotosParaPdf: async (ids: string[]) => {
    fotos.pedidas.push(ids);
    const jpeg = await sharp({ create: { width: 40, height: 53, channels: 3, background: "#888" } })
      .jpeg()
      .toBuffer();
    return new Map(ids.map((id) => [id, { jpeg }]));
  },
}));

// o acervo da vitrine, simulado com UMA peça (o PDF precisa de seção para sair)
vi.mock("@/lib/catalogo/acervo", () => ({
  acervoDaVitrine: async () => [
    {
      id: "p1",
      name: "Regata",
      sku: "RG-1",
      category: "Blusas",
      collection: null,
      description: null,
      retailPrice: 50,
      wholesalePrice: 30,
      precoCatalogo: 50,
      minQuantity: 1,
      tags: null,
      unidade: { singular: "peça", plural: "peças" },
      images: [{ id: "foto-p1", color: null }],
      variants: [{ color: "Preto", size: "M", disponivel: 2 }],
    },
  ],
}));

beforeEach(() => {
  banco.user = { id: "u1", companyId: "loja1", role: "ADMIN" };
  banco.produtosDaLoja = 0;
  banco.update = null;
  banco.capaGuardada = null;
  banco.findManyProdutos = [];
  banco.capaLida = [];
  banco.capasApagadas = [];
  fotos.pedidas = [];
});

describe("a régua do formato (navegador e servidor leem a mesma)", () => {
  it("A4 em pé é 297/210, e a tela diz os números exatos", () => {
    expect(PROPORCAO_A4).toBeCloseTo(1.4142, 3);
    expect(CAPA_ALTURA_PX / CAPA_LARGURA_PX).toBeCloseTo(PROPORCAO_A4, 2);
    expect(FORMATO_RECOMENDADO.pixels).toContain(`${CAPA_LARGURA_PX} × ${CAPA_ALTURA_PX}`);
    expect(FORMATO_RECOMENDADO.pixels).toContain("2480 × 3508");
    expect(FORMATO_RECOMENDADO.formatos).toBe("JPG ou PNG");
    expect(FORMATO_RECOMENDADO.canva).toContain("A4");
    // a tela mostra ESTA constante, não um texto digitado à parte
    const tela = ler("src/app/(app)/configuracoes/catalogo/capa-do-pdf.tsx");
    for (const campo of ["nome", "pixels", "formatos", "tamanho", "canva"]) {
      expect(tela).toContain(`FORMATO_RECOMENDADO.${campo}`);
    }
  });

  it("aceita o A4 exato, o do Canva a 300 dpi e a borda fina a mais; recusa quadrado, deitado e story", () => {
    expect(proporcaoCabeNoA4(1240, 1754)).toBe(true);
    expect(proporcaoCabeNoA4(2480, 3508)).toBe(true);
    expect(proporcaoCabeNoA4(1240, 1700)).toBe(true); // 3% a menos de altura
    expect(proporcaoCabeNoA4(1080, 1080)).toBe(false);
    expect(proporcaoCabeNoA4(1754, 1240)).toBe(false);
    expect(proporcaoCabeNoA4(1080, 1920)).toBe(false); // story 9:16
  });

  it("a recusa diz o que está errado, em português, com os números", () => {
    expect(motivoDaRecusa(1240, 1754)).toBeNull();
    expect(motivoDaRecusa(600, 849)).toContain(`${CAPA_LARGURA_MINIMA_PX} px`);
    expect(motivoDaRecusa(1754, 1240)).toContain("em pé");
    expect(motivoDaRecusa(1080, 1920)).toContain("formato A4");
    expect(motivoDaRecusa(0, 0)).toContain("Não deu para ler");
  });

  it("o recorte leva ao A4 exato pelo centro, aparando só a sobra — e diz de qual lado", () => {
    const alta = recorteParaA4(1240, 1800); // 46 px altos demais
    expect(alta).toMatchObject({ w: 1240, h: 1754, y: 23, eixo: "altura" });
    expect(alta.aparouPct).toBeCloseTo(2.6, 1);
    const larga = recorteParaA4(1300, 1754);
    expect(larga).toMatchObject({ h: 1754, w: 1240, x: 30, eixo: "largura" });
    const exata = recorteParaA4(2480, 3508);
    expect(exata.aparouPct).toBeLessThan(0.1);
  });
});

describe("o texto da capa automática", () => {
  it("o título é o da loja quando ela escolheu; senão o de sempre", () => {
    expect(tituloDaCapa(null, "outubro 2026")).toBe("CATÁLOGO · OUTUBRO 2026");
    expect(tituloDaCapa("  ", "outubro 2026")).toBe("CATÁLOGO · OUTUBRO 2026");
    expect(tituloDaCapa("Coleção Verão 27", "outubro 2026")).toBe("Coleção Verão 27");
  });

  it("texto livre é aparado, sem quebra de linha e no teto; vazio vira nulo", () => {
    expect(textoDaCapa("  Lançamentos \n de verão  ", TETO_TITULO)).toBe("Lançamentos de verão");
    expect(textoDaCapa("", TETO_TITULO)).toBeNull();
    expect(textoDaCapa("x".repeat(200), TETO_TITULO)).toHaveLength(TETO_TITULO);
  });

  it("as peças da capa: até três, sem repetição, JSON torto vira lista vazia", () => {
    expect(lerFotosDaCapa('["a","b","a","c","d"]')).toEqual(["a", "b", "c"]);
    expect(TETO_FOTOS_DA_CAPA).toBe(3);
    expect(lerFotosDaCapa("não é json")).toEqual([]);
    expect(lerFotosDaCapa('{"a":1}')).toEqual([]);
    expect(lerFotosDaCapa('[1, "", "ok"]')).toEqual(["ok"]);
    expect(lerFotosDaCapa(null)).toEqual([]);
  });
});

describe("a capa enviada, conferida e recomprimida no servidor", () => {
  it("A4 do Canva (300 dpi, PNG) vira JPEG de 1240 × 1754 com a miniatura junto — e PNG transparente ganha fundo branco", async () => {
    const r = await prepararCapaEnviada(await imagem(2480, 3508, "png", true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.imagem.startsWith("data:image/jpeg;base64,")).toBe(true);
    const meta = await sharp(dataUrlToBuffer(r.imagem)!.buf).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([CAPA_LARGURA_PX, CAPA_ALTURA_PX, "jpeg"]);
    // o que fica no banco é leve (uma cor chapada: alguns KB; foto real: ~300–600 KB)
    expect(r.bytes).toBeLessThan(200_000);
    const mini = await sharp(dataUrlToBuffer(r.miniatura)!.buf).metadata();
    expect(mini.width).toBe(220);
    expect(r.miniatura.length).toBeLessThan(40_000);
  });

  it("a borda fina a mais é aparada no A4 exato", async () => {
    const r = await prepararCapaEnviada(await imagem(1240, 1800));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(dataUrlToBuffer(r.imagem)!.buf).metadata();
    expect([meta.width, meta.height]).toEqual([CAPA_LARGURA_PX, CAPA_ALTURA_PX]);
  });

  it("recusa com frase: deitada, quadrada, story, pequena, grande demais, e o que não é imagem (rótulo não conta)", async () => {
    const erroDe = async (d: string) => {
      const r = await prepararCapaEnviada(d);
      return r.ok ? "" : r.erro;
    };
    expect(await erroDe(await imagem(1754, 1240))).toContain("em pé");
    expect(await erroDe(await imagem(1200, 1200))).toContain("em pé");
    expect(await erroDe(await imagem(1080, 1920))).toContain("formato A4");
    expect(await erroDe(await imagem(400, 566))).toContain("pequena");
    expect(await erroDe("data:image/jpeg;base64," + "A".repeat(4 * 1024 * 1024 + 10))).toContain("tamanho");
    // rótulo de PNG com HTML dentro: o conteúdo decide (RN-070)
    expect(await erroDe(bufferToDataUrl(Buffer.from("<html>oi</html>"), "image/png"))).toContain("Não deu para ler");
    expect(await erroDe("isto não é data-url")).toContain("Não deu para ler");
    // data-URL sem base64 com escape torto fazia o decodificador LANÇAR (500)
    expect(await erroDe("data:image/png,%E0%A4%A")).toContain("Não deu para ler");
  });

  it("o que o PDF embute é SÓ o JPEG gravado por aqui; texto torto vira capa automática, nunca erro", async () => {
    const r = await prepararCapaEnviada(await imagem(1240, 1754));
    if (!r.ok) throw new Error(r.erro);
    expect(capaGuardadaParaOPdf(r.imagem)).not.toBeNull();
    expect(capaGuardadaParaOPdf(null)).toBeNull();
    expect(capaGuardadaParaOPdf("data:image/png;base64,AAAA")).toBeNull();
    expect(capaGuardadaParaOPdf("data:image/jpeg;base64,AAAA")).toBeNull(); // sem a assinatura FF D8
    expect(capaGuardadaParaOPdf(await imagem(1240, 1754, "png"))).toBeNull(); // PNG não passou pela porta
  });
});

describe("a porta da loja (PATCH /api/company), chamada de verdade com banco simulado", () => {
  const pedido = (corpo: unknown) =>
    new Request("https://www.atacadopro.com/api/company", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });

  it("a capa enviada vai para a tabela PRÓPRIA já como JPEG no A4, com a miniatura — nunca crua, nunca na Company", async () => {
    const { PATCH } = await import("@/app/api/company/route");
    const res = await PATCH(pedido({ catalogPdfCapa: await imagem(2480, 3508, "png") }) as never);
    expect(res.status).toBe(200);
    const data = banco.update!.data;
    expect(data.catalogPdfCapa).toBeUndefined();
    const capa = (data.catalogoCapa as { upsert: { create: { imagem: string; miniatura: string } } }).upsert.create;
    expect(capa.imagem.startsWith("data:image/jpeg;base64,")).toBe(true);
    const meta = await sharp(dataUrlToBuffer(capa.imagem)!.buf).metadata();
    expect([meta.width, meta.height]).toEqual([CAPA_LARGURA_PX, CAPA_ALTURA_PX]);
    expect(capa.miniatura.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect((await res.json()).catalogPdfCapaTem).toBe(true);
  });

  it("capa nula APAGA a linha de forma idempotente (a 2ª aba que tira não leva 500); capa fora do formato é recusada com a frase", async () => {
    const { PATCH } = await import("@/app/api/company/route");
    expect((await PATCH(pedido({ catalogPdfCapa: null }) as never)).status).toBe(200);
    expect(banco.capasApagadas[0]).toEqual({ where: { companyId: "loja1" } });
    expect(banco.update!.data.catalogoCapa).toBeUndefined();
    expect((await PATCH(pedido({ catalogPdfCapa: null }) as never)).status).toBe(200);

    const res = await PATCH(pedido({ catalogPdfCapa: await imagem(1200, 1200) }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("em pé");
  });

  it("peça da capa que não é desta loja é recusada; as da loja entram como JSON, no teto", async () => {
    const { PATCH } = await import("@/app/api/company/route");
    banco.produtosDaLoja = 1; // só uma das duas é da loja
    const recusa = await PATCH(pedido({ catalogPdfCapaFotos: ["minha", "de-outra-loja"] }) as never);
    expect(recusa.status).toBe(400);
    expect((await recusa.json()).error).toContain("não é desta loja");
    expect(banco.update).toBeNull();

    banco.produtosDaLoja = 2;
    const ok = await PATCH(pedido({ catalogPdfCapaFotos: ["a", "b", "a"] }) as never);
    expect(ok.status).toBe(200);
    expect(banco.update!.data.catalogPdfCapaFotos).toBe('["a","b"]');
    // quatro peças não passam na porta
    expect((await PATCH(pedido({ catalogPdfCapaFotos: ["1", "2", "3", "4"] }) as never)).status).toBe(400);
  });

  it("título e linha chegam aparados, e vazio vira nulo", async () => {
    const { PATCH } = await import("@/app/api/company/route");
    await PATCH(pedido({ catalogPdfTitulo: "  Coleção  Verão ", catalogPdfSubtitulo: "   " }) as never);
    expect(banco.update!.data.catalogPdfTitulo).toBe("Coleção Verão");
    expect(banco.update!.data.catalogPdfSubtitulo).toBeNull();
  });

  it("é identidade visual: vendedora e suporte não gravam capa", async () => {
    const { PATCH } = await import("@/app/api/company/route");
    banco.user = { id: "u2", companyId: "loja1", role: "SELLER" };
    expect((await PATCH(pedido({ catalogPdfCapaFaixa: false }) as never)).status).toBe(403);
    banco.user = { id: "u3", companyId: "loja1", role: "SUPPORT" };
    expect((await PATCH(pedido({ catalogPdfTitulo: "x" }) as never)).status).toBe(403);
    expect(banco.update).toBeNull();
  });
});

describe("o PDF com a capa da loja (o gerador e a rota, com banco simulado)", () => {
  it("com a capa da loja abrindo, as peças escolhidas NEM são lidas; se ela não abre, a automática sai com elas", async () => {
    const { gerarCatalogoPdf } = await import("@/lib/catalogo/pdf");
    const identidade = {
      nome: "Loja",
      tagline: null,
      whatsapp: null,
      primary: "#95442A",
      secondary: "#F3E9DD",
      bg: "#FBF7F2",
      logo: null,
      cores: [],
    };
    // JPEG "de mentira": tem a assinatura, mas o pdf-lib não abre
    const quebrada = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200, 1)]);
    const r = await gerarCatalogoPdf([], {
      identidade,
      capa: { imagem: quebrada, faixa: true, titulo: "🔥🔥", fotoIds: ["foto-escolhida"] },
      geradoEm: new Date(),
      semCores: false,
      restante: () => 45_000,
    });
    expect(r.paginas).toBe(1); // a capa automática saiu — o PDF não quebrou
    expect(fotos.pedidas[0]).toContain("foto-escolhida");
    // e a capa de verdade sai com UMA página também
    const boa = await prepararCapaEnviada(await imagem(1240, 1754));
    if (!boa.ok) throw new Error(boa.erro);
    fotos.pedidas = [];
    const ok = await gerarCatalogoPdf([], {
      identidade,
      capa: { imagem: capaGuardadaParaOPdf(boa.imagem), faixa: false, fotoIds: ["foto-escolhida"] },
      geradoEm: new Date(),
      semCores: false,
      restante: () => 45_000,
    });
    expect(ok.paginas).toBe(1);
    expect(fotos.pedidas[0]).not.toContain("foto-escolhida"); // nenhuma foto a mais no arquivo
  });

  it("a rota lê a capa da tabela própria e só peça ATIVA da loja para a capa automática", async () => {
    const { GET } = await import("@/app/api/catalogo/pdf/route");
    const res = await GET(new NextRequest("https://www.atacadopro.com/api/catalogo/pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(banco.capaLida[0]).toMatchObject({ where: { companyId: "loja1" } });
    expect(banco.findManyProdutos[0]).toMatchObject({
      where: { id: { in: ["p-escolhido"] }, companyId: "loja1", active: true },
    });
    // a foto da peça escolhida foi pedida para a capa
    expect(fotos.pedidas[0]).toContain("foto-escolhida");
  });
});
