/**
 * O NOME DA CLIENTE QUE O WHATSAPP MANDA JUNTO.
 *
 * Incidente real (Toque Leve, 31/07/2026): entrou uma conversa chamada
 * "Lead 9621". A cliente TEM nome no WhatsApp, mas o sistema não achou e
 * batizou o contato com o número.
 *
 * Por quê: o nome vem no campo `pushName`, e a gente lia esse campo em UM
 * lugar só — na mensagem. Só que o servidor Evolution muda o lugar conforme
 * a versão e o tipo de evento: às vezes o nome vem na mensagem, às vezes na
 * raiz do aviso, às vezes só depois, num aviso separado de contato
 * (`contacts.upsert`), e conta de empresa manda em `verifiedBizName`.
 *
 * Aqui a leitura fica num lugar só e procura em todos os campos conhecidos.
 * Duas cautelas que valem ouro:
 *
 *   • NOME DE GRUPO NÃO É NOME DE PESSOA — `subject` fica de fora.
 *   • Em mensagem enviada por NÓS (`fromMe`), o `pushName` é o nome da
 *     PRÓPRIA LOJA. Usar isso batizaria a cliente com o nome da loja.
 *   • Número não é nome: "5582996649621" seria só trocar um crachá por
 *     outro, então é descartado.
 */

/** Campos onde o WhatsApp/Evolution já foi visto mandando o nome de quem fala. */
const CAMPOS_DE_NOME = [
  "pushName",
  "pushname",
  "notifyName",
  "verifiedBizName",
  "verifiedName",
  "profileName",
] as const;

type Qualquer = Record<string, unknown>;

const obj = (v: unknown): Qualquer | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Qualquer) : null;

/**
 * O texto serve como nome de gente?
 *
 * Só dígitos e pontuação é telefone disfarçado de nome (o WhatsApp manda o
 * próprio número quando a pessoa não pôs nome no perfil). Trocar o crachá do
 * sistema por esse não melhora nada.
 */
export function nomeUtil(valor: unknown): string {
  const n = typeof valor === "string" ? valor.trim() : "";
  if (n.length < 2 || n.length > 80) return "";
  if (/^[\d\s()+.\-@]+$/.test(n)) return "";
  return n;
}

/**
 * Lê o nome de quem MANDOU a mensagem, procurando em todos os campos
 * conhecidos — na própria mensagem e na raiz do aviso do servidor.
 *
 * `fromMe` protege o caso mais perigoso: em mensagem que a LOJA enviou pelo
 * celular, o nome que vem é o da loja.
 */
export function nomeDeQuemMandou(mensagem: unknown, raiz?: unknown): string {
  const m = obj(mensagem);
  if (!m) return "";
  if (obj(m.key)?.fromMe === true) return "";
  for (const campo of CAMPOS_DE_NOME) {
    const achado = nomeUtil(m[campo]);
    if (achado) return achado;
  }
  const r = obj(raiz);
  if (r) {
    for (const campo of CAMPOS_DE_NOME) {
      const achado = nomeUtil(r[campo]);
      if (achado) return achado;
    }
  }
  return "";
}

export type ContatoDoWhatsapp = { jid: string; nome: string };

/**
 * AVISO DE CONTATO (`contacts.upsert` / `contacts.update`).
 *
 * O servidor manda esse aviso quando FICA SABENDO o nome de alguém — o que
 * muitas vezes acontece DEPOIS da primeira mensagem. Era exatamente esse
 * aviso que a gente jogava fora: o nome chegava e o contato continuava
 * "Lead 9621" para sempre.
 *
 * Devolve a lista de contatos (jid + nome) que dá para aproveitar. Vem como
 * lista ou como um objeto só, conforme a versão do servidor.
 */
export function lerContatos(dados: unknown): ContatoDoWhatsapp[] {
  const lista = Array.isArray(dados) ? dados : [dados];
  const saida: ContatoDoWhatsapp[] = [];
  for (const item of lista) {
    const c = obj(item);
    if (!c) continue;
    const jid =
      (typeof c.id === "string" && c.id) ||
      (typeof c.remoteJid === "string" && c.remoteJid) ||
      (typeof obj(c.key)?.id === "string" && (obj(c.key)!.id as string)) ||
      "";
    // grupo, lista de transmissão e status não são cliente
    if (!jid || !jid.includes("@s.whatsapp.net")) continue;
    const nome =
      nomeUtil(c.pushName) ||
      nomeUtil(c.name) ||
      nomeUtil(c.verifiedName) ||
      nomeUtil(c.notify);
    if (!nome) continue;
    saida.push({ jid, nome });
  }
  return saida;
}
