/**
 * Fotos de produto são guardadas como data-URL (base64) no banco.
 * Embutir isso direto no HTML deixa páginas gigantes (o catálogo da
 * Entre Linhas chegava a 19 MB — travava e abria sem estilo no celular).
 * Em vez disso, cada foto vira um endereço leve (/api/img/<id>) servido
 * pela rota de imagens com cache forte no navegador e na CDN.
 */
export function imageSrc(img: { id: string; url: string }): string {
  return img.url.startsWith("data:") ? `/api/img/${img.id}` : img.url;
}

/**
 * Versão para listagens grandes: monta o endereço SÓ com o id, sem nunca
 * carregar o base64 do banco (a rota /api/img redireciona sozinha quando
 * a foto for um link externo). Com 1.000+ produtos, isso evita ler
 * centenas de MB do banco a cada visita ao catálogo.
 */
export function imageHref(id: string): string {
  return `/api/img/${id}`;
}
