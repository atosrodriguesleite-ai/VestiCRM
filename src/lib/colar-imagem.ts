/**
 * COLAR IMAGEM NO CAMPO DE MENSAGEM (pedido do dono, 16/09/2026): a
 * vendedora tira o print, clica no campo e cola — como no aplicativo do
 * WhatsApp. O que vem da área de transferência é uma lista mista (o print
 * vem como arquivo de imagem; texto copiado vem como texto); só as IMAGENS
 * viram envio, e texto continua colando como sempre.
 *
 * Puro e testável: recebe a lista de arquivos do evento de colar.
 */
export function imagensColadas(arquivos: ArrayLike<File> | null | undefined): File[] {
  return Array.from(arquivos ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Frase da confirmação antes de mandar (colar é fácil de acontecer sem querer). */
export function fraseDeConfirmacaoDaColagem(quantas: number, primeiroNome: string): string {
  return quantas === 1
    ? `Enviar a imagem colada para ${primeiroNome}?`
    : `Enviar as ${quantas} imagens coladas para ${primeiroNome}?`;
}
