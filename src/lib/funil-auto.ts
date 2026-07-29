import { db } from "./db";

/**
 * O CARTÃO ANDA SOZINHO.
 *
 * O funil já nascia sozinho (lead entrando) e já fechava sozinho (pedido
 * pago). O MIOLO — as etapas entre uma coisa e outra — dependia de alguém
 * lembrar de arrastar cartão. Ninguém arrasta no meio de 40 conversas, e um
 * funil desatualizado é pior que nenhum: você não pode confiar nele.
 *
 * Aqui o cartão avança a partir de coisas que o sistema JÁ SABE:
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
export type EtapaAuto =
  | "PRIMEIRO_CONTATO"
  | "CATALOGO_ENVIADO"
  | "NEGOCIACAO"
  | "PAGAMENTO";

/**
 * Nomes aceitos para cada etapa. Hoje a loja não consegue renomear etapas
 * (não existe tela), mas quando existir, variações comuns continuam casando —
 * e o que não casar simplesmente não move nada, sem quebrar.
 */
const NOMES: Record<EtapaAuto, string[]> = {
  PRIMEIRO_CONTATO: ["primeiro contato", "em conversa", "contato realizado"],
  CATALOGO_ENVIADO: ["catálogo enviado", "catalogo enviado", "enviou catálogo"],
  NEGOCIACAO: ["pedido em negociação", "pedido em negociacao", "negociando", "negociação"],
  PAGAMENTO: ["pagamento pendente", "aguardando pagamento"],
};

const semAcento = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/**
 * Avança a negociação ABERTA da cliente até a etapa indicada — se ela ainda
 * não estiver nessa altura do funil. Nunca lança.
 */
export async function avancarFunil(
  companyId: string,
  customerId: string,
  etapa: EtapaAuto
): Promise<void> {
  try {
    const oportunidade = await db.opportunity.findFirst({
      where: { companyId, customerId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: { stage: { select: { id: true, order: true, isWon: true, isLost: true } } },
    });
    if (!oportunidade?.stage) return;
    // ganhou ou perdeu: o cartão está fechado, nada a fazer
    if (oportunidade.stage.isWon || oportunidade.stage.isLost) return;

    const etapas = await db.stage.findMany({
      where: { pipeline: { companyId } },
      select: { id: true, name: true, order: true },
      orderBy: { order: "asc" },
    });
    const aceitos = NOMES[etapa].map(semAcento);
    const alvo = etapas.find((e) => aceitos.includes(semAcento(e.name)));
    // a loja não tem essa etapa: não inventa, só não move
    if (!alvo) return;

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
