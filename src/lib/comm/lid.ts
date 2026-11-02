/**
 * O TELEFONE DE QUEM MANDOU — inclusive quando o WhatsApp esconde o número.
 *
 * O WhatsApp vem trocando a identidade de alguns contatos por um código
 * próprio (LID, "linked identifier"): `remoteJid` chega como `123@lid` em vez
 * de `5511999998888@s.whatsapp.net`. O telefone de verdade viaja em OUTRO
 * campo da chave — e o nome desse campo mudou com as versões do servidor
 * Evolution: `senderPn` (2.3.0/2.3.1), `remoteJidAlt` (2.3.6 em diante). O
 * leitor que só conhecia `senderPn` descartava a mensagem do contato LID numa
 * versão mais nova — a cliente escrevia e a loja nunca via (RN-105).
 *
 * Regra: o JID direto de telefone vale sempre; sendo LID, qualquer um dos
 * campos conhecidos que traga um telefone (8 a 15 dígitos) serve, nesta
 * ordem; um campo que também seja `@lid` é código, não número, e não conta.
 * Grupo (`@g.us`) e status ficam de fora aqui também — grupo é descartado na
 * porta de propósito (cliente aqui é uma pessoa com telefone).
 */

export type ChaveDoWhatsApp = {
  remoteJid?: string | null;
  senderPn?: string | null;
  remoteJidAlt?: string | null;
};

/**
 * Extrai o telefone (dígitos) de um JID "5511999999999@s.whatsapp.net". O
 * sufixo de aparelho do formato do Baileys ("5511…:3@s.whatsapp.net") é
 * aceito e DESCARTADO — nem rejeitar (perderia a mensagem) nem colar no
 * número (criaria cadastro de ninguém, RN-096); achados da revisão.
 */
export function telefoneDoJid(jid: string): string | null {
  const m = jid.match(/^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/);
  return m ? m[1] : null; // grupos (@g.us) e afins ficam de fora
}

// `remoteJidAlt` é o par do `remoteJid` — a OUTRA ponta da conversa nos dois
// sentidos; `senderPn` é quem MANDOU, e no eco do celular da loja pode ser a
// própria loja. Por isso o par vem primeiro, e o `senderPn` fica de reserva
// para as versões 2.3.0/2.3.1, que só têm ele (achado da revisão).
const CAMPOS_DO_TELEFONE_REAL = ["remoteJidAlt", "senderPn"] as const;

/**
 * O campo alternativo é mais TOLERANTE que o JID direto — é por ele que a
 * mensagem do contato LID entra, e o leitor antigo ("tudo que não é dígito
 * fora") aceitava "+55…" e outros domínios (`@c.us`): recusá-los agora
 * perderia a mensagem que antes entrava (achado da revisão). O que segue
 * fora: o sufixo de aparelho (descartado, nunca colado — RN-096), código
 * `@lid`, grupo e status — isso não é telefone.
 */
function digitosDeTelefone(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  const arroba = valor.indexOf("@");
  const local = arroba >= 0 ? valor.slice(0, arroba) : valor;
  const dominio = arroba >= 0 ? valor.slice(arroba + 1).toLowerCase() : null;
  if (dominio === "lid" || dominio === "g.us" || dominio === "broadcast") return null;
  if (dominio !== null && !/^[a-z0-9.]+$/.test(dominio)) return null;
  // espaço, hífen, parêntese e ponto são formatação ("+55 11 99999-8888"), não número
  const m = local.replace(/[\s().-]/g, "").match(/^\+?(\d{8,15})(?::\d+)?$/);
  return m ? m[1] : null;
}

/** O telefone (dígitos) de quem mandou, pela chave da mensagem; null = não dá para saber. */
export function telefoneDaChave(key: ChaveDoWhatsApp | null | undefined): string | null {
  const jid = key?.remoteJid ?? "";
  const direto = telefoneDoJid(jid);
  if (direto) return direto;
  if (!jid.endsWith("@lid")) return null;
  for (const campo of CAMPOS_DO_TELEFONE_REAL) {
    const d = digitosDeTelefone(key?.[campo]);
    if (d) return d;
  }
  return null;
}
