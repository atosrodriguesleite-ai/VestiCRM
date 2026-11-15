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
 *
 * O VISOR DESENHA O PDF ELE MESMO (15/11/2026, o dono de novo: "a
 * possibilidade de visualizar e fechar PDF dentro da conversa"). A primeira
 * versão do visor punha o PDF numa MOLDURA do navegador (`<iframe>`), e
 * moldura de PDF só funciona no computador: o iPhone mostra só a PRIMEIRA
 * página, sem rolar, e o Chrome do Android não mostra nada (ele não tem
 * leitor de PDF embutido para moldura). Ou seja, justamente no celular o
 * visor abria vazio ou pela metade. Agora as páginas são desenhadas pelo
 * pdf.js — a mesma peça do romaneio (`pedidos/[id]/romaneio/viewer.tsx`),
 * que já funciona nos celulares das lojistas.
 *
 * Qualquer outro documento (planilha, docx) é entregue como arquivo para
 * salvar — o servidor já manda esses como download (rota de mídia, `nosniff`).
 */
export function ehPdf(fileName: string | null | undefined): boolean {
  return /\.pdf$/i.test((fileName ?? "").trim());
}

/**
 * Vale TENTAR abrir no visor? O PDF pelo nome — e o documento que chegou SEM
 * extensão nenhuma ("Catálogo", "documento"): o WhatsApp deixa mandar PDF
 * com qualquer nome, e esse caía direto em "salvar". O visor confere o
 * conteúdo (`pareceUmPdf`) e, se não for PDF, diz e oferece salvar. Arquivo
 * com OUTRA extensão (xlsx, docx, zip) não passa por aqui: baixá-lo inteiro
 * só para dizer "não abre" seria desperdício.
 */
export function abreNoVisor(fileName: string | null | undefined): boolean {
  const nome = (fileName ?? "").trim();
  if (ehPdf(nome)) return true;
  return !/\.[a-z0-9]{1,8}$/i.test(nome);
}

/**
 * É PDF pelo CONTEÚDO: a marca "%PDF-" no começo do arquivo (o padrão deixa
 * haver lixo antes dela, dentro dos primeiros 1024 bytes). O nome e o rótulo
 * do tipo são de quem mandou; a marca é do arquivo.
 */
export function pareceUmPdf(bytes: Uint8Array): boolean {
  const marca = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const fim = Math.min(bytes.length, 1024) - marca.length;
  for (let i = 0; i <= fim; i++) {
    let igual = true;
    for (let j = 0; j < marca.length; j++) {
      if (bytes[i + j] !== marca[j]) {
        igual = false;
        break;
      }
    }
    if (igual) return true;
  }
  return false;
}

/** os degraus do zoom do visor (1 = a página na largura da tela) */
export const ZOOMS = [1, 1.5, 2, 3] as const;
/** no computador a página não passa disto em zoom 1 (linha comprida cansa) */
export const LARGURA_MAXIMA_DA_PAGINA = 900;
/**
 * Teto de pontos por página desenhada. O iPhone derruba a aba quando os
 * quadros de desenho somam memória demais; 8 milhões de pontos (~32 MB) dá
 * nitidez de tela boa até o zoom de 3× no celular.
 */
export const TETO_DE_PONTOS = 8_000_000;

/**
 * AS MEDIDAS DE UMA PÁGINA NA TELA: o tamanho em que ela aparece (CSS) e a
 * escala em que é DESENHADA (pontos reais da tela, para a letra miúda do
 * romaneio sair nítida) — com o teto de memória acima.
 */
export function medidasDaPagina(p: {
  /** largura e altura da página no PDF (em pontos do PDF, escala 1) */
  larguraPdf: number;
  alturaPdf: number;
  /** quanto de largura o visor tem */
  larguraDisponivel: number;
  zoom: number;
  /** pontos da tela por ponto de CSS (`devicePixelRatio`) */
  dpr: number;
}): { larguraCss: number; alturaCss: number; escala: number } {
  const larguraPdf = p.larguraPdf > 0 ? p.larguraPdf : 1;
  const alturaPdf = p.alturaPdf > 0 ? p.alturaPdf : 1;
  const base = Math.max(120, Math.min(p.larguraDisponivel, LARGURA_MAXIMA_DA_PAGINA));
  const larguraCss = Math.round(base * (p.zoom > 0 ? p.zoom : 1));
  const alturaCss = Math.round((larguraCss * alturaPdf) / larguraPdf);
  let nitidez = Math.min(Math.max(p.dpr || 1, 1), 2);
  const pontos = larguraCss * alturaCss * nitidez * nitidez;
  if (pontos > TETO_DE_PONTOS) nitidez = Math.sqrt(TETO_DE_PONTOS / (larguraCss * alturaCss));
  return { larguraCss, alturaCss, escala: (larguraCss / larguraPdf) * nitidez };
}
