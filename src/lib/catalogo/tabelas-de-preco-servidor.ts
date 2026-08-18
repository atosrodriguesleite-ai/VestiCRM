import { randomBytes } from "node:crypto";
import { db } from "../db";
import { modoValido, type LinkDeCatalogo } from "./tabelas-de-preco";

/**
 * TABELAS DE PREÇO — a metade DE SERVIDOR (sorteio de código + banco).
 *
 * Separada de propósito (incidente de 17/08/2026): a regra pura vive em
 * `tabelas-de-preco.ts` e é importada pelo catálogo público, que roda no
 * NAVEGADOR — e o build da Vercel (webpack) derruba o deploy inteiro se
 * `node:crypto` ou o banco forem parar no código de navegador. O build
 * local (turbopack) engole e não avisa; o guarda disso é o teste
 * `tabelas-de-preco.test.ts`.
 */

/** Código do link (sorteado, curto o bastante para caber num WhatsApp). */
export function novoCodigoDeLink(): string {
  return randomBytes(6).toString("base64url"); // 8 caracteres
}

/**
 * Acha o link ATIVO de uma loja pelo código. Devolve null quando o recurso
 * está desligado para a loja — assim um link antigo (ou de uma loja que
 * deixou de assinar) simplesmente deixa de valer, e o catálogo volta ao
 * comportamento padrão em vez de cobrar a tabela errada.
 */
export async function resolverLink(
  companyId: string,
  code: string | null | undefined,
  recursoLigado: boolean
): Promise<LinkDeCatalogo | null> {
  if (!recursoLigado || !code) return null;
  const link = await db.catalogLink.findFirst({
    where: { code, companyId, active: true },
    select: { id: true, name: true, code: true, priceMode: true },
  });
  return link ? { ...link, priceMode: modoValido(link.priceMode) } : null;
}
