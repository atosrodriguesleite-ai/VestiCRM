/**
 * Anúncio → campanha (Click-to-WhatsApp).
 *
 * Quando a cliente chega clicando num anúncio do Instagram/Facebook, a
 * primeira mensagem traz junto a prévia do anúncio (título, texto e link).
 * Aqui a gente transforma essa prévia num CÓDIGO CURTO e estável, e casa
 * esse código com a campanha que a loja cadastrou.
 *
 * A dona da loja não precisa saber o que é "id de anúncio": ela cola o LINK
 * do post na campanha, e o sistema extrai o mesmo código dos dois lados.
 */

export type AdReferral = {
  title?: string;
  body?: string;
  sourceUrl?: string;
  sourceId?: string;
};

/**
 * Código curto e estável do anúncio.
 *
 * Preferimos o código do LINK (ex.: instagram.com/p/DbN-U8QsQK4/ → dbn-u8qsqk4)
 * porque é o que a loja consegue copiar da barra de endereços. Sem link
 * utilizável, usa o id que o WhatsApp mandou.
 */
export function adCode(ad: AdReferral | null | undefined): string | null {
  if (!ad) return null;
  const url = (ad.sourceUrl ?? "").trim();
  if (url) {
    // Instagram: /p/<code>, /reel/<code>, /tv/<code>
    const insta = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i);
    if (insta) return insta[1].toLowerCase();
    // Facebook: .../posts/<id>, /videos/<id>, ?story_fbid=<id>
    const fbId = url.match(/(?:story_fbid=|\/posts\/|\/videos\/)(\d{6,})/i);
    if (fbId) return fbId[1];
    // qualquer link com um id numérico longo na query (fbclid não serve: muda a cada clique)
    const ad_id = url.match(/[?&](?:ad_id|adset_id|campaign_id)=(\d{6,})/i);
    if (ad_id) return ad_id[1];
  }
  const id = (ad.sourceId ?? "").trim();
  if (id) return id.toLowerCase();
  return null;
}

/**
 * Normaliza uma linha digitada pela loja no cadastro da campanha: aceita o
 * link inteiro do post OU só o código, e devolve sempre o mesmo formato do
 * `adCode` — é o que faz os dois lados se encontrarem.
 */
export function normalizaRefDigitada(linha: string): string | null {
  const t = (linha ?? "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t) || /(instagram|facebook|fb)\.com/i.test(t)) {
    const code = adCode({ sourceUrl: t.startsWith("http") ? t : `https://${t}` });
    if (code) return code;
  }
  // só o código, colado na mão
  const limpo = t.replace(/^[#@\s]+/, "").replace(/[/\s]+$/, "");
  return limpo ? limpo.toLowerCase() : null;
}

/** Lista de códigos de anúncio de uma campanha (campo de texto, um por linha). */
export function refsDaCampanha(adRefs: string | null | undefined): string[] {
  return (adRefs ?? "")
    .split(/[\n,;]+/)
    .map(normalizaRefDigitada)
    .filter((v): v is string => !!v);
}

/**
 * Qual campanha é dona deste anúncio. Campanha pausada não puxa atribuição
 * nova (mas o histórico dela continua intacto).
 */
export function campanhaDoAnuncio<T extends { id: string; adRefs: string | null; active: boolean }>(
  code: string | null,
  campanhas: T[]
): T | null {
  if (!code) return null;
  const alvo = code.toLowerCase();
  return (
    campanhas.find((c) => c.active && refsDaCampanha(c.adRefs).includes(alvo)) ?? null
  );
}
