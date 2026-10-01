import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { SessionUser } from "../auth";
import { gruposParaSeparar } from "./dono-do-estoque";
import { baseNome, norm } from "../nuvemshop";
import { marcarPrecoPendente } from "../nuvemshop-preco-pendente";

/**
 * SEPARAR EM PRODUTO PRÓPRIO a cor que já é de outro produto na Nuvemshop
 * (RN-050, relato da Entre Linhas em 01/10/2026 — a regra pura e o porquê
 * estão em `gruposParaSeparar`, dono-do-estoque.ts).
 *
 * MOVE a variação, nunca apaga: mesmo id, mesmo código de barras (RN-059),
 * mesmo livro de estoque, mesmos pedidos e a mesma fila de envio para a
 * Nuvemshop (RN-053). O destino é o produto daqui ligado ao produto de lá
 * dela — o que já existir (a sync e o vínculo passam a apontar para ele),
 * ou um novo, com os dados da peça (preços, custo, categoria, NCM,
 * composição, mínimo) e o nome dela com a cor na frente. Depois disso a
 * sincronização de cada produto de lá acha a sua peça daqui pelo vínculo
 * (`Product.nuvemshopId`): a cor separada não volta para a peça antiga.
 *
 * Tudo numa transação, com as variações da peça TRAVADAS e relidas: a
 * sync e a venda mexem nelas, e a decisão tem que ser sobre o que está no
 * banco agora, não sobre o que a tela carregou.
 */

export type ResultadoDaSeparacao =
  | { ok: true; produtoId: string; nome: string; criado: boolean; cores: string[] }
  | { ok: false; status: number; erro: string };

// a MESMA régua de cor × tamanho da sync (acento, caixa, espaço dobrado e
// invisível não contam): cor "igual" por outra régua deixaria entrar a
// duplicata que a sync depois confundiria (achado da revisão)
const chave = (s: string) => norm(s);

/** Código do modelo livre na loja (`Product` é único por loja × código) — UMA ida ao banco. */
async function codigoLivre(
  tx: Prisma.TransactionClient,
  companyId: string,
  candidatos: string[]
): Promise<string> {
  const limpos = [...new Set(candidatos.map((c) => c.trim()).filter(Boolean))];
  const base = limpos.at(-1) ?? "SEPARADO";
  const usados = new Set(
    (
      await tx.product.findMany({
        where: { companyId, OR: [{ sku: { in: limpos } }, { sku: { startsWith: base } }] },
        select: { sku: true },
      })
    ).map((p) => p.sku)
  );
  const livre = limpos.find((c) => !usados.has(c));
  if (livre) return livre;
  for (let i = 2; i < 1000; i++) if (!usados.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

export async function separarEmProdutoProprio(
  user: SessionUser,
  productId: string,
  nsProdutoId: string
): Promise<ResultadoDaSeparacao> {
  const companyId = user.companyId;
  return db.$transaction(
    async (tx): Promise<ResultadoDaSeparacao> => {
      const p = await tx.product.findFirst({ where: { id: productId, companyId } });
      if (!p) return { ok: false, status: 404, erro: "Produto não encontrado." };
      // duas separações para o MESMO produto de lá (duas abas, duas peças)
      // fazem fila: a segunda acha o destino que a primeira criou
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`separar:${companyId}:${nsProdutoId}`}))`;
      // trava as variações da peça e relê: a sync e a venda mexem nelas
      await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "productId" = ${p.id} ORDER BY "id" FOR UPDATE`;
      const variantes = await tx.productVariant.findMany({ where: { productId: p.id } });
      const grupo = gruposParaSeparar(p, variantes).find((g) => g.nsProdutoId === nsProdutoId);
      if (!grupo) {
        return {
          ok: false,
          status: 409,
          erro: "Essas cores não estão mais separadas na Nuvemshop (ou a peça mudou). Recarregue a página e confira.",
        };
      }
      const ids = grupo.variantes.map((v) => v.id);
      const cores = [...new Set(grupo.variantes.map((v) => v.color))];

      // o destino é o produto daqui ligado ao produto de lá — se já existe
      const existente = await tx.product.findFirst({ where: { companyId, nuvemshopId: nsProdutoId } });
      let destino: { id: string; name: string };
      let criado = false;
      if (existente && !existente.active) {
        // a cor (com o estoque dela) sumiria do catálogo — e o pedido antigo
        // do aparelho não acharia a peça (o rastro só olha produto ativo)
        return {
          ok: false,
          status: 409,
          erro: `O produto "${existente.name}" daqui, que é o dessa cor na Nuvemshop, está inativo. Ative-o antes de separar.`,
        };
      }
      if (existente) {
        const ocupadas = await tx.productVariant.findMany({
          where: { productId: existente.id },
          select: { color: true, size: true },
        });
        const colide = grupo.variantes.find((v) =>
          ocupadas.some((o) => chave(o.color) === chave(v.color) && chave(o.size) === chave(v.size))
        );
        if (colide) {
          return {
            ok: false,
            status: 409,
            erro:
              `O produto "${existente.name}" já tem ${colide.color} · ${colide.size}. ` +
              `Confira qual das duas é a certa antes de juntar — o sistema não escolhe por você.`,
          };
        }
        destino = existente;
      } else {
        const sku = await codigoLivre(tx, companyId, [
          grupo.variantes[0].sku ?? "",
          `${p.sku}-${cores[0]}`,
        ]);
        destino = await tx.product.create({
          data: {
            companyId,
            nuvemshopId: nsProdutoId,
            // "Base — Cor": o padrão produto-por-cor que a sync e a produção
            // já leem (`baseNome`/`corDoNome`); "Blusa — Laranja — Azul"
            // quebraria os dois
            name: `${baseNome(p.name) || p.name} — ${cores.join(" / ")}`,
            sku,
            category: p.category,
            brand: p.brand,
            collection: p.collection,
            description: p.description,
            videoUrl: p.videoUrl,
            costPrice: p.costPrice,
            wholesalePrice: p.wholesalePrice,
            retailPrice: p.retailPrice,
            minQuantity: p.minQuantity,
            active: p.active,
            tags: p.tags,
            weightGrams: p.weightGrams,
            minStock: p.minStock,
            ncm: p.ncm,
            composition: p.composition,
          },
          select: { id: true, name: true },
        });
        criado = true;
      }

      const movidas = await tx.productVariant.updateMany({
        where: { id: { in: ids }, productId: p.id },
        data: { productId: destino.id, nuvemshopProductId: nsProdutoId, separadaDeId: p.id },
      });
      if (movidas.count !== ids.length) {
        // não deveria acontecer com a trava; se acontecer, nada fica pela metade
        throw new Error("separar: variação mudou no meio");
      }
      // os itens de pedido acompanham a peça: a porta de edição do pedido
      // confere variação × produto, e a curva ABC agrupa por produto
      await tx.orderItem.updateMany({ where: { variantId: { in: ids } }, data: { productId: destino.id } });
      // varejo mudado aqui e ainda a caminho da Nuvemshop (RN-057): a fila é
      // por PRODUTO, e sem ela no destino a sync desfaria o preço novo
      // (só no produto NOVO, que nasce com o preço da peça; o que já existia
      // tem o preço dele, e reenviar o dele não levaria o reajuste junto)
      if (criado && (await tx.nuvemshopPrecoPendente.findFirst({ where: { productId: p.id }, select: { id: true } }))) {
        await marcarPrecoPendente(companyId, [destino.id], tx);
      }
      // a peça estava num catálogo de campanha: a cor separada continua nele
      // (também no destino que já existia — senão o pedido antigo do aparelho
      // sairia sem o preço de campanha que a vitrine mostrou)
      const promos = await tx.promoCatalogProduct.findMany({ where: { productId: p.id }, select: { promoId: true } });
      if (promos.length) {
        await tx.promoCatalogProduct.createMany({
          data: promos.map((x) => ({ promoId: x.promoId, productId: destino.id })),
          skipDuplicates: true,
        });
      }

      // as fotos etiquetadas com uma cor que SÓ existe no grupo vão junto
      // (capa por cor); as gerais e as das cores que ficam, ficam
      const ficam = new Set(variantes.filter((v) => !ids.includes(v.id)).map((v) => chave(v.color)));
      const vao = new Set(cores.map(chave).filter((c) => !ficam.has(c)));
      const fotos = await tx.productImage.findMany({
        where: { productId: p.id, color: { not: null } },
        select: { id: true, color: true },
      });
      const fotosQueVao = fotos.filter((f) => f.color && vao.has(chave(f.color))).map((f) => f.id);
      if (fotosQueVao.length) {
        await tx.productImage.updateMany({ where: { id: { in: fotosQueVao } }, data: { productId: destino.id } });
      }

      await tx.commEvent.create({
        data: {
          companyId,
          direction: "OUT",
          type: "produtos.cor-separada",
          status: "OK",
          payload: JSON.stringify({
            por: { id: user.id, nome: user.name },
            de: { id: p.id, nome: p.name },
            para: { id: destino.id, nome: destino.name, criado },
            nuvemshopProduto: nsProdutoId,
            variacoes: grupo.variantes.map((v) => ({ id: v.id, cor: v.color, tamanho: v.size, sku: v.sku })),
            fotos: fotosQueVao.length,
          }),
        },
      });
      return { ok: true, produtoId: destino.id, nome: destino.name, criado, cores };
    },
    { timeout: 30_000 }
  );
}
