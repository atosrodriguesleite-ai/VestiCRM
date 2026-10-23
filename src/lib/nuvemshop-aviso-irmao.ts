import type { Prisma } from "@prisma/client";
import { ehCorridaDeNumero } from "./numero-do-pedido";

/**
 * A VENDA DA LOJA ONLINE CHEGA EM AVISOS IRMÃOS — E NASCE UMA VEZ SÓ.
 *
 * Quando a cliente paga na Nuvemshop, ela manda `order/paid` E `order/updated`
 * (às vezes mais de um) para o MESMO pedido, no mesmo segundo. Cada aviso é
 * uma execução separada na Vercel: todas perguntam "esse pedido já existe
 * aqui?", todas ouvem "não" ao mesmo tempo, e todas tentam criar. A primeira
 * cria; as outras batem num índice único — e em QUAL índice depende da ordem
 * em que o Postgres os confere: (companyId, nuvemshopId), o número do pedido
 * ou o `opportunityId` do carrinho abandonado que os dois leram igual.
 *
 * Isso NUNCA duplicou venda — o índice é a tranca. O que fazia era barulho
 * caro (painel de Saúde, 23/10/2026): cada aviso perdedor respondia 500 e
 * tocava o alarme "🚨 Erro em produção", que tem um intervalo de 15 min
 * compartilhado com as emergências de verdade (servidor do WhatsApp caído,
 * mensagem de cliente perdida). Uma venda online calava o alarme real. E a
 * venda SEM telefone deixava uma cliente órfã: cada aviso criava a sua.
 *
 * Duas trancas, o padrão da casa (RN-043, RN-073):
 *  1. FILA por (loja, pedido da Nuvemshop): `pg_advisory_xact_lock` numa
 *     transação curta — "já existe?" e a criação lá dentro. O aviso irmão
 *     ESPERA o primeiro terminar, encontra o pedido pronto e devolve o dele,
 *     sem tentar criar nada (nem a cliente sem telefone).
 *  2. Falhou a criação por qualquer motivo, a prova de que o irmão criou é o
 *     pedido EXISTIR — não o nome do índice que barrou. Relê; achou, é
 *     sucesso; não achou, o erro original sobe, porque a Nuvemshop só reenvia
 *     quando recebe erro (RN-014: a venda não pode sumir). A corrida de
 *     NÚMERO com o pedido do painel/catálogo continua na régua dela
 *     (`comNumeroUnico`, que embrulha isto e insiste).
 */

/** A fila: uma venda da Nuvemshop por vez, por loja × pedido de lá. */
export async function travarVendaDaNuvemshop(
  tx: Prisma.TransactionClient,
  companyId: string,
  nuvemshopId: string,
) {
  const chave = `nuvemshop-venda:${companyId}:${nuvemshopId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
}

export type PortaDaVenda<T, Tx> = {
  /** abre a transação curta (a trava morre com ela) */
  emTransacao: <R>(fn: (tx: Tx) => Promise<R>) => Promise<R>;
  travar: (tx: Tx) => Promise<void>;
  /** o pedido deste id da Nuvemshop, se já existe (dentro da transação ou fora) */
  relerExistente: (tx: Tx | null) => Promise<T | null>;
  criar: (tx: Tx) => Promise<T>;
};

export async function criarVendaDaNuvemshopUmaVez<T, Tx>(
  porta: PortaDaVenda<T, Tx>,
): Promise<{ pedido: T; criadoPeloIrmao: boolean }> {
  try {
    return await porta.emTransacao(async (tx) => {
      await porta.travar(tx);
      const doIrmao = await porta.relerExistente(tx);
      if (doIrmao) return { pedido: doIrmao, criadoPeloIrmao: true };
      return { pedido: await porta.criar(tx), criadoPeloIrmao: false };
    });
  } catch (e) {
    // a corrida de NÚMERO não é o irmão (sob a trava, nenhum pedido deste id
    // existe quando a criação chegou a rodar): sobe direto, sem a releitura,
    // para `comNumeroUnico` insistir
    if (ehCorridaDeNumero(e)) throw e;
    // segunda tranca: existe? então o irmão criou. A releitura que falha não
    // troca o erro — o original é o que explica o que houve
    let doIrmao: T | null = null;
    try {
      doIrmao = await porta.relerExistente(null);
    } catch {
      doIrmao = null;
    }
    if (doIrmao) return { pedido: doIrmao, criadoPeloIrmao: true };
    throw e;
  }
}
