import { z } from "zod";
import { urlDeFotoAceita } from "./imagem-segura";
import { db } from "./db";
import { slugify } from "./provision";

/**
 * Importação de catálogo por arquivo (.json).
 *
 * Fluxo pensado para a implantação: o catálogo é montado de uma vez (aqui no
 * Claude, a partir de fotos + infos) e sobe pronto para a loja. Diferente de
 * uma página HTML estática, os produtos entram como REGISTROS REAIS e
 * editáveis — a loja continua controlando estoque, inativando esgotados,
 * editando e adicionando itens normalmente.
 *
 * Estoque: cada variação (cor × tamanho) recebe o estoque na seguinte ordem
 * de prioridade: stockByVariant["Cor/Tamanho"] › produto.stock ›
 * defaults.stock › 0. Ou seja, o estoque já sobe definido — não é preciso
 * editar peça por peça.
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONTS = ["montserrat", "inter", "poppins", "playfair", "lora"] as const;

const storeSchema = z
  .object({
    tagline: z.string().optional(),
    whatsapp: z.string().optional(),
    logoUrl: z.string().optional(),
    catalogPrimary: z.string().regex(HEX).optional(),
    catalogSecondary: z.string().regex(HEX).optional(),
    catalogBg: z.string().regex(HEX).optional(),
    catalogFont: z.enum(FONTS).optional(),
    minOrderMode: z.enum(["NONE", "PECAS", "VALOR"]).optional(),
    minOrder: z.number().int().nonnegative().optional(),
    minOrderValue: z.number().nonnegative().optional(),
  })
  .optional();

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  category: z.string().min(1).default("Geral"),
  collection: z.string().optional(),
  description: z.string().optional(),
  retailPrice: z.number().nonnegative().default(0),
  wholesalePrice: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative().optional(),
  minQuantity: z.number().int().positive().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  active: z.boolean().optional(),
  colors: z.array(z.string().min(1)).optional(),
  sizes: z.array(z.string().min(1)).optional(),
  stock: z.number().int().nonnegative().optional(),
  stockByVariant: z.record(z.string(), z.number().int().nonnegative()).optional(),
  // RN-026: mesma régua do cadastro manual
  images: z
    .array(z.string().min(1).refine(urlDeFotoAceita, "Formato de imagem não aceito"))
    .optional(),
});

export const catalogSchema = z.object({
  store: storeSchema,
  palette: z.array(z.object({ name: z.string().min(1), hex: z.string().regex(HEX) })).optional(),
  sizes: z.array(z.string().min(1)).optional(),
  defaults: z
    .object({
      stock: z.number().int().nonnegative().optional(),
      sizes: z.array(z.string().min(1)).optional(),
      minQuantity: z.number().int().positive().optional(),
      category: z.string().optional(),
    })
    .optional(),
  products: z.array(productSchema).min(1, "O catálogo precisa de ao menos 1 produto."),
});

export type CatalogFile = z.infer<typeof catalogSchema>;

export type ImportSummary = {
  productsCreated: number;
  productsUpdated: number;
  variants: number;
  images: number;
  colorsAdded: number;
  sizesAdded: number;
  storeUpdated: boolean;
};

const DEFAULT_HEX = "#C9BEB0";

function tagsToString(t: string | string[] | undefined): string | undefined {
  if (!t) return undefined;
  return Array.isArray(t) ? t.join(",") : t;
}

/** Valida o conteúdo bruto do arquivo. Lança ZodError em caso de formato inválido. */
export function parseCatalog(raw: unknown): CatalogFile {
  return catalogSchema.parse(raw);
}

export async function importCatalog(
  companyId: string,
  data: CatalogFile,
  /**
   * "completo": implantação (cria/atualiza produtos e variações — estoque de
   *   variações JÁ EXISTENTES nunca é alterado; só variações novas entram
   *   com o estoque do arquivo).
   * "fotos": APENAS completa fotos de produtos existentes que estejam sem
   *   nenhuma foto — não cria produto, não toca preço, estoque ou variações.
   */
  mode: "completo" | "fotos" = "completo"
): Promise<ImportSummary> {
  if (mode === "fotos") return importPhotosOnly(companyId, data);
  const summary: ImportSummary = {
    productsCreated: 0,
    productsUpdated: 0,
    variants: 0,
    images: 0,
    colorsAdded: 0,
    sizesAdded: 0,
    storeUpdated: false,
  };

  const defSizes = data.defaults?.sizes ?? [];
  const defStock = data.defaults?.stock ?? 0;
  const defMinQty = data.defaults?.minQuantity ?? 1;
  const defCategory = data.defaults?.category ?? "Geral";

  // ---- Bibliotecas da loja: cores e tamanhos ----
  const hexByColor = new Map<string, string>();
  for (const c of data.palette ?? []) hexByColor.set(c.name, c.hex);

  const allColors = new Set<string>();
  const allSizes = new Set<string>();
  for (const s of data.sizes ?? []) allSizes.add(s);
  for (const s of defSizes) allSizes.add(s);
  for (const p of data.products) {
    for (const c of p.colors ?? []) allColors.add(c);
    for (const s of p.sizes ?? []) allSizes.add(s);
  }

  return db.$transaction(
    async (tx) => {
      // Identidade visual da loja: só na IMPLANTAÇÃO (loja ainda sem
      // produtos). Reimportar um arquivo antigo numa loja em operação não
      // pode sobrescrever logo/cores que o lojista personalizou.
      const productCount = await tx.product.count({ where: { companyId } });
      if (data.store && productCount === 0) {
        await tx.company.update({
          where: { id: companyId },
          data: {
            tagline: data.store.tagline ?? undefined,
            whatsapp: data.store.whatsapp
              ? data.store.whatsapp.replace(/\D/g, "")
              : undefined,
            logoUrl: data.store.logoUrl ?? undefined,
            catalogPrimary: data.store.catalogPrimary ?? undefined,
            catalogSecondary: data.store.catalogSecondary ?? undefined,
            catalogBg: data.store.catalogBg ?? undefined,
            catalogFont: data.store.catalogFont ?? undefined,
            minOrderMode: data.store.minOrderMode ?? undefined,
            minOrder: data.store.minOrder ?? undefined,
            minOrderValue: data.store.minOrderValue ?? undefined,
          },
        });
        summary.storeUpdated = true;
      }

      // Cores
      const existingColors = await tx.companyColor.findMany({
        where: { companyId },
        select: { name: true },
      });
      const haveColor = new Set(existingColors.map((c) => c.name));
      for (const name of allColors) {
        if (haveColor.has(name)) continue;
        await tx.companyColor.create({
          data: { companyId, name, hex: hexByColor.get(name) ?? DEFAULT_HEX },
        });
        summary.colorsAdded++;
      }

      // Tamanhos
      const existingSizes = await tx.companySize.findMany({
        where: { companyId },
        select: { name: true },
        orderBy: { order: "asc" },
      });
      const haveSize = new Set(existingSizes.map((s) => s.name));
      let order = existingSizes.length;
      for (const name of allSizes) {
        if (haveSize.has(name)) continue;
        await tx.companySize.create({ data: { companyId, name, order: order++ } });
        summary.sizesAdded++;
      }

      // ---- Produtos ----
      const usedSkus = new Set<string>();
      for (const p of data.products) {
        const colors = p.colors && p.colors.length ? p.colors : ["Único"];
        const sizes =
          p.sizes && p.sizes.length ? p.sizes : defSizes.length ? defSizes : ["Único"];

        // SKU único (gera a partir do nome quando ausente)
        let sku = (p.sku ?? "").trim();
        if (!sku) sku = slugify(p.name).toUpperCase().replace(/-/g, "").slice(0, 10) || "PROD";
        const base = sku;
        let n = 1;
        while (usedSkus.has(sku)) {
          n++;
          sku = `${base}-${n}`;
        }
        usedSkus.add(sku);

        const resolveStock = (color: string, size: string) =>
          p.stockByVariant?.[`${color}/${size}`] ?? p.stock ?? defStock;

        const existing = await tx.product.findFirst({
          where: { companyId, sku },
          include: { images: true },
        });

        const scalar = {
          name: p.name,
          category: p.category || defCategory,
          collection: p.collection,
          description: p.description,
          retailPrice: p.retailPrice,
          wholesalePrice: p.wholesalePrice ?? 0,
          costPrice: p.costPrice ?? 0,
          minQuantity: p.minQuantity ?? defMinQty,
          tags: tagsToString(p.tags),
          active: p.active ?? true,
        };

        let productId: string;
        if (existing) {
          // Produto JÁ EXISTE: modo aditivo — NADA do que o lojista editou é
          // sobrescrito (nome, preços, descrição, ativo...). A importação só
          // completa o que falta: fotos ausentes e variações novas.
          productId = existing.id;
          summary.productsUpdated++;
          // imagens: só adiciona se o produto ainda não tinha
          if (existing.images.length === 0 && p.images?.length) {
            await tx.productImage.createMany({
              data: p.images.map((url, i) => ({ productId, url, order: i })),
            });
            summary.images += p.images.length;
          }
        } else {
          const created = await tx.product.create({
            data: {
              companyId,
              sku,
              ...scalar,
              images: p.images?.length
                ? { create: p.images.map((url, i) => ({ url, order: i })) }
                : undefined,
            },
          });
          productId = created.id;
          summary.productsCreated++;
          summary.images += p.images?.length ?? 0;
        }

        // Variações: cria as que faltam com o estoque do arquivo. Variações
        // JÁ EXISTENTES nunca têm o estoque alterado — reimportar um catálogo
        // não pode desfazer o estoque que a loja organizou no sistema.
        for (const color of colors) {
          for (const size of sizes) {
            const existingVariant = await tx.productVariant.findUnique({
              where: { productId_color_size: { productId, color, size } },
              select: { id: true },
            });
            summary.variants++;
            if (existingVariant) continue;
            const stock = resolveStock(color, size);
            const v = await tx.productVariant.create({
              data: { productId, color, size, stock },
            });
            if (stock > 0) {
              await tx.inventoryMovement.create({
                data: {
                  companyId,
                  variantId: v.id,
                  type: "ENTRADA",
                  quantity: stock,
                  reason: "Importação de catálogo",
                },
              });
            }
          }
        }
      }

      return summary;
    },
    { timeout: 120000, maxWait: 20000 }
  );
}

/**
 * Modo "fotos": completa APENAS fotos de produtos existentes que estejam sem
 * nenhuma foto (casa por SKU — mesmo cálculo da importação — com reserva por
 * nome). Não cria produto, não altera preço, estoque, variações nem loja.
 * Seguro para rodar quantas vezes quiser.
 */
async function importPhotosOnly(
  companyId: string,
  data: CatalogFile
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    productsCreated: 0,
    productsUpdated: 0,
    variants: 0,
    images: 0,
    colorsAdded: 0,
    sizesAdded: 0,
    storeUpdated: false,
  };
  const usedSkus = new Set<string>();
  for (const p of data.products) {
    let sku = (p.sku ?? "").trim();
    if (!sku) sku = slugify(p.name).toUpperCase().replace(/-/g, "").slice(0, 10) || "PROD";
    const base = sku;
    let n = 1;
    while (usedSkus.has(sku)) {
      n++;
      sku = `${base}-${n}`;
    }
    usedSkus.add(sku);
    if (!p.images?.length) continue;

    const bySku = await db.product.findFirst({
      where: { companyId, sku },
      include: { images: { select: { id: true } } },
    });
    const existing =
      bySku ??
      (await db.product.findFirst({
        where: { companyId, name: p.name },
        include: { images: { select: { id: true } } },
      }));
    if (!existing || existing.images.length > 0) continue;

    await db.productImage.createMany({
      data: p.images.map((url, i) => ({ productId: existing.id, url, order: i })),
    });
    summary.images += p.images.length;
    summary.productsUpdated++;
  }
  return summary;
}
