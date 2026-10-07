// Guarda RN-070
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";

/**
 * A LOGO DA LOJA VAI POR ENDEREÇO, NUNCA DENTRO DA PÁGINA (RN-070).
 *
 * Relato do dono (07/10/2026): a cliente abria o catálogo pelo WhatsApp e via
 * a tela preta do iPhone. A logo (data-URL do banco) ia embutida na página
 * três vezes, e a primeira cópia, no topo, segurava a primeira pintura — 18 s
 * num 4G fraco com uma logo pesada. Aqui se prova o comportamento: a vitrine
 * montada não carrega a data-URL, e a rota da logo só entrega imagem de
 * verdade, com cache forte apenas na versão certa.
 */

const estado = vi.hoisted(() => ({
  lojas: new Map<string, { id: string; slug: string; logoUrl: string | null; suspended: boolean }>(),
  produtos: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    company: {
      findUnique: async ({ where }: { where: { slug: string } }) => {
        const l = estado.lojas.get(where.slug);
        return l
          ? {
              ...l,
              name: "Loja Teste",
              tagline: null,
              whatsapp: "11999990000",
              catalogPriceMode: "VAREJO",
              priceTablesEnabled: false,
              catalogHideOutOfStock: false,
              catalogHideColors: false,
              catalogLogoSize: "normal",
              catalogPrimary: "#111111",
              catalogSecondary: "#ffffff",
              catalogBg: "#ffffff",
              catalogFont: "inter",
              catalogFormFields: null,
              categoryOrder: null,
              categoryDescriptions: null,
              categoryTypes: null,
              categoryUnits: null,
              minOrder: 0,
              minOrderMode: "NONE",
              minOrderValue: 0,
            }
          : null;
      },
    },
    product: { findMany: async () => estado.produtos },
    promoCatalog: {
      findUnique: async () => ({
        active: true,
        name: "Campanha",
        slug: "promo",
        discount: 10,
        products: [{ productId: "p1" }],
      }),
    },
    companyColor: { findMany: async () => [] },
  },
}));

// a vitrine em si (fontes do Next, navegador) não interessa aqui: o teste olha
// os DADOS que o servidor entrega a ela
vi.mock("../../app/catalogo/[slug]/public-catalog", () => ({ PublicCatalog: () => null }));

import { enderecoDaLogo, versaoDaLogo } from "../catalogo/logo-da-loja";
import { GET } from "../../app/api/img/logo/[slug]/route";
import { montarCatalogo } from "../../app/catalogo/[slug]/montar-catalogo";
import PromoCatalogPage from "../../app/catalogo/[slug]/c/[promo]/page";

async function pngDataUrl(lado: number, ruido = false): Promise<string> {
  const canais = 4;
  const raw = Buffer.alloc(lado * lado * canais);
  let s = 7;
  for (let i = 0; i < raw.length; i += canais) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = ruido ? s & 255 : 196;
    raw[i + 1] = ruido ? (s >> 8) & 255 : 98;
    raw[i + 2] = ruido ? (s >> 16) & 255 : 45;
    raw[i + 3] = 128; // meio transparente: o PNG tem que continuar com canal alfa
  }
  const buf = await sharp(raw, { raw: { width: lado, height: lado, channels: canais } }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function pedir(slug: string, v?: string) {
  const url = `http://localhost/api/img/logo/${slug}${v !== undefined ? `?v=${v}` : ""}`;
  return GET(new NextRequest(url), { params: Promise.resolve({ slug }) });
}

beforeEach(() => {
  estado.lojas.clear();
  estado.produtos = [];
});

describe("o endereço da logo (RN-070)", () => {
  it("data-URL vira endereço curto, com a versão do CONTEÚDO", () => {
    const logo = "data:image/png;base64,AAAA";
    const end = enderecoDaLogo({ slug: "toque-leve", logoUrl: logo });
    expect(end).toBe(`/api/img/logo/toque-leve?v=${versaoDaLogo(logo)}`);
    // mesma logo, mesmo endereço; logo trocada, endereço novo na hora
    expect(enderecoDaLogo({ slug: "toque-leve", logoUrl: logo })).toBe(end);
    expect(enderecoDaLogo({ slug: "toque-leve", logoUrl: "data:image/png;base64,BBBB" })).not.toBe(end);
  });

  it("logo SVG (ou outro tipo que a rota não serve) segue embutida, como sempre foi", () => {
    // a rota só entrega PNG/JPEG/WebP/GIF: mandar o SVG para lá trocaria uma
    // logo que funcionava por imagem quebrada
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(enderecoDaLogo({ slug: "x", logoUrl: svg })).toBe(svg);
    expect(enderecoDaLogo({ slug: "x", logoUrl: "data:image/bmp;base64,Qk0=" })).toBe("data:image/bmp;base64,Qk0=");
    for (const t of ["png", "jpeg", "jpg", "webp", "gif", "PNG"]) {
      expect(enderecoDaLogo({ slug: "x", logoUrl: `data:image/${t};base64,AAAA` })).toMatch(/^\/api\/img\/logo\/x\?v=/);
    }
  });

  it("sem logo é null; link externo já é endereço e passa como está", () => {
    expect(enderecoDaLogo({ slug: "x", logoUrl: null })).toBeNull();
    expect(enderecoDaLogo({ slug: "x", logoUrl: "   " })).toBeNull();
    expect(enderecoDaLogo({ slug: "x", logoUrl: "https://cdn.exemplo.com/logo.png" })).toBe(
      "https://cdn.exemplo.com/logo.png"
    );
  });
});

describe("a vitrine montada NÃO carrega a logo dentro da página (RN-070)", () => {
  it("o catálogo entrega o endereço curto, nunca a data-URL", async () => {
    const logo = await pngDataUrl(300, true);
    estado.lojas.set("toque-leve", { id: "c1", slug: "toque-leve", logoUrl: logo, suspended: false });
    const vitrine = (await montarCatalogo({ slug: "toque-leve", sp: {} })) as {
      props: { identity: { logoUrl: string | null } };
    };
    const enviada = vitrine.props.identity.logoUrl;
    expect(enviada).toBe(`/api/img/logo/toque-leve?v=${versaoDaLogo(logo)}`);
    expect(enviada!.length).toBeLessThan(100);
    expect(JSON.stringify(vitrine.props)).not.toContain("data:image");
  });

  it("o catálogo de CAMPANHA também entrega o endereço curto", async () => {
    // ele monta a vitrine por conta própria (produtos escolhidos e desconto);
    // a logo crua ali reabriria a tela preta só nos links de campanha
    const logo = await pngDataUrl(300, true);
    estado.lojas.set("toque-leve", { id: "c1", slug: "toque-leve", logoUrl: logo, suspended: false });
    estado.produtos = [
      {
        id: "p1", name: "Regata", sku: "R1", category: "Blusas", collection: null, description: null,
        retailPrice: 50, wholesalePrice: 30, minQuantity: 1, tags: [], unidade: null,
        images: [{ id: "i1", color: null }], variants: [{ color: "Preto", size: "M", stock: 3 }],
      },
    ];
    const vitrine = (await PromoCatalogPage({
      params: Promise.resolve({ slug: "toque-leve", promo: "promo" }),
      searchParams: Promise.resolve({}),
    })) as { props: { identity: { logoUrl: string | null } } };
    expect(vitrine.props.identity.logoUrl).toBe(`/api/img/logo/toque-leve?v=${versaoDaLogo(logo)}`);
    expect(JSON.stringify(vitrine.props)).not.toContain("data:image");
  });
});

describe("a rota da logo (RN-070)", () => {
  it("entrega a logo como imagem de verdade, com nosniff", async () => {
    const logo = await pngDataUrl(64);
    estado.lojas.set("loja", { id: "c1", slug: "loja", logoUrl: logo, suspended: false });
    const r = await pedir("loja", versaoDaLogo(logo));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const corpo = Buffer.from(await r.arrayBuffer());
    expect((await sharp(corpo).metadata()).format).toBe("png");
  });

  it("cache forte SÓ quando a versão confere — sem ela, ou velha, é curto", async () => {
    const logo = await pngDataUrl(64);
    estado.lojas.set("loja", { id: "c1", slug: "loja", logoUrl: logo, suspended: false });
    const forte = (await pedir("loja", versaoDaLogo(logo))).headers.get("cache-control")!;
    expect(forte).toContain("immutable");
    // na borda, um dia: a loja suspensa sai da CDN no dia seguinte
    expect(forte).toContain("s-maxage=86400");
    expect((await pedir("loja")).headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect((await pedir("loja", "versao-velha")).headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=60"
    );
  });

  it("loja suspensa, inexistente ou sem logo: 404 que a CDN não guarda", async () => {
    const logo = await pngDataUrl(32);
    estado.lojas.set("suspensa", { id: "c1", slug: "suspensa", logoUrl: logo, suspended: true });
    estado.lojas.set("sem-logo", { id: "c2", slug: "sem-logo", logoUrl: null, suspended: false });
    for (const slug of ["suspensa", "sem-logo", "nao-existe"]) {
      const r = await pedir(slug);
      expect(r.status, slug).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("SVG, HTML com rótulo de imagem e lixo NÃO saem daqui", async () => {
    // a logo é gravada por uma rota que aceita qualquer texto: um SVG com
    // script servido no endereço do app rodaria com a sessão de quem abrir
    const casos = [
      `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64")}`,
      `data:image/png;base64,${Buffer.from("<html><script>alert(1)</script></html>").toString("base64")}`,
      "data:image/png;base64,",
      "data:,nada",
      // sem base64, com "%" torto: o decodificador LANÇA — tem que virar 415, não 500
      "data:image/png,%E0%A4%A",
    ];
    for (const [i, logoUrl] of casos.entries()) {
      estado.lojas.set("x", { id: `c${i}`, slug: "x", logoUrl, suspended: false });
      const r = await pedir("x");
      expect(r.status, logoUrl.slice(0, 30)).toBe(415);
      expect(r.headers.get("content-type")).not.toContain("svg");
    }
  });

  it("logo pesada sai menor, no mesmo formato e com a transparência", async () => {
    const logo = await pngDataUrl(1000, true);
    expect(Buffer.from(logo.split(",")[1], "base64").byteLength).toBeGreaterThan(300 * 1024);
    estado.lojas.set("loja", { id: "c1", slug: "loja", logoUrl: logo, suspended: false });
    const r = await pedir("loja", versaoDaLogo(logo));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    expect(meta.format).toBe("png");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(800);
    expect(meta.hasAlpha).toBe(true);
  });

  it("JPEG de celular pesado sai EM PÉ (a orientação da câmera é aplicada)", async () => {
    // 1200 x 600 deitado, com a marca "gire 90°" que a câmera grava
    const raw = Buffer.alloc(1200 * 600 * 3);
    let x = 3;
    for (let i = 0; i < raw.length; i++) raw[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) & 255;
    const jpeg = await sharp(raw, { raw: { width: 1200, height: 600, channels: 3 } })
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(jpeg.byteLength).toBeGreaterThan(300 * 1024);
    const logo = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    estado.lojas.set("loja", { id: "c1", slug: "loja", logoUrl: logo, suspended: false });
    const r = await pedir("loja", versaoDaLogo(logo));
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    expect(meta.height!).toBeGreaterThan(meta.width!);
  });

  it("logo que não emagrece fica como estava (nunca sai maior)", async () => {
    // pequena, de cor chapada: acima do limite só se a gente forçar — aqui ela
    // está abaixo e passa intacta, byte a byte
    const logo = await pngDataUrl(64);
    estado.lojas.set("loja", { id: "c1", slug: "loja", logoUrl: logo, suspended: false });
    const r = await pedir("loja", versaoDaLogo(logo));
    expect(Buffer.from(await r.arrayBuffer()).equals(Buffer.from(logo.split(",")[1], "base64"))).toBe(true);
  });
});
