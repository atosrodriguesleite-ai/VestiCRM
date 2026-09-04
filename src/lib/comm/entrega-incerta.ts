/**
 * ENVIO QUE ESTOUROU O TEMPO NÃO É FALHA — É "AINDA NÃO SABEMOS" (RN-048).
 *
 * Relato do dono (03/09/2026): quatro alarmes vermelhos em 24h na Central de
 * Comunicação, todos do MESMO áudio. O primeiro envio bateu no teto de 50s
 * ("O WhatsApp demorou demais para responder"), a tela mostrou ⚠️ ERRO, a
 * vendedora clicou em Reenviar três vezes — e duas dessas tentativas caíram
 * num instante em que o servidor de conexão estava fora do ar.
 *
 * A bandeira `incerto` já existia no cliente do Evolution, com um aviso
 * escrito em cima dela: *"quem for reenviar (automático ou manual) tem que
 * olhar esta bandeira"*. Só que ninguém olhava — o resultado incerto era
 * gravado como `FALHOU`, exatamente igual a uma recusa. E FALHOU na tela é um
 * convite para reenviar: é o incidente da cliente recebendo a mesma mensagem
 * duas vezes, de novo, agora pela mão da vendedora.
 *
 * A regra tem três partes:
 *
 *  1. **Tempo esgotado não vira vermelho.** A mensagem continua ENVIANDO, com
 *     o motivo guardado, e a tela diz "confirmando entrega". Quem resolve é o
 *     ECO do próprio WhatsApp: toda mensagem que a loja manda volta pelo
 *     webhook, e o resgate que já existe adota a bolha e a marca como enviada.
 *     Só faltava dar TEMPO para esse eco chegar.
 *  2. **A espera tem fim.** Passada a janela sem eco nenhum, aí sim é falha —
 *     dizer "confirmando" para sempre esconderia a mensagem que realmente não
 *     saiu, e a cliente ficaria sem resposta com a loja achando que respondeu.
 *  3. **Erro de CONEXÃO é outra coisa.** Quando a conexão nem chegou a ser
 *     feita (servidor fora do ar por alguns instantes, DNS falhando), a
 *     mensagem com certeza NÃO saiu: essa dá para tentar de novo sozinho, sem
 *     risco nenhum de duplicar. É o único caso em que reenviar automático é
 *     seguro — e é o que resolve a queda de instantes sem incomodar ninguém.
 *
 * ESTE ARQUIVO É PURO: as três decisões se testam sem rede e sem banco.
 */

/**
 * Quanto tempo a mensagem fica "confirmando entrega" antes de virar falha.
 *
 * O eco do WhatsApp costuma voltar em segundos; três minutos cobrem o servidor
 * de conexão engasgado se recuperando. Mais que isso faria a vendedora esperar
 * demais por uma mensagem que talvez precise mesmo ser reenviada.
 */
export const MS_CONFIRMANDO_ENTREGA = 3 * 60_000;

/**
 * Erros de rede em que a requisição com CERTEZA não chegou ao servidor —
 * a conexão nem foi estabelecida. Medido no Node deste projeto: o `fetch`
 * levanta `TypeError` com o código real em `cause.code`.
 *
 * `ECONNRESET` fica DE FORA de propósito: a conexão cair no meio pode ter
 * acontecido depois de o servidor receber tudo, e aí tentar de novo mandaria
 * a mensagem duas vezes — o erro que esta regra inteira existe para evitar.
 */
const NAO_SAIU_DO_LUGAR = new Set([
  "ECONNREFUSED", // servidor fora do ar
  "ENOTFOUND", // nome não resolveu
  "EAI_AGAIN", // DNS temporariamente indisponível
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", // estourou ANTES de conectar
]);

/** O erro do `fetch` prova que a requisição não saiu? */
export function requisicaoNaoSaiu(erro: unknown): boolean {
  const code = (erro as { cause?: { code?: string } })?.cause?.code;
  return typeof code === "string" && NAO_SAIU_DO_LUGAR.has(code);
}

/** Tempo esgotado esperando a resposta (pode ter sido entregue). */
export function tempoEsgotado(erro: unknown): boolean {
  return (erro as Error)?.name === "TimeoutError";
}

export type SituacaoDoEnvio = "entregue" | "confirmando" | "falhou";

/**
 * Em que estado a mensagem fica depois da tentativa.
 *
 * `confirmando` é o estado novo: não é sucesso (ninguém confirmou) e não é
 * falha (pode ter chegado). É o que impede a bolha vermelha com botão de
 * reenviar em cima de uma mensagem que a cliente já recebeu.
 */
export function situacaoDoEnvio(r: {
  ok: boolean;
  incerto?: boolean;
}): SituacaoDoEnvio {
  if (r.ok) return "entregue";
  return r.incerto ? "confirmando" : "falhou";
}

/**
 * A janela de confirmação venceu? (usada pela varredura que fecha o caso)
 *
 * Estritamente MAIOR: no limite exato ainda vale esperar — arredondar para
 * baixo transformaria em falha uma mensagem cujo eco está chegando.
 */
export function confirmacaoVenceu(desde: Date, agora: Date): boolean {
  const decorrido = agora.getTime() - desde.getTime();
  if (!Number.isFinite(decorrido)) return false;
  return decorrido > MS_CONFIRMANDO_ENTREGA;
}

/**
 * O que a mensagem passa a dizer quando a janela venceu sem eco nenhum.
 * Nunca afirma que não chegou — só que não deu para confirmar, porque é
 * exatamente essa a verdade, e a vendedora precisa saber que reenviar pode
 * duplicar.
 */
export const AVISO_SEM_CONFIRMACAO =
  "Não deu para confirmar a entrega desta mensagem. Ela PODE ter chegado — confira a conversa no celular antes de reenviar.";
