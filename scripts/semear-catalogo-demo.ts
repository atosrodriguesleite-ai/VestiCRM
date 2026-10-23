/**
 * Semeia uma loja de demonstração para COMPARAR o catálogo web com o PDF.
 *
 * Não faz parte da entrega: é a bancada que permite tirar o print da tela e
 * pôr lado a lado com a página do PDF. Rodar com o Postgres local.
 *
 *   npx tsx scripts/semear-catalogo-demo.ts
 */

import sharp from "sharp";
import { db } from "../src/lib/db";
import { bufferToDataUrl } from "../src/lib/img-server";

const SLUG = "demo-pdf";

const CATEGORIAS = ["Conjuntos", "Blusas", "Vestidos", "Shorts"];
const CORES: [string, string][] = [
  ["Preto", "#1c1c1c"],
  ["Avelã", "#b89b7a"],
  ["Azul Serenity", "#9db7d4"],
  ["Verde Militar", "#5b6b4a"],
  ["Off-white", "#f0ece4"],
  ["Terracota", "#b4572f"],
];
const TAMANHOS = ["PP", "P", "M", "G", "GG"];

/** uma "foto de peça": silhueta sobre fundo claro, com trama (ruído) */
async function foto(hex: string, semente: number): Promise<string> {
  const buf = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: { r: 242, g: 239, b: 234 } },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 540,
            height: 820,
            channels: 3,
            background: hex,
            noise: { type: "gaussian", mean: 128, sigma: 14 },
          },
        })
          .png()
          .toBuffer(),
        top: 150,
        left: 180,
        blend: "multiply",
      },
      {
        input: Buffer.from(
          `<svg width="900" height="1200"><rect x="180" y="150" width="540" height="820" fill="${hex}" opacity="0.92"/><rect x="330" y="150" width="240" height="90" fill="#f2efea"/><text x="40" y="${1150 - (semente % 40) * 2}" font-size="26" fill="#9a9a9a">${semente}</text></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 84 })
    .toBuffer();
  return bufferToDataUrl(buf, "image/jpeg");
}

async function main() {
  await db.company.deleteMany({ where: { slug: SLUG } });

  const logo = await sharp({
    create: { width: 520, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="520" height="160"><text x="260" y="104" font-size="74" font-family="Georgia,serif" fill="#ffffff" text-anchor="middle">Toque Leve</text></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const company = await db.company.create({
    data: {
      slug: SLUG,
      name: "Toque Leve",
      tagline: "moda feminina no atacado",
      whatsapp: "(33) 98821-5434",
      logoUrl: bufferToDataUrl(logo, "image/png"),
      catalogPriceMode: "ATACADO",
      catalogPrimary: "#95442A",
      catalogSecondary: "#F3E9DD",
      catalogBg: "#FBF7F2",
      categoryOrder: JSON.stringify(CATEGORIAS),
      minOrder: 6,
    },
  });

  await db.companyColor.createMany({
    data: CORES.map(([name, hex]) => ({ companyId: company.id, name, hex })),
  });

  let n = 0;
  for (const categoria of CATEGORIAS) {
    for (let i = 0; i < 6; i++) {
      n++;
      const cores = CORES.slice(i % 3, (i % 3) + 2 + (i % 3));
      const fotos = await Promise.all(cores.map(([, hex], j) => foto(hex, n * 10 + j)));
      await db.product.create({
        data: {
          companyId: company.id,
          name: `${categoria.replace(/s$/, "")} ${["Alice", "Bruna", "Carla", "Duda", "Elis", "Flor"][i]}`,
          sku: `SKU-${n}`,
          category: categoria,
          retailPrice: 89.9 + (i % 4) * 20,
          wholesalePrice: 44.9 + (i % 4) * 10,
          minQuantity: i % 2 === 0 ? 4 : 1,
          active: true,
          images: {
            create: cores.map(([name], j) => ({ url: fotos[j], color: name, order: j })),
          },
          variants: {
            create: cores.flatMap(([color]) =>
              TAMANHOS.slice(0, 3 + (i % 3)).map((size, k) => ({
                color,
                size,
                stock: i === 2 && k === 1 ? 0 : 4 + ((i + k) % 9),
              }))
            ),
          },
        },
      });
    }
  }

  console.log(`loja ${SLUG} semeada — /catalogo/${SLUG}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
