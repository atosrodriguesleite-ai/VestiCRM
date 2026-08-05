import { Prisma } from "@prisma/client";

/**
 * A CORRIDA DO NÚMERO DO PEDIDO.
 *
 * O número nasce de "maior número da loja + 1". Dois pedidos criados no MESMO
 * instante (catálogo + painel + Nuvemshop são três portas independentes) leem
 * o mesmo "maior" e tentam gravar o mesmo número. O índice único
 * (companyId, number) barra o segundo — que antes explodia como erro genérico
 * e a venda se perdia (auditoria 05/08/2026).
 *
 * A solução é INSISTIR: quem perde a corrida tenta de novo do zero (a
 * transação inteira, então a leitura do "maior" vem fresca e o estoque
 * reservado na tentativa perdida já voltou pelo rollback). Só a corrida DE
 * NÚMERO é repetida — qualquer outro erro (inclusive o P2002 do protocolo
 * do catálogo, que tem tratamento próprio) sobe intacto.
 */

/** É o índice único (companyId, number) que barrou? */
export function ehCorridaDeNumero(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    JSON.stringify(e.meta?.target ?? "").includes("number")
  );
}

/** Roda a criação; perdeu a corrida do número, tenta de novo (até 3x). */
export async function comNumeroUnico<T>(
  criar: () => Promise<T>,
  tentativas = 3
): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await criar();
    } catch (e) {
      if (!ehCorridaDeNumero(e)) throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}
