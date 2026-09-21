/**
 * DOCUMENTO NA CONVERSA: o que abre no visor próprio e o que só se salva.
 *
 * Relato do dono (21/09/2026): "mando o romaneio para o cliente e abro o PDF
 * dentro da conversa — aí não consigo fechar, trava, tenho que fechar o
 * aplicativo e abrir de novo". A tentativa de 06/08 (`target="_blank"`) não
 * resolve no APLICATIVO INSTALADO (PWA): o manifesto tem `scope: "/"`, e o
 * iPhone abre todo link do próprio endereço DENTRO do app, sem aba nova e
 * sem botão de voltar — o PDF toma a tela e só fechando o app se sai.
 *
 * A saída é a mesma da foto: um VISOR NOSSO, por cima da conversa, com X.
 * Só o PDF entra nele (é o que o navegador desenha); qualquer outro
 * documento (planilha, docx) é entregue como arquivo para salvar — o
 * servidor já manda esses como download (rota de mídia, `nosniff`).
 */
export function ehPdf(fileName: string | null | undefined): boolean {
  return /\.pdf$/i.test((fileName ?? "").trim());
}
