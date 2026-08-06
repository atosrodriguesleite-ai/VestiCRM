/**
 * DESCRIÇÃO LIMPA — traduz o "computês" que vem da Nuvemshop.
 *
 * A descrição do produto chega da loja online como HTML: tags (<p>, <br>) e
 * entidades (&ccedil; = ç, &atilde; = ã, &nbsp; = espaço). O sync antigo
 * tirava as tags mas ESQUECIA as entidades — o catálogo mostrava
 * "Especifica&ccedil;&otilde;es t&eacute;cnicas" para a cliente final
 * (relato da Entre Linhas, 06/08/2026, produto "Bermuda bolso lateral").
 */

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö",
  Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü",
  ccedil: "ç", Ccedil: "Ç", ntilde: "ñ", Ntilde: "Ñ",
  ordf: "ª", ordm: "º", deg: "°", middot: "·", bull: "•", hellip: "…",
  ndash: "–", mdash: "—", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾",
  reg: "®", copy: "©", trade: "™", euro: "€", pound: "£", cent: "¢",
};

/** Código numérico → letra, ignorando valores fora do alcance. */
function doCodigo(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Traduz &ccedil; / &#231; / &#xE7; → ç (uma passada). */
function umaPassada(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => doCodigo(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => doCodigo(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, nome: string) => ENTIDADES[nome] ?? m);
}

/**
 * Decodifica entidades HTML — inclusive as DUPLAS (&amp;ccedil;, que é como
 * o texto da Entre Linhas estava gravado: já tinha passado por um encode a
 * mais em algum lugar da Nuvemshop). Até 3 passadas, parando quando estabiliza.
 */
export function decodificarEntidades(s: string): string {
  let atual = s;
  for (let i = 0; i < 3; i++) {
    const proxima = umaPassada(atual);
    if (proxima === atual) break;
    atual = proxima;
  }
  return atual;
}

/** Tem código de entidade ainda por traduzir? (só os que conhecemos) */
export function temEntidadeHtml(s: string): boolean {
  const achados = s.match(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g);
  if (!achados) return false;
  return achados.some(
    (e) => e.startsWith("&#") || ENTIDADES[e.slice(1, -1)] !== undefined
  );
}

/** HTML da Nuvemshop → texto simples: sem tags, sem códigos, espaços normais. */
export function limparDescricaoHtml(html: string): string {
  return decodificarEntidades(html.replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ") // o "espaço duro" do &nbsp; vira espaço comum
    .replace(/\s+/g, " ")
    .trim();
}
