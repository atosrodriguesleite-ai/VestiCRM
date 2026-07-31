/**
 * MENSAGEM EDITADA PELA CLIENTE.
 *
 * Incidente real (Toque Leve, 31/07/2026): a cliente mandou o pedido
 * "Regata nadador branca / 1 M 1 G", EDITOU logo depois acrescentando
 * "1 M vinho" — e o sistema continuou mostrando a versão VELHA. A loja ia
 * separar o pedido faltando uma peça, sem desconfiar de nada. No lugar da
 * correção apareceu uma bolha "[mensagem não exibida aqui] (…)".
 *
 * Por quê: a edição chega do WhatsApp em MAIS DE UM FORMATO, e a gente só
 * conhecia um. Pior: o id da mensagem a corrigir vem DENTRO do aviso de
 * edição — usar o id do próprio aviso (que é novo) nunca acha o alvo.
 *
 * Aqui a leitura fica num lugar só, entendendo todos os formatos conhecidos:
 *
 *   1. protocolMessage tipo MESSAGE_EDIT (o mais comum hoje)
 *      → texto em protocolMessage.editedMessage, alvo em protocolMessage.key
 *   2. editedMessage embrulhando um protocolMessage
 *   3. editedMessage com o texto direto (o formato que a gente já lia)
 *   4. secretEncryptedMessage — a edição vem CRIPTOGRAFADA e não dá para ler.
 *      Não dá para mostrar o texto novo, mas dá para dizer a verdade: marcar
 *      a mensagem como editada, para a loja saber que precisa conferir no
 *      WhatsApp. Melhor que uma bolha enigmática solta na conversa.
 */

import { evoFindMessages } from "./evolution";
import { lerMensagemWA } from "./wa-message";

type Qualquer = Record<string, unknown>;

const obj = (v: unknown): Qualquer | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Qualquer) : null;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Texto de um conteúdo de mensagem simples (texto puro ou com formatação). */
function textoDoConteudo(conteudo: unknown): string {
  const c = obj(conteudo);
  if (!c) return "";
  return str(c.conversation) || str(obj(c.extendedTextMessage)?.text);
}

export type Edicao = {
  /** id da mensagem que deve ser corrigida (null = não deu para saber qual) */
  alvoId: string | null;
  /** texto novo; vazio quando a edição veio criptografada e não dá para ler */
  texto: string;
};

/**
 * Lê o evento e devolve a edição, ou `null` quando o evento não é uma edição.
 * Nunca lança: payload torto vira `null` e a mensagem segue o fluxo normal.
 */
export function lerEdicao(evento: unknown): Edicao | null {
  const m = obj(evento);
  if (!m) return null;
  const msg = obj(m.message);
  if (!msg) return null;
  const idDoEvento = str(obj(m.key)?.id) || null;

  // 1. protocolMessage tipo MESSAGE_EDIT — o alvo vem DENTRO dele
  const proto = obj(msg.protocolMessage);
  if (proto) {
    const tipo = str(proto.type).toUpperCase();
    const ehEdicao = tipo === "MESSAGE_EDIT" || proto.type === 14;
    const texto = textoDoConteudo(proto.editedMessage);
    if (ehEdicao || texto) {
      return { alvoId: str(obj(proto.key)?.id) || idDoEvento, texto };
    }
  }

  // 2 e 3. editedMessage: pode embrulhar um protocolMessage ou trazer o texto
  const editada = obj(msg.editedMessage);
  if (editada) {
    const dentro = obj(editada.message);
    const protoDentro = obj(dentro?.protocolMessage);
    if (protoDentro) {
      return {
        alvoId: str(obj(protoDentro.key)?.id) || idDoEvento,
        texto: textoDoConteudo(protoDentro.editedMessage),
      };
    }
    const texto = textoDoConteudo(dentro);
    if (texto) return { alvoId: idDoEvento, texto };
  }

  // 4. edição criptografada: dá para saber QUAL mensagem, não O QUE mudou
  const secreta = obj(msg.secretEncryptedMessage);
  if (secreta) {
    const alvo =
      str(obj(secreta.targetMessageKey)?.id) ||
      str(obj(secreta.targetMessageId)) ||
      null;
    // sem alvo não é edição para nós: deixa virar bolha (nada se perde)
    if (alvo) return { alvoId: alvo, texto: "" };
  }

  return null;
}

/**
 * Acha a mensagem dentro do que o servidor Evolution devolveu.
 *
 * A resposta muda de formato entre versões: às vezes é uma lista solta, às
 * vezes vem embrulhada em `messages.records`. Em vez de adivinhar o caminho,
 * procura o primeiro item que tenha `message` — a estrutura muda, a mensagem
 * continua sendo uma mensagem.
 */
export function acharMensagemNaResposta(resposta: unknown): Qualquer | null {
  let achada: Qualquer | null = null;
  const visitados = new Set<unknown>();
  const procurar = (no: unknown, nivel: number) => {
    if (achada || !no || typeof no !== "object" || nivel > 6) return;
    if (visitados.has(no)) return;
    visitados.add(no);
    if (Array.isArray(no)) {
      for (const item of no) procurar(item, nivel + 1);
      return;
    }
    const o = no as Qualquer;
    if (obj(o.message) && obj(o.key)) {
      achada = o;
      return;
    }
    for (const valor of Object.values(o)) procurar(valor, nivel + 1);
  };
  procurar(resposta, 0);
  return achada;
}

/**
 * TEXTO NOVO DE UMA EDIÇÃO CIFRADA.
 *
 * Quando a edição chega criptografada, o aviso não traz o texto — mas o
 * SERVIDOR já tem a mensagem atualizada. Então, em vez de deixar a vendedora
 * sem saber o que mudou, o sistema PERGUNTA.
 *
 * Isso importa porque nem toda vendedora tem o celular do WhatsApp na mão:
 * mandar ela "conferir no aplicativo" não é resposta. (Toque Leve: a cliente
 * acrescentou "1 M vinho" ao pedido editando a mensagem.)
 *
 * Nunca lança e nunca trava o webhook: no pior caso devolve vazio e a
 * mensagem segue marcada como "editada".
 */
export async function buscarTextoAtual(
  instance: string | null,
  messageId: string
): Promise<string> {
  if (!instance || !messageId) return "";
  try {
    const res = await evoFindMessages(instance, { id: messageId });
    if (!res.ok || !res.data) return "";
    const m = acharMensagemNaResposta(res.data);
    if (!m) return "";
    // a mensagem guardada no servidor já vem com o texto EDITADO; e se ela
    // mesma estiver embrulhada num aviso de edição, a leitura resolve
    const dela = lerEdicao(m);
    if (dela?.texto) return dela.texto;
    return lerMensagemWA(m as { message?: never }).text.trim();
  } catch {
    return "";
  }
}
