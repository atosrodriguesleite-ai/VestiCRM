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
