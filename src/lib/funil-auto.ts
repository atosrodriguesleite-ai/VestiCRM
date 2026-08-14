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
 * O nome desta etapa casa com alguma varia\u00e7\u00e3o aceita? R\u00e9gua \u00daNICA de
 * casamento de etapa \u2014 as automa\u00e7\u00f5es usavam nome exato ("Cat\u00e1logo enviado")
 * enquanto aqui aceit\u00e1vamos variantes: renomear a etapa fazia a sugest\u00e3o
 * sumir em sil\u00eancio (auditoria 07/08/2026).
 */
export function nomeCasaComEtapa(nome: string, etapa: EtapaAuto): boolean {
  return NOMES[etapa].map(semAcento).includes(semAcento(nome));
}

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

/**
 * A CLIENTE ABRIU O CATÁLOGO E NÃO TINHA NEGOCIAÇÃO → o cartão NASCE sozinho.
 *
 * Antes o funil só AVANÇAVA cartão que já existia: mandar o catálogo para uma
 * cliente sem negociação aberta (a recompra é o caso clássico — o cartão
 * anterior já fechou) não aparecia em lugar nenhum, e a vendedora perdia a
 * venda de vista. Agora o clique no link rastreado cria o cartão em
 * "Catálogo enviado" (ou na primeira etapa aberta, se a loja renomeou tudo).
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
    const etapas = await db.stage.findMany({
      where: { pipeline: { companyId } },
      orderBy: { order: "asc" },
      select: { id: true, name: true, isWon: true, isLost: true },
    });
    const alvo =
      etapas.find((e) => nomeCasaComEtapa(e.name, "CATALOGO_ENVIADO")) ??
      etapas.find((e) => !e.isWon && !e.isLost);
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
