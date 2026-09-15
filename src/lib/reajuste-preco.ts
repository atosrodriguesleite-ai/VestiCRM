import { Prisma } from "@prisma/client";
import { db } from "./db";
import { espelharPrecoSemQuebrar } from "./nuvemshop";
import { marcarPrecoPendente } from "./nuvemshop-preco-pendente";
import {
  planejarReajuste,
  type CampoDePreco,
  type ModoDeReajuste,
  type ProdutoParaReajuste,
  type ResumoDoReajuste,
} from "./reajuste-preco-regra";

// a regra pura mora no arquivo irmão; quem só precisa da conta importa de lá
export * from "./reajuste-preco-regra";

/** Quantas linhas a prévia devolve (o resumo conta TODAS). */
export const LINHAS_NA_PREVIA = 200;

export type PedidoDeReajuste = {
  categoria: string;
  campos: CampoDePreco[];
  modo: ModoDeReajuste;
  valor: number;
};

/** Os produtos da categoria, na loja (RN-013), no formato do planejador. */
async function produtosDaCategoria(companyId: string, categoria: string) {
  return db.product.findMany({
    where: { companyId, category: categoria },
    select: {
      id: true,
      name: true,
      wholesalePrice: true,
      retailPrice: true,
      nuvemshopId: true,
      jueriId: true,
      variants: { select: { nuvemshopId: true } },
    },
    orderBy: { name: "asc" },
  });
}

/** A PRÉVIA: a mesma conta do aplicar, sem gravar nada. */
export async function preverReajuste(companyId: string, pedido: PedidoDeReajuste) {
  const produtos = await produtosDaCategoria(companyId, pedido.categoria);
  const plano = planejarReajuste(produtos, pedido.campos, pedido.modo, pedido.valor);
  // só as que mudam ou têm aviso interessam à prévia; com teto — medido
  // DEPOIS do filtro, senão a tela dizia "mostrando as primeiras" sem ter
  // escondido nada (achado da revisão)
  const visiveis = plano.linhas.filter((l) => l.atacado || l.varejo || l.avisos.length);
  return {
    resumo: plano.resumo,
    linhas: visiveis.slice(0, LINHAS_NA_PREVIA),
    cortada: visiveis.length > LINHAS_NA_PREVIA,
  };
}

/** Quantos produtos por comando de gravação. */
const LOTE_DE_GRAVACAO = 500;

/**
 * Grava os preços novos de UM campo, em lotes: um comando por 500 peças,
 * com o valor de cada uma (VALUES), sempre dentro da loja. Mil produtos
 * viravam mil idas ao banco em série e estouravam os 30s da transação —
 * a categoria inteira voltava atrás com um erro genérico (achado da revisão).
 */
async function gravarCampo(
  tx: Prisma.TransactionClient,
  companyId: string,
  campo: CampoDePreco,
  pares: { id: string; para: number }[]
): Promise<void> {
  const coluna = campo === "atacado" ? Prisma.raw('"wholesalePrice"') : Prisma.raw('"retailPrice"');
  for (let i = 0; i < pares.length; i += LOTE_DE_GRAVACAO) {
    const lote = pares.slice(i, i + LOTE_DE_GRAVACAO);
    const valores = Prisma.join(lote.map((p) => Prisma.sql`(${p.id}, ${p.para}::float8)`));
    await tx.$executeRaw`
      UPDATE "Product" AS p SET ${coluna} = v.para
      FROM (VALUES ${valores}) AS v(id, para)
      WHERE p.id = v.id AND p."companyId" = ${companyId}`;
  }
}

/**
 * APLICA: dentro de UMA transação, TRAVA as peças da categoria (FOR UPDATE —
 * a ficha que alguém estiver salvando ao mesmo tempo espera a vez, em vez de
 * ser sobrescrita em silêncio; achado da revisão), reconta com o número que
 * está no banco NAQUELE instante (o preço pode ter mudado desde a prévia),
 * grava em lote e deixa o registro na Central de Comunicação com quem fez e
 * o antes/depois de cada peça — é o que permite desfazer à mão.
 */
export async function aplicarReajuste(
  companyId: string,
  pedido: PedidoDeReajuste,
  quem: { id: string; name: string }
): Promise<ResumoDoReajuste> {
  const { resumo, paraEspelhar } = await db.$transaction(
    async (tx) => {
      const travados = await tx.$queryRaw<
        { id: string; name: string; wholesalePrice: number; retailPrice: number; nuvemshopId: string | null; jueriId: string | null }[]
      >`
        SELECT id, name, "wholesalePrice", "retailPrice", "nuvemshopId", "jueriId"
        FROM "Product"
        WHERE "companyId" = ${companyId} AND category = ${pedido.categoria}
        ORDER BY name ASC
        FOR UPDATE`;
      const ids = travados.map((p) => p.id);
      const comNuvemshop = new Set(
        ids.length
          ? (
              await tx.productVariant.findMany({
                where: { productId: { in: ids }, nuvemshopId: { not: null } },
                select: { productId: true },
              })
            ).map((v) => v.productId)
          : []
      );
      const produtos: ProdutoParaReajuste[] = travados.map((p) => ({
        ...p,
        variants: comNuvemshop.has(p.id) ? [{ nuvemshopId: "x" }] : [],
      }));
      const plano = planejarReajuste(produtos, pedido.campos, pedido.modo, pedido.valor);
      const mudancas = plano.linhas.filter((l) => l.atacado || l.varejo);

      const atacado = mudancas.filter((l) => l.atacado).map((l) => ({ id: l.id, para: l.atacado!.para }));
      const varejo = mudancas.filter((l) => l.varejo).map((l) => ({ id: l.id, para: l.varejo!.para }));
      if (atacado.length) await gravarCampo(tx, companyId, "atacado", atacado);
      if (varejo.length) await gravarCampo(tx, companyId, "varejo", varejo);

      // RN-057: o varejo de peça Nuvemshop entra na fila de envio NA MESMA
      // transação que o grava — preço novo aqui sem ninguém para mandá-lo é
      // o reajuste que a sync desfaz na hora seguinte
      const paraEspelhar = mudancas.filter((l) => l.espelhaVarejo).map((l) => l.id);
      await marcarPrecoPendente(companyId, paraEspelhar, tx);

      await tx.commEvent.create({
        data: {
          companyId,
          direction: "OUT",
          type: "produtos.reajuste-de-preco",
          status: "OK",
          payload: JSON.stringify({
            por: { id: quem.id, nome: quem.name },
            categoria: pedido.categoria,
            campos: pedido.campos,
            modo: pedido.modo,
            valor: pedido.valor,
            resumo: plano.resumo,
            // até 200 mudanças com o antes/depois: é o que permite desfazer à mão
            mudancas: mudancas.slice(0, LINHAS_NA_PREVIA).map((l) => ({
              id: l.id,
              nome: l.nome,
              atacado: l.atacado ?? null,
              varejo: l.varejo ?? null,
            })),
          }),
        },
      });
      return { resumo: plano.resumo, paraEspelhar };
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
  // só depois do commit: mandar antes é mandar um número que pode não existir
  espelharPrecoSemQuebrar(companyId, paraEspelhar);
  return resumo;
}
