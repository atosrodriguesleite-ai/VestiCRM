// Guarda RN-071
import { describe, it, expect } from "vitest";
import {
  VALIDADE_DO_LINK_DE_FOTOS_MS,
  linkDeFotosVivo,
  mensagemDoLinkDeFotos,
  montarGaleria,
  nomeDoArquivoDaFoto,
  normalizarCategorias,
  urlDoCatalogoDoLink,
  urlDoLinkDeFotos,
} from "../fotos/regra";
import { disposicaoDoDownload, downloadHref, extensaoDaImagem, nomeDoDownload } from "../img";
import { chavesDoEventoDeFotos } from "../rate-limit";

/**
 * RN-071 · FOTOS PARA A CLIENTE: link de 7 dias, galeria SEM preço, download
 * foto a foto (sem ZIP), filtro vivo sobre as fotos do catálogo.
 */

const produtos = [
  {
    id: "p1", name: "Regata Alça", category: "Regatas",
    images: [
      { id: "f2", color: "Preto", order: 1 },
      { id: "f1", color: null, order: 0 },
      { id: "f5", color: "Branco", order: 2 },
      { id: "f6", color: "Estampa", order: 3 }, // rótulo que não é cor da grade
    ],
    variants: [{ color: "Preto", stock: 3 }, { color: "Branco", stock: 0 }],
  },
  {
    id: "p2", name: "Baby Look", category: "Blusas",
    images: [{ id: "f3", color: null, order: 0 }],
    variants: [{ color: "Azul", stock: 0 }],
  },
  { id: "p3", name: "Sem foto", category: "Blusas", images: [], variants: [{ color: "Azul", stock: 9 }] },
  {
    id: "p4", name: "Avental", category: "  ",
    images: [{ id: "f4", color: null, order: 0 }],
    variants: [{ color: null, stock: 2 }],
  },
];

describe("montarGaleria: filtro vivo sobre as fotos do catálogo", () => {
  it("todas as categorias, só com estoque: a peça zerada e a sem foto ficam fora; categorias e peças em ordem", () => {
    const g = montarGaleria(produtos, { categorias: [], soComEstoque: true });
    expect(g.map((c) => c.categoria)).toEqual(["Outros", "Regatas"]); // Blusas só tinha a zerada e a sem foto
    const regatas = g[1];
    expect(regatas.pecas[0].nome).toBe("Regata Alça");
    // ordem da ficha; a foto do Branco (cor ZERADA) fica fora, a sem cor e a
    // de rótulo que não é cor da grade ficam — a cliente não posta o que a
    // loja não tem (achado da revisão)
    expect(regatas.pecas[0].fotos.map((f) => f.id)).toEqual(["f1", "f2", "f6"]);
    expect(regatas.pecas[0].cores).toEqual(["Preto"]); // só a cor com estoque
    expect(regatas.fotos).toBe(3);
  });

  it("peça cujas fotos são todas de cores zeradas some, mesmo tendo outra cor em estoque", () => {
    const g = montarGaleria(
      [{ id: "p9", name: "Cropped", category: "Blusas", images: [{ id: "f9", color: "Rosa", order: 0 }], variants: [{ color: "Rosa", stock: 0 }, { color: "Preto", stock: 4 }] }],
      { categorias: [], soComEstoque: true }
    );
    expect(g).toEqual([]);
  });

  it("sem a trava de estoque a peça zerada entra com TODAS as fotos e cores; a sem foto nunca", () => {
    const g = montarGaleria(produtos, { categorias: [], soComEstoque: false });
    const blusas = g.find((c) => c.categoria === "Blusas")!;
    expect(blusas.pecas.map((p) => p.nome)).toEqual(["Baby Look"]);
    const regata = g.find((c) => c.categoria === "Regatas")!.pecas[0];
    expect(regata.fotos).toHaveLength(4);
    expect(regata.cores).toEqual(["Preto", "Branco"]);
  });

  it("categorias escolhidas recortam (sem ligar para caixa); categoria sem peça não aparece", () => {
    const g = montarGaleria(produtos, { categorias: ["regatas", "Vestidos"], soComEstoque: true });
    expect(g.map((c) => c.categoria)).toEqual(["Regatas"]);
  });

  it("NUNCA carrega preço: a galeria é só foto, nome e cores", () => {
    const g = montarGaleria(produtos, { categorias: [], soComEstoque: true });
    for (const p of g.flatMap((c) => c.pecas)) {
      expect(Object.keys(p).sort()).toEqual(["cores", "fotos", "id", "nome"]);
    }
  });
});

describe("regras do link", () => {
  it("vale 7 dias; vencido não vale", () => {
    expect(VALIDADE_DO_LINK_DE_FOTOS_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const agora = new Date("2026-10-07T12:00:00Z");
    expect(linkDeFotosVivo({ expiresAt: new Date("2026-10-14T12:00:01Z") }, agora)).toBe(true);
    expect(linkDeFotosVivo({ expiresAt: new Date("2026-10-07T11:59:59Z") }, agora)).toBe(false);
  });

  it("categorias da tela viram lista limpa (sem repetição, sem vazio, com teto); lixo vira 'todas'", () => {
    expect(normalizarCategorias(["Regatas", " Regatas", "", "Blusas", 7])).toEqual(["Regatas", "Blusas"]);
    expect(normalizarCategorias("tudo")).toEqual([]);
    expect(normalizarCategorias(Array.from({ length: 100 }, (_, i) => `c${i}`))).toHaveLength(60);
  });

  it("URL curta no domínio de catálogos, interna sem ele", () => {
    expect(urlDoLinkDeFotos("toque-leve", "abc123", "catalago.net")).toBe("https://catalago.net/toque-leve/fotos/abc123");
    expect(urlDoLinkDeFotos("toque-leve", "abc123", null)).toBe("/catalogo/toque-leve/fotos/abc123");
  });

  it("o catálogo da galeria leva a vendedora do link (RN-005); sem vendedora, o catálogo puro", () => {
    expect(urlDoCatalogoDoLink("https://catalago.net/toque-leve", "julia")).toBe("https://catalago.net/toque-leve?ref=julia");
    expect(urlDoCatalogoDoLink("https://catalago.net/toque-leve", null)).toBe("https://catalago.net/toque-leve");
  });

  it("a saudação sem nome de verdade não diz 'Oi, Contato!'", () => {
    expect(mensagemDoLinkDeFotos({ nomeDaCliente: "", url: "u", categorias: [] })).toContain("Oi, tudo bem!");
  });

  it("o beacon da galeria tem ritmo por IP (RN-044); sem IP, não trava", () => {
    expect(chavesDoEventoDeFotos("1.2.3.4")).toEqual(["fotosev:1.2.3.4"]);
    expect(chavesDoEventoDeFotos(null)).toEqual([]);
  });

  it("a mensagem diz do que são as fotos e que o link vale 7 dias", () => {
    const m = mensagemDoLinkDeFotos({ nomeDaCliente: "Livia Preisigke", url: "https://x/y", categorias: [] });
    expect(m).toContain("Oi, Livia!");
    expect(m).toContain("de todas as peças");
    expect(m).toContain("https://x/y");
    expect(m).toContain("7 dias");
    expect(mensagemDoLinkDeFotos({ nomeDaCliente: "Ana", url: "u", categorias: ["Regatas", "Blusas"] })).toContain("de Regatas, Blusas");
    expect(mensagemDoLinkDeFotos({ nomeDaCliente: "Ana", url: "u", categorias: ["A", "B", "C", "D", "E"] })).toContain("de A, B e mais 3 categorias");
  });
});

describe("download foto a foto (sem ZIP): nome legível e cabeçalho de arquivo", () => {
  it("o nome do arquivo é peça - cor, numerado a partir da segunda foto", () => {
    expect(nomeDoArquivoDaFoto("Regata Alça", "Preto", 0)).toBe("Regata Alça - Preto");
    expect(nomeDoArquivoDaFoto("Regata Alça", null, 2)).toBe("Regata Alça 3");
    expect(nomeDoArquivoDaFoto('Blusa "Luxo" / 2', null, 0)).toBe("Blusa Luxo 2");
  });

  it("?baixar=1 traz o nome do arquivo (sem controle, aspas e barras); sem ele, nada", () => {
    expect(nomeDoDownload(new URLSearchParams("v=2"))).toBeNull();
    expect(nomeDoDownload(new URLSearchParams("baixar=1&nome=Regata%20Al%C3%A7a%20-%20Preto"))).toBe("Regata Alça - Preto");
    expect(nomeDoDownload(new URLSearchParams({ baixar: "1", nome: 'a"b\r\nc/d' }))).toBe("a b c d");
    expect(nomeDoDownload(new URLSearchParams("baixar=1"))).toBe("foto");
    expect(downloadHref("f1", "Regata Alça")).toBe("/api/img/f1?v=2&baixar=1&nome=Regata%20Al%C3%A7a");
  });

  it("o cabeçalho de arquivo tem o nome simples em ASCII e o completo em UTF-8 — emoji no nome da peça não derruba o download", () => {
    const d = disposicaoDoDownload("Regata Alça - Preto", "image/jpeg");
    expect(d).toBe(`attachment; filename="Regata Alca - Preto.jpg"; filename*=UTF-8''Regata%20Al%C3%A7a%20-%20Preto.jpg`);
    const e = disposicaoDoDownload("Blusa ✨ Luxo – Festa", "image/jpeg");
    expect(e).toContain('filename="Blusa Luxo Festa.jpg"');
    expect(e).toContain(`filename*=UTF-8''${encodeURIComponent("Blusa ✨ Luxo – Festa")}.jpg`);
    // o que fica no filename simples tem que caber num cabeçalho HTTP
    expect(() => new Headers({ "Content-Disposition": e })).not.toThrow();
    expect(disposicaoDoDownload("✨", "image/jpeg")).toContain('filename="foto.jpg"');
  });

  it("a extensão é a do tipo REAL da foto: png não vira .jpg", () => {
    expect(extensaoDaImagem("image/png")).toBe("png");
    expect(extensaoDaImagem("image/webp")).toBe("webp");
    expect(extensaoDaImagem("image/jpeg")).toBe("jpg");
    expect(extensaoDaImagem("")).toBe("jpg");
    expect(disposicaoDoDownload("Regata", "image/png")).toContain('filename="Regata.png"; filename*=UTF-8\'\'Regata.png');
  });
});
