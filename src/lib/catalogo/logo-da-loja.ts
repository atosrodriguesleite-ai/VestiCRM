import { createHash } from "node:crypto";

/**
 * A LOGO DA LOJA NA VITRINE PÚBLICA VAI POR ENDEREÇO, NUNCA DENTRO DA PÁGINA
 * (RN-070, 07/10/2026).
 *
 * Relato do dono com o print do iPhone: a cliente abria o link do catálogo
 * pelo WhatsApp e via só a TELA PRETA, com a barrinha de carregamento parada
 * no começo. A logo mora no banco como data-URL (dívida nº 1) e ia embutida
 * na página TRÊS vezes — no cabeçalho, no rodapé e nos dados que o React
 * recebe. A primeira cópia fica no topo do `<body>`: o navegador precisa
 * baixar o bloco inteiro antes de desenhar qualquer coisa. Medido com uma
 * logo pesada, a página foi de 1,2 MB para 12,4 MB, e num 4G fraco a primeira
 * pintura saiu de 1,7 s para 18 s — o "não abre" de quem está com sinal ruim.
 *
 * As fotos dos produtos já tinham aprendido isso (`/api/img/<id>`, o catálogo
 * da Entre Linhas chegava a 19 MB); a logo ficou para trás. Agora ela sai por
 * `/api/img/logo/<loja>?v=<impressão digital>`: um endereço curto, que o
 * navegador busca depois de desenhar a página, com cache forte na CDN.
 *
 * O `v` é a impressão digital do CONTEÚDO: trocar a logo muda o endereço na
 * hora, e a mesma logo tem sempre o mesmo endereço.
 */

/**
 * Os tipos que a rota da logo entrega (conferidos de novo lá, pelo CONTEÚDO).
 * Logo de outro tipo — SVG que veio por importação, BMP — segue embutida como
 * sempre foi: a rota recusaria e a vitrine mostraria imagem quebrada no lugar
 * de uma logo que funcionava (achado da revisão). SVG de logo costuma ser
 * pequeno; o peso que trava a página é o da foto salva como PNG/JPEG.
 */
const TIPOS_DA_ROTA = /^data:image\/(png|jpe?g|webp|gif)[;,]/i;

/** A impressão digital da logo (10 caracteres bastam: é chave de cache, não segredo). */
export function versaoDaLogo(logoUrl: string): string {
  return createHash("sha256").update(logoUrl).digest("hex").slice(0, 10);
}

/**
 * O endereço que a vitrine usa para a logo.
 *
 * - sem logo → `null` (a vitrine mostra o nome da loja, como sempre);
 * - data-URL de PNG/JPEG/WebP/GIF → o endereço leve da rota de logo, com a
 *   versão do conteúdo;
 * - qualquer outra coisa (link externo, caminho do site, data-URL de outro
 *   tipo) passa como está — como sempre foi.
 */
export function enderecoDaLogo(loja: { slug: string; logoUrl: string | null }): string | null {
  const logo = loja.logoUrl?.trim();
  if (!logo) return null;
  if (!TIPOS_DA_ROTA.test(logo)) return logo;
  return `/api/img/logo/${encodeURIComponent(loja.slug)}?v=${versaoDaLogo(logo)}`;
}
