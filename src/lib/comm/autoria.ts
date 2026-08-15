/**
 * QUEM MANDOU A MENSAGEM — informação INTERNA da loja.
 *
 * Numa loja com várias atendentes, saber quem respondeu o quê é organização
 * básica: cobrança de follow-up, comissão, treinamento, "quem prometeu esse
 * desconto?". O WhatsApp comum não tem isso — o cliente só vê "a loja".
 *
 * Duas regras mandam aqui:
 *
 *  1. O NOME É SÓ DA EQUIPE. Ele aparece na tela do sistema e NUNCA vai
 *     junto no texto que sai para a cliente. O que a cliente recebe é
 *     exatamente o que foi digitado, sem assinatura nenhuma.
 *  2. NUNCA CHUTAR O AUTOR. Mensagem enviada pelo aplicativo do WhatsApp no
 *     celular chega ao sistema como eco: o WhatsApp não conta quem digitou
 *     (é o mesmo número para a loja inteira). Nesse caso o sistema diz
 *     "pelo celular" e explica o porquê — inventar um nome provável seria
 *     pior do que não ter nome.
 */

export type TipoAutoria =
  /** alguém da equipe respondeu DENTRO do sistema (sabemos quem) */
  | "PESSOA"
  /** saiu pelo aplicativo do WhatsApp, fora do sistema (não dá para saber) */
  | "CELULAR"
  /** nota interna sem autor registrado (histórico antigo) */
  | "EQUIPE";

export type Autoria = {
  tipo: TipoAutoria;
  /** rótulo curto, do tamanho da bolha */
  rotulo: string;
  /** explicação completa (aparece ao passar o mouse) */
  detalhe: string;
};

/** Primeiro nome — é o que cabe na bolha sem quebrar a linha. */
export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

export const AVISO_CELULAR =
  "Enviada pelo aplicativo do WhatsApp, fora do sistema — o WhatsApp não " +
  "informa quem digitou. Respondendo pela Central de Atendimento, o nome de " +
  "quem atendeu fica registrado.";

/**
 * Autoria de uma mensagem para mostrar na tela da equipe.
 * Devolve null para mensagem da cliente (aí o autor é ela mesma).
 */
export function autoriaDaMensagem(m: {
  direction: string;
  kind?: string | null;
  authorName?: string | null;
}): Autoria | null {
  if (m.direction !== "OUT") return null;

  if (m.authorName?.trim()) {
    return {
      tipo: "PESSOA",
      rotulo: primeiroNome(m.authorName),
      detalhe: `Enviada por ${m.authorName.trim()} pela Central de Atendimento`,
    };
  }

  // nota interna nunca sai do sistema: ela não pode ter vindo do celular
  if (m.kind === "NOTE") {
    return {
      tipo: "EQUIPE",
      rotulo: "equipe",
      detalhe: "Nota interna sem autor registrado (anotação antiga).",
    };
  }

  return { tipo: "CELULAR", rotulo: "pelo celular", detalhe: AVISO_CELULAR };
}

/**
 * Prefixo da prévia na LISTA de conversas ("Júlia: ok, já separo").
 * É o mesmo hábito do grupo de WhatsApp: bate o olho e sabe quem falou.
 */
export function prefixoDaPrevia(m: {
  direction: string;
  kind?: string | null;
  authorName?: string | null;
}): string {
  if (m.kind === "NOTE") return "📝 ";
  const a = autoriaDaMensagem(m);
  if (!a) return "";
  return a.tipo === "CELULAR" ? "📱 " : `${a.rotulo}: `;
}
