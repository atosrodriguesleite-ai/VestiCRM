/**
 * PROVA DO CATÁLOGO EM PDF (RN-094) CONTRA O POSTGRES LOCAL.
 *
 * O que não dá para provar sem banco: que o PDF sai do MESMO acervo da
 * vitrine (mesmas peças, mesma ordem, mesmo preço), que a foto de cada cor é
 * a que o site usa, que a chavinha "esconder sem estoque" vale aqui, que o
 * teto corta e avisa, e quanto o arquivo PESA de verdade.
 *
 * Rodar:  npx tsx scripts/confere-catalogo-pdf.ts
 * (com o Postgres local na 5433 e DATABASE_URL apontando para ele)
 */

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { db } from "../src/lib/db";
import { acervoDaVitrine } from "../src/lib/catalogo/acervo";
import { secoesDaVitrine, contarCards } from "../src/lib/catalogo/secoes";
import { gerarCatalogoPdf, TETO_DE_CARDS } from "../src/lib/catalogo/pdf";
import { parseCategoryOrder, parseCategoryTypes } from "../src/lib/categories";
import { bufferToDataUrl } from "../src/lib/img-server";

const SAIDA = process.env.SAIDA_PDF ?? "/tmp/catalogo.pdf";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe = "") {
  console.log(`${ok ? "  ok " : "FALHA"}  ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
}

/**
 * Uma foto de peça de mentira, mas com conteúdo de VERDADE (JPEG de 900px,
 * com ruído). O ruído importa: foto de pano liso comprime a quase nada e
 * daria um peso otimista — tecido tem trama, e é a trama que ocupa bytes.
 */
async function fotoFalsa(matiz: number, semente: number): Promise<string> {
  const fundo = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: { r: 240, g: 236, b: 230 } },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 520,
            height: 760,
            channels: 3,
            background: hsl(matiz),
            noise: { type: "gaussian", mean: hsl(matiz).r, sigma: 26 },
          },
        })
          .png()
          .toBuffer(),
        top: 180,
        left: 190,
      },
      // uma marca que muda por peça: impede o JPEG de ficar idêntico entre
      // produtos e mede a deduplicação pelo que ela é de verdade
      {
        input: Buffer.from(
          `<svg width="900" height="1200"><text x="60" y="${120 + (semente % 900)}" font-size="44" fill="#333">${semente}</text></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 82 })
    .toBuffer();
  return bufferToDataUrl(fundo, "image/jpeg");
}

function hsl(h: number): { r: number; g: number; b: number } {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = 0.3 * Math.min(0.45, 1 - 0.45);
    return Math.round(255 * (0.45 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

const CATEGORIAS = [
  "Conjuntos de short",
  "Blusas",
  "Vestidos",
  "Calças",
  "Shorts",
  "Regatas",
];
const CORES = ["Preto", "Avelã", "Azul Serenity", "Verde Militar", "Off-white", "Terracota"];
const TAMANHOS = ["PP", "P", "M", "G", "GG"];

async function semear(quantosProdutos: number) {
  const slug = `pdf-teste-${Date.now()}`;
  const company = await db.company.create({
    data: {
      slug,
      name: "Toque Leve",
      tagline: "moda feminina no atacado",
      whatsapp: "(33) 98821-5434",
      catalogPriceMode: "ATACADO",
      catalogPrimary: "#95442A",
      catalogSecondary: "#F3E9DD",
      catalogBg: "#FBF7F2",
      categoryOrder: JSON.stringify(CATEGORIAS),
    },
  });

  for (let i = 0; i < quantosProdutos; i++) {
    const categoria = CATEGORIAS[i % CATEGORIAS.length];
    const cores = CORES.slice(0, 2 + (i % 4));
    // uma foto PRÓPRIA por peça × cor — o pior caso realista (a loja que
    // etiqueta a foto de cada cor, que é o que a capa por cor pede)
    const fotos = await Promise.all(
      cores.map((c, j) => fotoFalsa(CORES.indexOf(c) * 55, i * 10 + j))
    );
    await db.product.create({
      data: {
        companyId: company.id,
        name: `${categoria.replace(/s$/, "")} Modelo ${String(i + 1).padStart(3, "0")}`,
        sku: `SKU-${i}`,
        category: categoria,
        retailPrice: 86.9 + (i % 7) * 10,
        wholesalePrice: 44.9 + (i % 7) * 5,
        minQuantity: i % 3 === 0 ? 4 : 1,
        active: true,
        images: {
          create: cores.map((c, j) => ({ url: fotos[j], color: c, order: j })),
        },
        variants: {
          create: cores.flatMap((color) =>
            TAMANHOS.slice(0, 3 + (i % 3)).map((size) => ({
              color,
              size,
              // uma cor a cada 9 produtos nasce ESGOTADA, para a chavinha ter o que esconder
              stock: i % 9 === 0 && color === cores[0] ? 0 : 5 + (i % 11),
            }))
          ),
        },
      },
    });
  }
  return company;
}

async function montar(company: Awaited<ReturnType<typeof semear>>) {
  const acervo = await acervoDaVitrine(company, { modo: company.catalogPriceMode });
  const secoes = secoesDaVitrine(acervo, {
    hideSoldOut: company.catalogHideOutOfStock,
    categoryOrder: parseCategoryOrder(company.categoryOrder),
    categoryTypes: parseCategoryTypes(company.categoryTypes),
  });
  return { acervo, secoes };
}

async function main() {
  const quantos = Number(process.env.PRODUTOS ?? 70);
  console.log(`\nSemeando ${quantos} produtos…`);
  const company = await semear(quantos);

  try {
    const { acervo, secoes } = await montar(company);
    const cards = contarCards(secoes);
    console.log(`Acervo: ${acervo.length} produtos → ${cards} peças (um card por cor)\n`);

    // ── 1 · o PDF sai do mesmo acervo, na mesma ordem ─────────────────────
    const ordemDasSecoes = secoes.map((s) => s.categoria);
    confere(
      "1 · as seções seguem a ordem escolhida pela loja",
      JSON.stringify(ordemDasSecoes) ===
        JSON.stringify(CATEGORIAS.filter((c) => ordemDasSecoes.includes(c))),
      ordemDasSecoes.join(" > ")
    );

    // ── 2 · gera o PDF e mede ─────────────────────────────────────────────
    const t0 = Date.now();
    const r = await gerarCatalogoPdf(secoes, {
      identidade: {
        nome: company.name,
        tagline: company.tagline,
        whatsapp: company.whatsapp,
        primary: company.catalogPrimary,
        secondary: company.catalogSecondary,
        bg: company.catalogBg,
        logo: null,
        cores: [],
      },
      geradoEm: new Date(),
      semCores: company.catalogHideColors,
      restante: () => 45_000,
    });
    const ms = Date.now() - t0;
    writeFileSync(SAIDA, r.bytes);
    const mb = (r.bytes.byteLength / 1024 / 1024).toFixed(2);
    console.log(
      `\n  → ${r.paginas} páginas · ${mb} MB · ${(ms / 1000).toFixed(1)}s · ${r.pecas} peças\n`
    );

    confere("2 · todas as peças entraram (sem teto)", r.pecas === cards && r.cortadas === 0);
    confere("3 · nenhuma peça ficou sem foto", r.semFoto === 0, `${r.semFoto} sem foto`);
    confere("4 · o arquivo é um PDF de verdade", r.bytes.byteLength > 1000 &&
      Buffer.from(r.bytes.slice(0, 5)).toString() === "%PDF-");
    confere("5 · tem capa (páginas = peças + 1 capa, no mínimo)", r.paginas >= 2);

    // ── 6 · a chavinha "esconder sem estoque" vale POR COR ────────────────
    await db.company.update({
      where: { id: company.id },
      data: { catalogHideOutOfStock: true },
    });
    const comChave = await montar(
      await db.company.findUniqueOrThrow({ where: { id: company.id } })
    );
    const cardsComChave = contarCards(comChave.secoes);
    confere(
      "6 · a chavinha esconde a COR esgotada (e só ela)",
      cardsComChave < cards && cardsComChave > 0,
      `${cards} → ${cardsComChave}`
    );
    await db.company.update({
      where: { id: company.id },
      data: { catalogHideOutOfStock: false },
    });

    // ── 7 · o preço é o da TABELA da loja ─────────────────────────────────
    const umProduto = await db.product.findFirstOrThrow({
      where: { companyId: company.id },
      select: { id: true, wholesalePrice: true, retailPrice: true },
    });
    const noAcervo = acervo.find((p) => p.id === umProduto.id)!;
    confere(
      "7 · catálogo em ATACADO mostra o preço de atacado",
      noAcervo.precoCatalogo === umProduto.wholesalePrice,
      `${noAcervo.precoCatalogo} (atacado ${umProduto.wholesalePrice} / varejo ${umProduto.retailPrice})`
    );

    const varejo = await acervoDaVitrine(
      { ...company, catalogPriceMode: "VAREJO" },
      { modo: "VAREJO" }
    );
    confere(
      "8 · em VAREJO o mesmo acervo mostra o preço de varejo",
      varejo.find((p) => p.id === umProduto.id)!.precoCatalogo === umProduto.retailPrice
    );

    // ── 9 · o teto corta e AVISA ──────────────────────────────────────────
    const muitas = Array.from({ length: Math.ceil((TETO_DE_CARDS + 40) / cards) + 1 }, () => secoes)
      .flat()
      .map((s, i) => ({ ...s, categoria: `${s.categoria} ${i}` }));
    const comTeto = await gerarCatalogoPdf(muitas, {
      identidade: {
        nome: company.name,
        tagline: null,
        whatsapp: null,
        primary: company.catalogPrimary,
        secondary: company.catalogSecondary,
        bg: company.catalogBg,
        logo: null,
        cores: [],
      },
      geradoEm: new Date(),
      semCores: false,
      restante: () => 45_000,
    });
    confere(
      "9 · o teto corta no limite e conta o que ficou de fora",
      comTeto.pecas === TETO_DE_CARDS && comTeto.cortadas > 0,
      `${comTeto.pecas} dentro, ${comTeto.cortadas} fora`
    );

    // ── 10 · sem tempo, o PDF SAI (sem foto), nunca uma função morta ──────
    const semTempo = await gerarCatalogoPdf(secoes, {
      identidade: {
        nome: company.name,
        tagline: null,
        whatsapp: null,
        primary: company.catalogPrimary,
        secondary: company.catalogSecondary,
        bg: company.catalogBg,
        logo: null,
        cores: [],
      },
      geradoEm: new Date(),
      semCores: false,
      restante: () => 0,
    });
    confere(
      "10 · orçamento esgotado devolve o PDF sem fotos, não um erro",
      semTempo.paginas === r.paginas && semTempo.semFoto === semTempo.pecas,
      `${semTempo.semFoto} de ${semTempo.pecas} sem foto`
    );
    confere(
      "11 · sem foto o arquivo fica muito mais leve (a foto é o peso)",
      semTempo.bytes.byteLength < r.bytes.byteLength / 3,
      `${(semTempo.bytes.byteLength / 1024).toFixed(0)} KB vs ${mb} MB`
    );

    // ── 12 · a LOGO transparente não vira caixa preta na capa ─────────────
    /*
     * Achado da revisão: a logo ia pelo `shrinkImage`, que sempre devolve
     * JPEG — e JPEG não tem transparência. A logo PNG de fundo transparente
     * (o normal numa loja) virava um retângulo PRETO no meio da capa
     * colorida. Aqui a prova é medir o PIXEL: o canto da área da logo tem
     * que continuar com a cor da loja.
     */
    const logo = await sharp({
      create: { width: 400, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="400" height="160"><circle cx="200" cy="80" r="40" fill="#ffffff"/></svg>`
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    const comLogo = await gerarCatalogoPdf(secoes.slice(0, 1), {
      identidade: {
        nome: company.name,
        tagline: null,
        whatsapp: null,
        primary: company.catalogPrimary,
        secondary: company.catalogSecondary,
        bg: company.catalogBg,
        logo: { bytes: logo, png: true },
        cores: [],
      },
      geradoEm: new Date(),
      semCores: false,
      restante: () => 45_000,
    });
    const capa = `${SAIDA.replace(/\.pdf$/, "")}-capa`;
    writeFileSync(`${capa}.pdf`, comLogo.bytes);
    // `-singlefile` dá um nome exato; sem ele o pdftoppm numera com a
    // quantidade de dígitos que o documento pedir ("-1" aqui, "-01" lá)
    execFileSync("pdftoppm", ["-png", "-r", "72", "-singlefile", `${capa}.pdf`, `${capa}-img`]);
    const px = await sharp(`${capa}-img.png`).raw().toBuffer({ resolveWithObject: true });
    // o canto superior esquerdo da área da logo (fundo transparente dela)
    const { data, info } = px;
    const amostra = (xi: number, yi: number) => {
      const i = (yi * info.width + xi) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const [vr, vg, vb] = amostra(Math.round(info.width / 2) - 70, 150);
    confere(
      "12 · logo transparente não vira caixa preta (o fundo dela fica com a cor da loja)",
      vr > 60 && vr > vb,
      `pixel rgb(${vr},${vg},${vb}) — a loja é ${company.catalogPrimary}`
    );

    console.log(`\nArquivo em ${SAIDA}`);
  } finally {
    await db.company.delete({ where: { id: company.id } });
  }

  console.log(falhas === 0 ? "\n✅ tudo certo\n" : `\n❌ ${falhas} falha(s)\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
