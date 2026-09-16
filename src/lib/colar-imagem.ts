/**
 * COLAR IMAGEM NO CAMPO DE MENSAGEM (pedido do dono, 16/09/2026): a
 * vendedora tira o print, clica no campo e cola — como no aplicativo do
 * WhatsApp. A imagem colada FICA NO CAMPO (miniatura com X) e só sai no
 * Enter ou no botão de enviar — sem pergunta (a pergunta atrasava, segundo
 * relato do dono no mesmo dia). O que vem da área de transferência é uma
 * lista mista (o print vem como arquivo de imagem; texto copiado vem como
 * texto); só as IMAGENS ficam presas no campo, e texto continua colando.
 *
 * Puro e testável: recebe a lista de arquivos do evento de colar.
 */
export function imagensColadas(arquivos: ArrayLike<File> | null | undefined): File[] {
  return Array.from(arquivos ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Rótulo da faixa de imagens presas no campo. */
export function rotuloDosAnexos(quantas: number): string {
  return quantas === 1
    ? "1 imagem pronta para enviar · Enter envia"
    : `${quantas} imagens prontas para enviar · Enter envia`;
}
