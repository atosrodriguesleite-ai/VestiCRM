/**
 * A CENTRAL SÓ APARECE PARA QUEM JÁ TEM WHATSAPP (RN-049).
 *
 * Relato do dono (05/09/2026): a loja que NUNCA conectou o WhatsApp abria a
 * aba e via a fila e o chat cheios — de pedidos do catálogo. Não é defeito:
 * todo pedido do catálogo entra pelo portão único de leads (RN-008) e nasce
 * com cliente, conversa, oportunidade e tarefa, justamente para nada se
 * perder (RN-010) e para a conversa já existir quando a cliente apertar
 * "enviar" no wa.me (RN-043). Mas para a loja sem WhatsApp isso é uma fila
 * que ninguém vai atender ali — barulho, e pior: parece que o sistema está
 * pedindo uma resposta que não tem por onde sair.
 *
 * A decisão (alinhada com o dono): **por trás nada muda** — cliente, funil,
 * tarefa, histórico e a bolha do pedido continuam nascendo, porque no dia em
 * que a loja conectar tudo já está lá. O que muda é a TELA: sem WhatsApp, a
 * aba vira o convite "Conecte seu WhatsApp". Os pedidos seguem na tela
 * Pedidos e no sino.
 *
 * O SINAL NÃO É "ESTÁ CONECTADO AGORA". É "ESTA LOJA JÁ TEVE WHATSAPP":
 * a conexão cai (aparelho desligado, sessão vencida) e a loja que já
 * conversou com clientes de verdade não pode ver o histórico sumir atrás de
 * uma tela de conectar — foi o segundo pedido do dono. A prova é o CARIMBO
 * da primeira conexão (`CommSettings.whatsappConectadoEm`), gravado quando
 * a conexão vira real e nunca apagado — o Desconectar zera instância,
 * telefone e provedor, e só o carimbo separa "nunca conectou" de
 * "desconectou ontem". Inferir pela mensagem com id foi tentado e recusado
 * na revisão: o provedor simulado e a tela de simulação também carimbam id,
 * e a loja sem WhatsApp reabria a fila por engano.
 *
 * A loja de demonstração fica sempre com a Central: é vitrine.
 *
 * ESTE ARQUIVO É PURO: a decisão se testa sem banco. Quem lê os sinais é a
 * página; quem grava o carimbo é `primeira-conexao.ts`.
 */

export type SinalDaCentral = {
  /** provedor configurado: MOCK (nenhum) | EVOLUTION | CLOUD_API */
  activeProvider: string | null | undefined;
  /** estado da conexão Evolution: DESCONECTADO | AGUARDANDO_QR | CONECTADO */
  evolutionStatus: string | null | undefined;
  /** a loja já conectou alguma vez (carimbo da primeira conexão) */
  jaConectou: boolean;
  /** a loja de demonstração da plataforma */
  lojaDemo: boolean;
};

/** A aba WhatsApp mostra a Central (fila, chats, contatos)? */
export function centralDisponivel(s: SinalDaCentral): boolean {
  if (s.lojaDemo) return true;
  // conectado agora (Evolution) ou com a API oficial configurada
  if (s.evolutionStatus === "CONECTADO") return true;
  if (s.activeProvider === "CLOUD_API") return true;
  // já teve: o histórico NUNCA some atrás da tela de conectar
  return s.jaConectou;
}
