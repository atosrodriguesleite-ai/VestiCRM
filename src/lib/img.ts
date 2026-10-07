/**
 * Fotos de produto são guardadas como data-URL (base64) no banco.
 * Embutir isso direto no HTML deixa páginas gigantes (o catálogo da
 * Entre Linhas chegava a 19 MB — travava e abria sem estilo no celular).
 * Em vez disso, cada foto vira um endereço leve (/api/img/<id>) servido
 * pela rota de imagens com cache forte no navegador e na CDN.
 */
/**
 * Versão do cache das fotos. Incrementar invalida TODO o cache de CDN dos
 * catálogos de uma vez (a CDN trata a query como parte da chave) — usado
 * para escapar de respostas de erro envenenadas guardadas na borda.
 */
const IMG_V = "2";

export function imageSrc(img: { id: string; url: string }): string {
  return img.url.startsWith("data:") ? `/api/img/${img.id}?v=${IMG_V}` : img.url;
}

/**
 * Versão para listagens grandes: monta o endereço SÓ com o id, sem nunca
 * carregar o base64 do banco (a rota /api/img redireciona sozinha quando
 * a foto for um link externo). Com 1.000+ produtos, isso evita ler
 * centenas de MB do banco a cada visita ao catálogo.
 */
export function imageHref(id: string): string {
  return `/api/img/${id}?v=${IMG_V}`;
}

/**
 * RN-070 (galeria de fotos): `?baixar=1&nome=…` faz a MESMA foto sair como
 * arquivo para salvar, com nome legível — no celular, abrir a foto numa aba
 * não é "baixar", e a cliente não acha onde ela foi parar. A URL com
 * `?baixar` é outra entrada no cache, então a foto inline segue imutável.
 */
export function nomeDoDownload(params: URLSearchParams): string | null {
  if (params.get("baixar") !== "1") return null;
  return (
    (params.get("nome") ?? "foto")
      .replace(/[\x00-\x1f"\\/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "foto"
  );
}

/** a extensão que o arquivo salvo leva é a do TIPO real da foto (png não vira .jpg) */
export function extensaoDaImagem(mime: string): string {
  const tipo = (mime || "").split(";")[0].trim().toLowerCase();
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  if (tipo === "image/gif") return "gif";
  if (tipo === "image/avif") return "avif";
  return "jpg";
}

/**
 * O cabeçalho de arquivo. Duas escritas do nome, de propósito: o
 * `filename=` simples só aceita Latin-1 — acento fica, mas emoji, travessão
 * e aspas curvas (comuns em nome de peça) fariam o servidor RECUSAR o
 * cabeçalho inteiro e o download virar erro 500 (achado da revisão). O nome
 * completo, com tudo, vai no `filename*` (UTF-8), que é o que o navegador
 * moderno lê primeiro.
 */
export function disposicaoDoDownload(nome: string, mime: string): string {
  const ext = extensaoDaImagem(mime);
  const simples =
    nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]+/g, " ")
      .replace(/["\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "foto";
  return `attachment; filename="${simples}.${ext}"; filename*=UTF-8''${encodeURIComponent(nome)}.${ext}`;
}

/** link da foto para SALVAR (RN-070) */
export function downloadHref(id: string, nome: string): string {
  return `/api/img/${id}?v=${IMG_V}&baixar=1&nome=${encodeURIComponent(nome)}`;
}
