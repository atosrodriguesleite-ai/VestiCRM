/**
 * O QUE É "FILA" NA CENTRAL DE ATENDIMENTO.
 *
 * Fila é cliente ESPERANDO resposta. Só isso. É a lista que a equipe olha
 * pensando "quem está sem atendimento agora?" — e por isso ela precisa ser
 * verdadeira: fila com conversa que ninguém está esperando vira lista que
 * todo mundo ignora, e aí o cliente que está de verdade esperando some no
 * meio.
 *
 * O erro que este arquivo conserta: a regra antiga era "sem responsável =
 * fila". Aí quando a LOJA começava a conversa (mandando mensagem pelo
 * celular, por exemplo), a conversa nascia sem dono e caía na fila — como se
 * a cliente estivesse esperando atendimento, sendo que quem falou foi a loja.
 * A lojista descreveu exatamente assim: "mandei mensagem para a cliente e a
 * conversa foi para a fila; esse fluxo não faz sentido".
 */

export type AbaDaCentral = "chats" | "fila" | "contatos";

type ConversaParaAba = {
  status: string;
  assignee?: { id: string } | null;
  lastInboundAt?: string | Date | null;
  lastOutboundAt?: string | Date | null;
};

const ms = (d: string | Date | null | undefined): number | null => {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * A cliente está esperando resposta? Sim quando a última movimentação da
 * conversa foi dela: escreveu e ninguém respondeu depois disso.
 */
export function clienteEsperando(c: ConversaParaAba): boolean {
  const entrou = ms(c.lastInboundAt);
  if (entrou === null) return false; // a cliente nunca escreveu: ninguém espera
  const saiu = ms(c.lastOutboundAt);
  return saiu === null || saiu < entrou;
}

/**
 * Em que aba a conversa aparece.
 *
 *  • contatos = encerrada (histórico)
 *  • fila     = sem responsável E com a cliente esperando resposta
 *  • chats    = todo o resto (em atendimento, com dono ou não)
 */
export function abaDaConversa(c: ConversaParaAba): AbaDaCentral {
  if (c.status === "CLOSED") return "contatos";
  if (!c.assignee && clienteEsperando(c)) return "fila";
  return "chats";
}
