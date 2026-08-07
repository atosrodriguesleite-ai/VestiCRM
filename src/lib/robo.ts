/**
 * DETECTOR DE ROBÔ pelo user-agent — a régua ÚNICA das métricas públicas.
 *
 * Robôs e prévias de link (WhatsApp, Instagram, Google) buscam páginas e
 * seguem links: contá-los infla visita e clique. A bio já filtrava as
 * VISITAS; os CLIQUES não (auditoria 06/08/2026) — o Google "clicava" nos
 * botões e a média de cliques por visita subia sozinha. Regra num lugar só
 * para visita e clique nunca mais divergirem.
 */
export function ehRobo(ua: string | null | undefined): boolean {
  return (
    !ua ||
    /bot|crawler|spider|crawl|slurp|facebookexternalhit|whatsapp|telegram|discord|embedly|preview|monitor|lighthouse|headless|bingpreview|pinterest|linkedinbot|skypeuripreview|vkshare|redditbot|applebot/i.test(
      ua
    )
  );
}
