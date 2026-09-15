import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { logServerError } from "./health";
import { MAX_TENTATIVAS_ESTOQUE, PECAS_POR_RODADA, proximaTentativa } from "./nuvemshop-estoque-pendente";

/**
 * RN-057 · O PREÇO DE VAREJO DA PEÇA NUVEMSHOP TAMBÉM SE MUDA AQUI, E VAI
 * PARA LÁ.
 *
 * Pedido do dono (15/09/2026), com o print da Entre Linhas: a lojista abriu
 * o reajuste em lote e viu "varejo: é da Nuvemshop, muda lá" em 25 peças —
 * ou seja, ir na Nuvemshop e mudar 25 preços na mão. A RN-056 nasceu
 * trancando o varejo porque a sync devolveria o número de lá; a resposta
 * certa não é trancar, é MANDAR o número daqui para lá.
 *
 * O desenho é o da RN-053 (estoque), que já provou funcionar:
 *  • a pendência nasce ANTES da tentativa (na MESMA transação que grava o
 *    preço aqui) e some só quando a Nuvemshop CONFIRMA;
 *  • enquanto ela existe, a sync NÃO escreve o varejo de lá por cima — senão
 *    o preço novo durava até a próxima sincronização;
 *  • o envio vai pelo `after()` do Next (chamada solta é congelada pela
 *    Vercel junto com a resposta, lição da RN-033);
 *  • o que sobrou é repescado de carona no tráfego, na MESMA rodada e com a
 *    MESMA trava da fila de estoque — nunca um 3º cron (ADR-002);
 *  • desistir é explícito: Central de Comunicação + Saúde, uma vez por
 *    rodada, e a linha FICA (a ficha mostra o aviso) até um envio confirmar.
 *
 * UMA FILA POR PRODUTO: o varejo é do modelo (`Product.retailPrice`), e
 * todas as variações vinculadas recebem o mesmo número — o que se manda é
 * sempre o preço de AGORA, relido na hora do envio.
 */

/**
 * Marca o produto como "preço ainda não confirmado na Nuvemshop". Aceita a
 * transação de quem grava o preço: pendência e preço nascem juntos, senão a
 * função morrer entre os dois deixava o preço novo aqui sem ninguém para
 * mandá-lo.
 */
export async function marcarPrecoPendente(
  companyId: string,
  productIds: string[],
  cliente: Prisma.TransactionClient | typeof db = db
) {
  if (productIds.length === 0) return;
  // DUAS consultas para a lista inteira, não duas por produto: o reajuste de
  // uma categoria com centenas de peças Nuvemshop roda dentro de uma
  // transação de 30s, e ida-e-volta por peça estourava o relógio e desfazia
  // o reajuste todo (achado da revisão)
  // quem já tinha DESISTIDO volta ao começo: mudar o preço de novo é motivo
  // para tentar de novo (mesma régua da RN-053)
  await cliente.nuvemshopPrecoPendente.updateMany({
    where: { companyId, productId: { in: productIds }, proximaEm: null },
    data: { tentativas: 0, proximaEm: proximaTentativa(0) },
  });
  // quem já está na fila continua onde está (a conta de tentativas é da peça)
  await cliente.nuvemshopPrecoPendente.createMany({
    data: productIds.map((productId) => ({ companyId, productId, tentativas: 0, proximaEm: proximaTentativa(0) })),
    skipDuplicates: true,
  });
}

/**
 * Envio CONFIRMADO: o produto sai da fila — mas só se o preço que chegou lá
 * é o que temos AGORA (o reajuste seguinte pode ter mudado o número no meio
 * de um PUT de 15s; sucesso com número velho não é sucesso).
 */
export async function confirmarEnvioDePreco(productId: string, precoEnviado?: number) {
  if (precoEnviado !== undefined) {
    const atual = await db.product.findUnique({ where: { id: productId }, select: { retailPrice: true } });
    if (!atual || Math.abs(atual.retailPrice - precoEnviado) >= 0.005) return;
  }
  await db.nuvemshopPrecoPendente.deleteMany({ where: { productId } });
}

/** Tentativa que falhou: conta mais uma e agenda a próxima. `false` = acabaram. */
export async function registrarFalhaDePreco(
  companyId: string,
  productId: string,
  motivo: string
): Promise<boolean> {
  const atual = await db.nuvemshopPrecoPendente.findUnique({ where: { productId } });
  const feitas = (atual?.tentativas ?? 0) + 1;
  const quando = proximaTentativa(feitas);
  if (quando === null) return false;
  await db.nuvemshopPrecoPendente.upsert({
    where: { productId },
    create: { companyId, productId, tentativas: feitas, proximaEm: quando, ultimoErro: motivo.slice(0, 300) },
    update: { tentativas: feitas, proximaEm: quando, ultimoErro: motivo.slice(0, 300) },
  });
  return true;
}

/**
 * Acabaram as tentativas: para de tentar e o caso APARECE (Central de
 * Comunicação + Saúde, com o nome da peça), uma vez por rodada. A linha fica
 * sem data — é o aviso da ficha — até um envio daquele produto confirmar.
 */
export async function desistirDoEnvioDePreco(
  companyId: string,
  productId: string,
  nomeDaPeca: string,
  motivo: string
) {
  const parou = await db.nuvemshopPrecoPendente.updateMany({
    where: { companyId, productId, proximaEm: { not: null } },
    data: { proximaEm: null, ultimoErro: motivo.slice(0, 300) },
  });
  if (parou.count === 0) return;
  await db.commEvent
    .create({
      data: {
        companyId,
        direction: "OUT",
        type: "nuvemshop.preco-nao-enviado",
        status: "ERRO",
        payload: JSON.stringify({ productId, peca: nomeDaPeca }),
        error: motivo.slice(0, 300),
        attempts: MAX_TENTATIVAS_ESTOQUE,
      },
    })
    .catch(() => null);
  await logServerError({
    source: "server",
    path: "/nuvemshop/preco",
    message: `Preço de varejo de "${nomeDaPeca}" não chegou na Nuvemshop`,
    detail: `loja ${companyId}: ${motivo}`.slice(0, 4000),
  });
}

/**
 * Produtos desta loja com preço ainda não confirmado lá — para a sync NÃO
 * escrever o varejo de lá por cima, e para a ficha avisar.
 */
export async function precoPendentePorProduto(
  companyId: string,
  productIds: string[]
): Promise<Set<string>> {
  return new Set((await estadoDoPrecoPorProduto(companyId, productIds)).keys());
}

/** "enviando" (ainda tentando) ou "falhou" (desistiu, com o motivo) — para a ficha dizer a verdade. */
export type EstadoDoPrecoPendente = { estado: "enviando" | "falhou"; motivo: string | null };

export async function estadoDoPrecoPorProduto(
  companyId: string,
  productIds: string[]
): Promise<Map<string, EstadoDoPrecoPendente>> {
  if (productIds.length === 0) return new Map();
  // a consulta é pela LOJA (tabela pequena por desenho), cruzada em memória
  const linhas = await db.nuvemshopPrecoPendente.findMany({
    where: { companyId },
    select: { productId: true, proximaEm: true, ultimoErro: true },
  });
  const pedidos = new Set(productIds);
  return new Map(
    linhas
      .filter((l) => pedidos.has(l.productId))
      .map((l) => [l.productId, { estado: l.proximaEm ? "enviando" : "falhou", motivo: l.ultimoErro } as EstadoDoPrecoPendente])
  );
}

/** Produtos com envio de preço vencido, mais antigos primeiro, com teto. */
export async function produtosParaRepescarPreco(companyId: string) {
  return db.nuvemshopPrecoPendente.findMany({
    where: { companyId, proximaEm: { lte: new Date() } },
    orderBy: { proximaEm: "asc" },
    take: PECAS_POR_RODADA,
    select: { productId: true, tentativas: true },
  });
}
