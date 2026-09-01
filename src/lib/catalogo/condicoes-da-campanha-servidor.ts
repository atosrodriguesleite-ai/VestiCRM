import { db } from "../db";
import type { CampanhaDoLink } from "./condicoes-da-campanha";

/**
 * Acha a campanha do link (`?ref=`) para aplicar as condições dela (RN-040).
 * Fica separado do motor puro porque o catálogo público roda no NAVEGADOR e
 * não pode carregar o banco junto (lição do deploy quebrado de 17/08/2026).
 *
 * Só olha o `ref` DESTA VISITA. O `ref` LEMBRADO no aparelho serve para a
 * comissão não morrer da noite para o dia (RN-005) — mas emprestar desconto
 * a quem entrou pelo catálogo normal faria a vitrine mostrar um preço e o
 * pedido cobrar outro.
 */
export type CampanhaResolvida = CampanhaDoLink & { id: string; name: string; slug: string };

export async function resolverCampanhaDoLink(
  companyId: string,
  /**
   * O QUE VEM DA URL NÃO É PROMESSA DE TEXTO: `?ref=a&ref=b` chega como
   * ARRAY em runtime, e um `.trim()` em cima derrubaria o catálogo público
   * inteiro com 500 — quebrando justamente a promessa desta regra, de que o
   * link divulgado nunca quebra (achado da revisão de 01/09/2026).
   */
  ref: unknown
): Promise<CampanhaResolvida | null> {
  const bruto = Array.isArray(ref) ? ref[0] : ref;
  const slug = (typeof bruto === "string" ? bruto : "").trim().toLowerCase();
  if (!slug) return null;
  const c = await db.trackCampaign.findFirst({
    where: { companyId, slug, active: true, archivedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      active: true,
      archivedAt: true,
      discount: true,
      minOrderMode: true,
      minOrderPieces: true,
      minOrderValue: true,
    },
  });
  return c ?? null;
}
