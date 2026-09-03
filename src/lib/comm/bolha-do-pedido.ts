/**
 * UMA BOLHA SÓ PARA O PEDIDO DO CATÁLOGO (RN-043).
 *
 * Relato do dono (01/09/2026): fez um pedido de teste pelo catálogo; no
 * WhatsApp do celular apareceu UMA mensagem, na Central do sistema apareceram
 * DUAS, idênticas. Não era o WhatsApp entregando em dobro — isso o webhook já
 * barra pelo id da mensagem. Eram DOIS CAMINHOS gravando a mesma coisa:
 *
 *  1. o catálogo grava a mensagem do pedido na conversa NA HORA em que o
 *     pedido nasce (RN-010: a loja precisa ver o pedido mesmo sem WhatsApp
 *     conectado, e antes de a cliente decidir apertar "enviar" no wa.me);
 *  2. segundos depois a cliente aperta enviar, a mensagem de verdade chega
 *     pelo WhatsApp, e o webhook — que nunca ouviu falar da bolha do
 *     catálogo — grava outra.
 *
 * A regra: a mensagem do WhatsApp que chega com o MESMO texto, da MESMA
 * cliente, dentro da janela, É a bolha do catálogo — ela é reaproveitada,
 * ganha o id do WhatsApp e o status de recebida, e nada é criado e apagado
 * depois (deixaria brecha para o sync mostrar as duas).
 *
 * NOS DOIS SENTIDOS, MAS SÓ DENTRO DA MESMA MEIA HORA. Os dois caminhos
 * chegam juntos e qualquer um pode vencer: se o webhook grava primeiro, é o
 * catálogo que reaproveita a mensagem do WhatsApp (a bolha COM id). O que
 * foi construído e RETIRADO na revisão foi a janela de DIAS para o pedido
 * da fila do aparelho (RN-010): com ela, a cliente que repetisse o MESMO
 * pedido na quinta reaproveitava a bolha de segunda — e, sem apertar enviar
 * no wa.me, o segundo pedido não aparecia no chat NUNCA. Um pedido invisível
 * é pior que uma bolha a mais no reenvio raro da fila. Limite aceito.
 *
 * ONDE ELA MORA: dentro do `intakeLead` (RN-008, a porta única), no MESMO
 * passo que cria a mensagem, sob uma trava por cliente. Conferir por fora,
 * antes de chamar o intake, foi tentado e recusado: os dois caminhos chegam
 * JUNTOS (o navegador dispara o pedido e abre o wa.me no mesmo instante), e
 * conferência separada da criação deixava exatamente a corrida que fazia o
 * duplicado voltar de vez em quando.
 *
 * ESTE ARQUIVO É PURO: a decisão "qual bolha reaproveitar" se testa sem
 * banco. Quem busca as candidatas e trava é o intake.
 */

/**
 * Até quando a bolha do catálogo espera pela mensagem de verdade: a cliente
 * aperta enviar em segundos; meia hora cobre quem deixou a aba do wa.me
 * aberta. Depois disso, o mesmo texto de novo é outro pedido.
 */
export const JANELA_DA_BOLHA_MS = 30 * 60 * 1000;

/**
 * "Mesmo texto" tolera o que o caminho muda sem mudar o conteúdo: espaço no
 * fim, quebra de linha dobrada, acento composto de outro jeito. Não tolera
 * diferença de conteúdo — uma peça a mais é outro pedido.
 */
export function mesmoTexto(a: string, b: string): boolean {
  const limpa = (s: string) =>
    (s ?? "")
      .normalize("NFC")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  const x = limpa(a);
  return x.length > 0 && x === limpa(b);
}

export type BolhaCandidata = {
  id: string;
  body: string;
  /** id no WhatsApp — a bolha do catálogo ainda não tem */
  externalId: string | null;
  /**
   * Em qual conversa a bolha mora (pode não ser a que o intake tem em mãos).
   * OBRIGATÓRIO: o intake compara e consulta por ele — indefinido faria o
   * Prisma ignorar o filtro e devolver a conversa de OUTRA cliente.
   */
  conversationId: string;
};

/**
 * Qual bolha cada caminho pode reaproveitar:
 *  • `do-catalogo` — o WEBHOOK reaproveita a bolha SEM id (a do catálogo).
 *    Nunca a que já tem id: essa veio do próprio WhatsApp, e a cliente mandar
 *    o mesmo texto duas vezes de propósito TEM que aparecer duas vezes, como
 *    no celular dela;
 *  • `do-whatsapp` — o CATÁLOGO reaproveita a bolha COM id (a mensagem de
 *    verdade, quando o webhook venceu a corrida). Nunca a sem id: essa é a
 *    bolha de OUTRO pedido do catálogo, que precisa continuar aparecendo.
 */
export type BolhaAlvo = "do-catalogo" | "do-whatsapp";

/**
 * A bolha a reaproveitar, entre as candidatas (já recortadas pelo intake:
 * mesma cliente, recebidas, só texto, dentro da janela, da mais recente para
 * a mais antiga). Null = não há, cria mensagem nova.
 */
export function escolherBolha(
  candidatas: BolhaCandidata[],
  texto: string,
  alvo: BolhaAlvo
): BolhaCandidata | null {
  if (!texto?.trim()) return null;
  const serve = (c: BolhaCandidata) =>
    alvo === "do-catalogo" ? c.externalId == null : c.externalId != null;
  return candidatas.find((c) => serve(c) && mesmoTexto(c.body, texto)) ?? null;
}
