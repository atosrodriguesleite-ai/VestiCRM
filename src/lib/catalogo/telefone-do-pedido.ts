import { mesmoNumero } from "../telefone";
import { telefoneParecido } from "../contatos-parecidos";

/**
 * QUAL TELEFONE VALE NO PEDIDO DO CATÁLOGO (RN-021).
 *
 * Incidente Toque Leve (20/08/2026): a cliente errou UM dígito ao preencher
 * o pedido. Como o telefone digitado sempre mandava, nasceu um SEGUNDO
 * cadastro — e com ele uma segunda conversa. A Nívia atendia pelo WhatsApp
 * de verdade e a Letícia respondia no cadastro do número errado: cada uma
 * via metade do assunto, e o que saía pelo número errado ficava no ✓ simples
 * para sempre, porque não existe ninguém naquele número.
 *
 * A regra: quando a cliente entra pelo LINK PESSOAL dela (`?c=`, o que a
 * vendedora mandou no WhatsApp dela), esse número é VERIFICADO — ela está
 * falando dele agora. O que ela digita no formulário é palpite, e palpite não
 * pode inventar cliente. Então o link manda.
 *
 * Sem link pessoal (link geral da loja, bio, catálogo aberto), o sistema não
 * tem como saber quem é: aí o digitado é a única informação que existe e
 * continua valendo, como sempre foi.
 *
 * A SOBREPOSIÇÃO SÓ VALE PARA ERRO DE DIGITAÇÃO — mesmo DDD e no máximo um
 * dígito de diferença (a mesma régua da RN-020). O link pessoal chega por
 * WhatsApp e WhatsApp se ENCAMINHA: a cliente manda para a amiga, e a amiga
 * pede pelo mesmo link. Se qualquer diferença mandasse, o pedido da amiga
 * cairia no cadastro, na conversa e na carteira da primeira — um estrago bem
 * maior do que o cadastro duplicado que a regra veio consertar. Telefone
 * COMPLETAMENTE diferente é outra pessoa: vale o que ela digitou.
 */
export type TelefoneDoPedido = {
  /** o que vai identificar a cliente (criar/achar o cadastro) */
  telefone: string;
  /** a cliente digitou um número diferente do WhatsApp dela? */
  divergente: boolean;
  /** de onde veio o número que valeu */
  fonte: "digitado" | "link" | "whatsapp";
};

export function telefoneDoPedido(input: {
  /** o que a cliente digitou no formulário */
  digitado: string;
  /** o telefone do cadastro do link pessoal (?c=), quando houver */
  doLink?: string | null;
  /**
   * RN-097: o WhatsApp de onde a mensagem DESTE pedido já chegou (o webhook
   * venceu a corrida). É o aparelho que montou o pedido falando — vence
   * qualquer digitado, por mais diferente que seja; a diferença fica anotada.
   */
  doWhatsApp?: string | null;
}): TelefoneDoPedido {
  const digitado = (input.digitado ?? "").trim();
  const doLink = (input.doLink ?? "").trim();
  const doWhatsApp = (input.doWhatsApp ?? "").trim();
  const vale = (t: string) => t.replace(/\D/g, "").length >= 8;
  const temDigitado = vale(digitado);
  // cadastro com telefone incompleto/bagunçado não pode vencer um celular
  // válido digitado: seria mandar o pedido para um número inalcançável
  const temDoLink = vale(doLink);

  if (vale(doWhatsApp)) {
    const divergente = temDigitado && !mesmoNumero(digitado, doWhatsApp);
    return { telefone: doWhatsApp, divergente, fonte: "whatsapp" };
  }

  if (!temDoLink) return { telefone: digitado, divergente: false, fonte: "digitado" };
  if (!temDigitado) return { telefone: doLink, divergente: false, fonte: "link" };

  // mesmo número escrito de outro jeito não é divergência — é a mesma pessoa
  if (mesmoNumero(digitado, doLink)) {
    return { telefone: doLink, divergente: false, fonte: "link" };
  }

  // erro de digitação (mesmo DDD, um dígito) → o WhatsApp dela manda.
  // Diferente demais → é outra pessoa (link encaminhado): vale o digitado.
  if (telefoneParecido(digitado, doLink)) {
    return { telefone: doLink, divergente: true, fonte: "link" };
  }
  return { telefone: digitado, divergente: false, fonte: "digitado" };
}
