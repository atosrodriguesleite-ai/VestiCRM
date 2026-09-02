/**
 * O que o porteiro global (middleware) deixa passar SEM sessão por ser
 * arquivo estático (sw.js, manifest, ícones, fontes).
 *
 * A régua antiga era "qualquer caminho com um ponto" — um alçapão: qualquer
 * endereço com um ponto no meio pulava a checagem de sessão, inclusive em
 * /api. Hoje nenhuma rota confia só no porteiro (todas conferem login por
 * conta própria), mas a primeira rota futura descuidada cairia nele.
 *
 * A régua nova é estreita: NUNCA em /api, e só quando o caminho TERMINA em
 * extensão de arquivo (é assim que arquivo estático se apresenta).
 */
export function ehArquivoEstatico(pathname: string): boolean {
  if (pathname.startsWith("/api")) return false;
  return /\.[A-Za-z0-9]{1,12}$/.test(pathname);
}
