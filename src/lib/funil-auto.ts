import { db } from "./db";
import { etapaDoMarco } from "./funil/marcos";
import type { Marco } from "./funil/etapas-regra";

/**
 * O CARTÃO ANDA SOZINHO.
 *
 * O funil já nascia sozinho (lead entrando) e já fechava sozinho (pedido
 * pago). O MIOLO — as etapas entre uma coisa e outra — dependia de alguém
 * lembrar de arrastar cartão. Ninguém arrasta no meio de 40 conversas, e um
 * funil desatualizado é pior que nenhum: você não pode confiar nele.
 *
 * Aqui o cartão avança a partir de coisas que o sistema JÁ SABE (no funil
 * padrão, para as etapas abaixo; a loja com o funil editável escolhe outra
 * etapa ou "não mover" para cada uma — RN-091, `EtapaAutomatica`):
 *  • a vendedora respondeu pela primeira vez  → Primeiro contato
 *  • a cliente ABRIU o catálogo rastreado     → Catálogo enviado
 *  • virou orçamento                          → Pedido em negociação
 *  • pedido aguardando pagamento              → Pagamento pendente
 *
 * DUAS REGRAS DE OURO:
 *  1. só avança, nunca volta. Cliente que já está em "Pagamento pendente" não
 *     regride para "Catálogo enviado" porque abriu o link de novo;
 *  2. nunca derruba a operação. Falhou? A venda continua — o funil é reflexo
 *     do trabalho, não pedágio dele.
 */

/** Etapas que o sistema sabe alcançar sozinho, na ordem do funil. */
export type EtapaAuto = Marco;

/**
 * Avança a negociação ABERTA da cliente até a etapa indicada — se ela ainda
 * não estiver nessa altura do funil. Nunca lança.
 */
export async function avancarFunil(
  companyId: string,
  customerId: string,
  etapa: EtapaAuto,
  /** cartão exato a mover (ex.: o da negociação amarrada ao pedido recém-criado) */
  opportunityId?: string | null
): Promise<void> {
  try {
    const oportunidade = await db.opportunity.findFirst({
      // Com o cartão em mãos, move ELE. Sem ele, SÓ negociação sem pedido
      // amarrado: com duas abertas, avançar a mais recente podia mover o
      // cartão de OUTRO pedido (auditoria 07/08/2026).
      where: opportunityId
        ? { companyId, id: opportunityId, status: "OPEN" }
        : { companyId, customerId, status: "OPEN", order: null },
      orderBy: { createdAt: "desc" },
      include: {
        stage: { select: { id: true, order: true, isWon: true, isLost: true, pipelineId: true } },
      },
    });
    if (!oportunidade?.stage) return;
    // ganhou ou perdeu: o cartão está fechado, nada a fazer
    if (oportunidade.stage.isWon || oportunidade.stage.isLost) return;

    // a etapa que a loja LIGOU a este marco (RN-091) — nunca pelo nome.
    // Sem vínculo ("não mover") ou apontando para etapa fechada: não move.
    // Do MESMO funil do cartão: comparar a ordem de dois funis não diz nada.
    const alvo = await etapaDoMarco(companyId, etapa, oportunidade.stage.pipelineId);
    if (!alvo || alvo.isWon || alvo.isLost) return;

    // SÓ AVANÇA. Nunca puxa o cartão para trás.
    if (alvo.order <= oportunidade.stage.order) return;

    await db.opportunity.update({
      where: { id: oportunidade.id },
      data: { stageId: alvo.id, lastInteractionAt: new Date() },
    });
  } catch {
    // funil nunca bloqueia o trabalho de quem está vendendo
  }
}

/**
 * A CLIENTE ABRIU O CATÁLOGO E NÃO TINHA NEGOCIAÇÃO → o cartão NASCE sozinho.
 *
 * Antes o funil só AVANÇAVA cartão que já existia: mandar o catálogo para uma
 * cliente sem negociação aberta (a recompra é o caso clássico — o cartão
 * anterior já fechou) não aparecia em lugar nenhum, e a vendedora perdia a
 * venda de vista. Agora o clique no link rastreado cria o cartão em
 * a etapa que a loja ligou a "abriu o catálogo" (RN-091; sem vínculo, na
 * primeira etapa aberta).
 * Cliente com negociação aberta segue no fluxo normal do avancarFunil.
 */
export async function nascerCartaoDoCatalogo(
  companyId: string,
  customerId: string
): Promise<void> {
  try {
    // a loja que pediu para NÃO criar oportunidade sozinha (intakeOppPolicy
    // NUNCA) manda aqui também — abrir catálogo não passa por cima da política
    const empresa = await db.company.findUnique({
      where: { id: companyId },
      select: { intakeOppPolicy: true },
    });
    if (!empresa || empresa.intakeOppPolicy === "NUNCA") return;
    const aberta = await db.opportunity.findFirst({
      where: { companyId, customerId, status: "OPEN" },
      select: { id: true },
    });
    if (aberta) return; // já tem negociação correndo: só avança, não duplica
    // a etapa ligada ao marco "abriu o catálogo" (RN-091); sem vínculo, a
    // primeira aberta — o cartão nasce de qualquer jeito, só não sabe onde
    const doMarco = await etapaDoMarco(companyId, "CATALOGO_ENVIADO");
    const alvo =
      (doMarco && !doMarco.isWon && !doMarco.isLost ? doMarco : null) ??
      (await db.stage.findFirst({
        where: { pipeline: { companyId }, isWon: false, isLost: false },
        orderBy: { order: "asc" },
        select: { id: true, name: true },
      }));
    if (!alvo) return;
    const cliente = await db.customer.findFirst({
      where: { id: customerId, companyId },
      select: { ownerId: true },
    });
    if (!cliente) return;
    const criada = await db.opportunity.create({
      data: {
        companyId,
        customerId,
        stageId: alvo.id,
        title: "Abriu o catálogo",
        value: 0,
        ownerId: cliente.ownerId,
        status: "OPEN",
      },
    });
    // corrida do clique duplo (dois track ao mesmo tempo): os dois passam no
    // "não tem aberta" e os dois criam. Regra determinística: sobrevive a
    // mais antiga; quem criou a mais nova apaga a própria.
    const abertas = await db.opportunity.findMany({
      where: { companyId, customerId, status: "OPEN" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (abertas[0]?.id !== criada.id) {
      await db.opportunity.delete({ where: { id: criada.id } });
      return;
    }
    await db.customerEvent.create({
      data: {
        companyId,
        customerId,
        type: "OPORTUNIDADE",
        channel: "CATALOGO_PUBLICO",
        description: `Abriu o catálogo — negociação criada na etapa "${alvo.name}"`,
      },
    });
  } catch {
    // idem: o catálogo nunca deixa de abrir por causa do funil
  }
}
