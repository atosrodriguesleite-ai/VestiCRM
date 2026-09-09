import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { ajustarEstoqueDentro } from "@/lib/estoque/ajuste";
import { decidirAjuste, donoDoEstoque, fraseDaRecusa, NOME_DO_DONO, rotuloDaPeca } from "@/lib/estoque/dono-do-estoque";
import { reservadoPorVariacao } from "@/lib/estoque/inventario";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  // código do modelo (o SKU de cada variação fica em `variantStocks`)
  sku: z.string().trim().min(1).max(60).optional(),
  category: z.string().min(1).optional(),
  brand: z.string().nullable().optional(),
  collection: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  costPrice: z.number().nonnegative().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  retailPrice: z.number().nonnegative().optional(),
  minQuantity: z.number().int().positive().optional(),
  weightGrams: z.number().int().min(1).max(30000).nullable().optional(), // frete
  tags: z.string().nullable().optional(),
  active: z.boolean().optional(),
  imageUrl: z.string().min(1).optional(), // legado: troca a foto única
  // galeria completa em ordem (a primeira é a CAPA): itens com `id` são fotos
  // que já existem (mantidas), itens com `url` são fotos novas (data-URL)
  // `color` = capa por cor: a cor que a foto mostra (null = sem etiqueta).
  // Ausente (undefined) preserva a etiqueta atual — cliente antigo não apaga.
  images: z
    .array(
      z
        .object({
          id: z.string().optional(),
          url: z.string().optional(),
          color: z.string().max(60).nullable().optional(),
        })
        .refine((e) => e.id || e.url)
    )
    .max(10)
    .optional(),
  variantStocks: z
    .array(
      z.object({
        id: z.string().min(1),
        // ausente = "não mexi no estoque" — a tela só manda o número da
        // variação que a pessoa DIGITOU (RN-050): mandar o carregado de todas
        // desfazia a reserva da venda que entrou enquanto a ficha estava aberta
        stock: z.number().int().nonnegative().optional(),
        /** o número que a tela mostrava — a porta recusa se já mudou */
        visto: z.number().int().nonnegative().optional(),
        sku: z.string().max(60).nullable().optional(),
        // trocar a COR da variação já existente (reflete na hora no
        // catálogo público, sem precisar apagar e recriar a grade)
        color: z.string().min(1).max(40).optional(),
      })
    )
    .optional(),
  // gestão da grade: adicionar novas combinações cor × tamanho e remover
  addVariants: z
    .array(
      z.object({
        color: z.string().min(1),
        size: z.string().min(1),
        stock: z.number().int().nonnegative().default(0),
      })
    )
    .optional(),
  removeVariantIds: z.array(z.string()).optional(),
});

// a transação da ficha tem teto de 30s (fotos em data-URL): a função tem
// que viver mais que ela, senão morre no meio e a conexão fica pendurada
export const maxDuration = 60;

/**
 * A tela Produtos não pergunta o motivo (a tela de CONTAGEM, com motivo de
 * verdade, é o Inventário); o livro registra de onde veio o ajuste.
 */
const MOTIVO_DA_TELA_PRODUTOS = "edição do produto";

/** Recusa vinda de dentro da transação: derruba tudo e vira resposta. */
class RecusaDaGrade extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const product = await db.product.findFirst({
      where: { id, companyId: user.companyId },
      include: { variants: true, images: { orderBy: { order: "asc" } } },
    });
    if (!product) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const {
      imageUrl,
      images: imageList,
      variantStocks,
      addVariants,
      removeVariantIds,
      ...data
    } = parsed.data;

    // trocar o código do modelo: não pode bater com o de outro produto da loja
    if (data.sku !== undefined && data.sku !== product.sku) {
      const outro = await db.product.findFirst({
        where: { companyId: user.companyId, sku: data.sku, id: { not: product.id } },
        select: { id: true },
      });
      if (outro) {
        return NextResponse.json(
          { error: "Já existe um produto com este código" },
          { status: 409 }
        );
      }
    }

    /**
     * ESTOQUE DIGITADO passa pela porta única (RN-050) — e a conferência vem
     * ANTES de qualquer gravação (fotos inclusive: a capa antiga apagada não
     * volta). Variação vinculada à Nuvemshop/Jueri só chega aqui com número
     * se a tela for antiga ou alguém montou o pedido na mão — a tela nem
     * manda o estoque dela; aqui é a segunda tranca. Número IGUAL passa em
     * silêncio; `stock` ausente é "não mexi" (só SKU/cor).
     */
    // ordem estável por id: a reserva do pedido trava as variações em outra
    // ordem, e duas transações travando na ordem inversa é deadlock
    variantStocks?.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (variantStocks?.length) {
      for (const vs of variantStocks) {
        const variant = product.variants.find((v) => v.id === vs.id);
        if (!variant || vs.stock === undefined) continue;
        const decisao = decidirAjuste({
          dono: donoDoEstoque({ nuvemshopId: variant.nuvemshopId, product: { jueriId: product.jueriId } }),
          podeAjustar: true, // nesta tela ajusta quem edita o produto (régua de sempre)
          estoqueAtual: variant.stock,
          novoEstoque: vs.stock,
          motivo: MOTIVO_DA_TELA_PRODUTOS,
        });
        if (decisao.tipo === "RECUSADO") {
          const status = decisao.porque === "DONO_EXTERNO" ? 409 : 400;
          return NextResponse.json(
            { error: fraseDaRecusa(decisao, rotuloDaPeca({ ...variant, product })) },
            { status }
          );
        }
      }
    }

    /**
     * GRADE DE PEÇA VINCULADA NÃO SE MEXE AQUI (RN-050): remover variação da
     * Nuvemshop "não pega" (a sync recria com o número de lá, e o livro dela
     * some em cascata); acrescentar cor/tamanho num produto do Jueri cria uma
     * peça que ninguém sincroniza. E variação com peça RESERVADA em pedido não
     * se apaga — o pedido perderia a prova do que segurou.
     */
    if (removeVariantIds?.length) {
      const travadas = product.variants.filter(
        (v) => removeVariantIds.includes(v.id) && donoDoEstoque({ nuvemshopId: v.nuvemshopId, product })
      );
      if (travadas.length) {
        const v = travadas[0];
        return NextResponse.json(
          { error: `${rotuloDaPeca({ ...v, product })} é controlada pela ${NOME_DO_DONO[donoDoEstoque({ nuvemshopId: v.nuvemshopId, product })!]}. Remova lá e sincronize aqui.` },
          { status: 409 }
        );
      }
      const reservado = await reservadoPorVariacao(user.companyId);
      const presa = product.variants.find((v) => removeVariantIds.includes(v.id) && (reservado.get(v.id) ?? 0) > 0);
      if (presa) {
        return NextResponse.json(
          { error: `${rotuloDaPeca({ ...presa, product })} tem ${reservado.get(presa.id)} peça(s) reservada(s) em pedido. Cancele ou conclua o pedido antes de remover.` },
          { status: 409 }
        );
      }
    }
    if (addVariants?.length && product.jueriId) {
      return NextResponse.json(
        { error: "Este produto é controlado pelo Jueri: cor e tamanho novos entram por lá." },
        { status: 409 }
      );
    }

    /**
     * TUDO NUMA TRANSAÇÃO SÓ (achado da revisão, 09/09/2026): fotos, grade,
     * estoque e os dados do produto. Antes cada passo gravava por conta
     * própria, e uma recusa no meio (corrida de estoque na 3ª linha da
     * grade) deixava a ficha pela metade — duas linhas novas, uma velha,
     * nome e preço antigos, e a foto de capa já apagada.
     */
    const updated = await db.$transaction(
      async (tx) => {
        // galeria completa: a lista enviada É o estado final, na ordem final
        // (posição 0 = capa). Fotos existentes chegam por id e só têm a ordem
        // atualizada — o conteúdo não muda, então o cache imutável de
        // /api/img/<id> continua válido. Fotos fora da lista são removidas.
        if (imageList) {
          const keepIds = imageList.flatMap((e) => (e.id ? [e.id] : []));
          await tx.productImage.deleteMany({
            where: { productId: product.id, id: { notIn: keepIds } },
          });
          for (let i = 0; i < imageList.length; i++) {
            const e = imageList[i];
            if (e.id) {
              await tx.productImage.updateMany({
                where: { id: e.id, productId: product.id },
                data: { order: i, ...(e.color !== undefined ? { color: e.color } : {}) },
              });
            } else if (e.url) {
              await tx.productImage.create({
                data: { productId: product.id, url: e.url, order: i, color: e.color ?? null },
              });
            }
          }
        } else if (imageUrl) {
          // legado: troca da foto principal — apaga e recria para nascer com id
          // NOVO (/api/img/<id> usa cache imutável; foto nova pede URL nova)
          const first = product.images[0];
          if (first) {
            await tx.productImage.delete({ where: { id: first.id } });
          }
          await tx.productImage.create({
            data: { productId: product.id, url: imageUrl, order: 0 },
          });
        }

        // grade: SKU, cor e estoque por variação
        if (variantStocks?.length) {
          for (const vs of variantStocks) {
            const variant = product.variants.find((v) => v.id === vs.id);
            if (!variant) continue;
            // SKU da variação (vínculo com a loja online) — atualiza se mudou
            if (vs.sku !== undefined && (vs.sku ?? null) !== variant.sku) {
              await tx.productVariant.update({
                where: { id: variant.id },
                data: { sku: vs.sku },
              });
            }
            // COR da variação: renomear direto na peça (o catálogo lê daqui).
            // Se já existir a mesma cor+tamanho, ignora — a grade não pode ter
            // duas linhas iguais.
            if (vs.color && vs.color !== variant.color) {
              const jaTem = product.variants.some(
                (o) => o.id !== variant.id && o.color === vs.color && o.size === variant.size
              );
              if (!jaTem) {
                await tx.productVariant.update({
                  where: { id: variant.id },
                  data: { color: vs.color },
                });
                await tx.inventoryMovement.create({
                  data: {
                    companyId: user.companyId,
                    variantId: variant.id,
                    type: "AJUSTE",
                    quantity: 0,
                    reason: `Cor alterada por ${user.name} (${variant.color} → ${vs.color})`,
                  },
                });
              }
            }
            if (vs.stock === undefined || variant.stock === vs.stock) continue;
            // a porta única grava número + linha do livro juntos, condicional
            // ao número que a tela viu (RN-050)
            const r = await ajustarEstoqueDentro(tx, {
              user,
              podeAjustar: true,
              variantId: variant.id,
              novoEstoque: vs.stock,
              estoqueVisto: vs.visto,
              motivo: MOTIVO_DA_TELA_PRODUTOS,
            });
            if (!r.ok) throw new RecusaDaGrade(r.status, r.error);
          }
        }

        // novas combinações da grade
        if (addVariants?.length) {
          for (const v of addVariants) {
            const created = await tx.productVariant.upsert({
              where: {
                productId_color_size: {
                  productId: product.id,
                  color: v.color.trim(),
                  size: v.size.trim(),
                },
              },
              update: {},
              create: {
                productId: product.id,
                color: v.color.trim(),
                size: v.size.trim(),
                stock: v.stock,
              },
            });
            if (v.stock > 0) {
              await tx.inventoryMovement.create({
                data: {
                  companyId: user.companyId,
                  variantId: created.id,
                  type: "ENTRADA",
                  quantity: v.stock,
                  reason: `Nova variação por ${user.name}`,
                },
              });
            }
          }
        }

        // remoção de variações da grade
        if (removeVariantIds?.length) {
          await tx.productVariant.deleteMany({
            where: { id: { in: removeVariantIds }, productId: product.id },
          });
        }

        return tx.product.update({ where: { id }, data });
      },
      // fotos em data-URL pesam: a transação ganha folga acima dos 5s padrão
      { timeout: 30_000 }
    );
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof RecusaDaGrade)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Remove o produto do catálogo (itens de pedidos antigos ficam preservados). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const product = await db.product.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!product) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    await db.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
