import { db } from "../db";
import { ORIGEM_PEDIDO } from "./porta-vendas";

/**
 * A NOTA FISCAL VISTA DO FINANCEIRO (RN-036).
 *
 * O financeiro NÃO emite nota: quem emite é o Bling (RN-016), que é onde a
 * loja já tem certificado, regime tributário e numeração. O que faltava era
 * o caminho: a lojista via a conta a receber aqui e tinha que ir procurar o
 * pedido em outra tela para saber se a nota saiu.
 *
 * Então a ficha do lançamento MOSTRA o vínculo (o pedido que o gerou, a
 * situação da nota, o número e o link do DANFE) e, com o Bling conectado,
 * deixa emitir dali mesmo — pela MESMA porta do pedido, sem regra nova.
 */

export type NotaDoLancamento = {
  pedidoId: string;
  numero: number;
  /** EMITINDO | AUTORIZADA | ERRO | null (ainda não pedida) */
  status: string | null;
  nfeNumero: string | null;
  url: string | null;
  /** dá para emitir daqui? (Bling conectado e nota ainda não autorizada) */
  podeEmitir: boolean;
  blingConectado: boolean;
};

/**
 * O que a ficha precisa saber sobre a nota. Só lançamento que veio de PEDIDO
 * tem nota — conta de luz e comissão não têm de onde tirar.
 */
export async function notaDoLancamento(
  companyId: string,
  lancamento: { origem: string; origemId: string | null; tipo: string }
): Promise<NotaDoLancamento | null> {
  if (lancamento.origem !== ORIGEM_PEDIDO || !lancamento.origemId) return null;
  if (lancamento.tipo !== "RECEITA") return null;

  const [pedido, bling] = await Promise.all([
    db.order.findFirst({
      where: { id: lancamento.origemId, companyId },
      select: {
        id: true,
        number: true,
        nfeStatus: true,
        nfeNumber: true,
        nfeUrl: true,
      },
    }),
    db.blingConnection.findUnique({
      where: { companyId },
      select: { companyId: true },
    }),
  ]);
  if (!pedido) return null;

  return {
    pedidoId: pedido.id,
    numero: pedido.number,
    status: pedido.nfeStatus,
    nfeNumero: pedido.nfeNumber,
    url: pedido.nfeUrl,
    blingConectado: Boolean(bling),
    // nota AUTORIZADA não se emite de novo (viraria nota em dobro); a que
    // deu ERRO pode, que é o caso de a lojista corrigir o cadastro e repetir
    podeEmitir: Boolean(bling) && pedido.nfeStatus !== "AUTORIZADA",
  };
}
