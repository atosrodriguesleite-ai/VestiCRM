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
 *      Com alvo, o sistema pergunta o texto novo ao servidor (buscarTextoAtual);
 *      SEM alvo (incidente Giovana, 13/08/2026), confere a conversa inteira
 *      (textosAtuaisDaConversa) e corrige o que mudou. Só quando nada disso
 *      dá certo entra um aviso honesto em português — nunca mais a bolha
 *      enigmática "(secretEncryptedMessage)".
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

  // 4. edição criptografada: dá para saber QUAL mensagem, não O QUE mudou.
  // O nome do campo do alvo varia entre versões do servidor — todos os
  // conhecidos entram aqui (incidente Giovana, 13/08/2026: o aviso chegou sem
  // NENHUM deles e virava bolha "(secretEncryptedMessage)" na conversa).
  const secreta = obj(msg.secretEncryptedMessage);
  if (secreta) {
    const alvo =
      str(obj(secreta.targetMessageKey)?.id) ||
      str(obj(secreta.messageKey)?.id) ||
      str(obj(secreta.key)?.id) ||
      str(secreta.targetMessageId) ||
      str(secreta.targetId) ||
      null;
    // MESMO SEM ALVO continua sendo uma edição — quem recebe decide o que
    // fazer (o webhook confere a conversa inteira no servidor). Devolver null
    // aqui era o que deixava a bolha enigmática nascer.
    return { alvoId: alvo, texto: "" };
  }

  return null;
}

/**
 * TEXTO ATUAL DAS ÚLTIMAS MENSAGENS DA CONVERSA, direto do servidor.
 *
 * É o plano de resgate da edição cifrada SEM alvo (incidente Giovana,
 * 13/08/2026): o aviso não diz nem o texto novo nem QUAL mensagem mudou.
 * Mas o servidor da loja guarda a conversa já atualizada — então o sistema
 * pede as últimas mensagens e devolve `id → texto` para o webhook comparar
 * com o que está gravado e corrigir o que mudou.
 *
 * SÓ TEXTO PURO entra no mapa: mídia tem corpo derivado no sistema
 * ("[foto]", "[áudio]") e um eco do servidor não pode sobrescrever isso —
 * carimbaria "editada" à toa (mesma régua do recibo de status).
 *
 * Nunca lança: qualquer falha devolve mapa vazio e a conversa segue.
 */
export async function textosAtuaisDaConversa(
  instance: string | null,
  remoteJid?: string | null
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!instance || !remoteJid) return mapa;
  try {
    const r = await evoFindMessages(instance, { remoteJid, offset: 50 });
    if (!r.ok || !r.data) return mapa;
    for (const m of acharTodasAsMensagens(r.data)) {
      const id = str(obj(m.key)?.id);
      if (!id) continue;
      // se a própria mensagem guardada for um aviso de edição, a leitura
      // resolve; senão vale só o texto simples (conversation/extendedText)
      const texto = lerEdicao(m)?.texto || textoDoConteudo(m.message);
      if (texto) mapa.set(id, texto);
    }
    return mapa;
  } catch {
    return mapa;
  }
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
  messageId: string,
  remoteJid?: string | null
): Promise<string> {
  if (!instance || !messageId) return "";

  const texto = (m: Qualquer | null): string => {
    if (!m) return "";
    // a mensagem guardada no servidor já vem com o texto EDITADO; e se ela
    // mesma estiver embrulhada num aviso de edição, a leitura resolve
    const dela = lerEdicao(m);
    if (dela?.texto) return dela.texto;
    // leitura DESCONHECIDA não é texto: é o placeholder "[mensagem não
    // exibida aqui]" — devolvê-lo sobrescreveria a mensagem real da cliente
    // com código de programador (achado da revisão de 17/08/2026)
    const leitura = lerMensagemWA(m as { message?: never });
    return leitura.desconhecida ? "" : leitura.text.trim();
  };

  try {
    // 1ª tentativa: pedir a mensagem pelo id (o caminho direto)
    const porId = await evoFindMessages(instance, { id: messageId });
    if (porId.ok && porId.data) {
      const achado = texto(acharMensagemNaResposta(porId.data));
      if (achado) return achado;
    }

    // 2ª tentativa: nem toda versão do servidor aceita filtrar por id. Então
    // pede as últimas da CONVERSA e procura a nossa na lista.
    if (!remoteJid) return "";
    const daConversa = await evoFindMessages(instance, { remoteJid, offset: 50 });
    if (!daConversa.ok || !daConversa.data) return "";
    const lista = acharTodasAsMensagens(daConversa.data);
    const nossa = lista.find((x) => str(obj(x.key)?.id) === messageId) ?? null;
    return texto(nossa);
  } catch {
    return "";
  }
}

/** Todas as mensagens de uma resposta do servidor, em qualquer formato. */
export function acharTodasAsMensagens(resposta: unknown): Qualquer[] {
  const achadas: Qualquer[] = [];
  const visitados = new Set<unknown>();
  const procurar = (no: unknown, nivel: number) => {
    if (!no || typeof no !== "object" || nivel > 6) return;
    if (visitados.has(no)) return;
    visitados.add(no);
    if (Array.isArray(no)) {
      for (const item of no) procurar(item, nivel + 1);
      return;
    }
    const o = no as Qualquer;
    if (obj(o.message) && obj(o.key)) {
      achadas.push(o);
      return;
    }
    for (const valor of Object.values(o)) procurar(valor, nivel + 1);
  };
  procurar(resposta, 0);
  return achadas;
}
