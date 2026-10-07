/**
 * RN-071 · FOTOS PARA A CLIENTE — a parte com BANCO (criar e ler o link).
 * A régua pura mora em `regra.ts` e é reexportada daqui para o servidor.
 */
import crypto from "crypto";
import { db } from "../db";
import { VALIDADE_DO_LINK_DE_FOTOS_MS } from "./regra";

export * from "./regra";

/* ---- banco ---- */

export async function criarLinkDeFotos(input: {
  companyId: string;
  categorias: string[];
  soComEstoque: boolean;
  sellerId: string | null;
  criadoPorId: string;
  customerId: string | null;
}): Promise<string> {
  const code = crypto.randomBytes(8).toString("base64url"); // 11 caracteres
  await db.fotosLink.create({
    data: {
      companyId: input.companyId,
      code,
      categorias: input.categorias,
      soComEstoque: input.soComEstoque,
      sellerId: input.sellerId,
      criadoPorId: input.criadoPorId,
      customerId: input.customerId,
      expiresAt: new Date(Date.now() + VALIDADE_DO_LINK_DE_FOTOS_MS),
    },
  });
  // faxina de carona (nunca cron, ADR-002): leva embora o que venceu há
  // mais de 30 dias nesta loja — os contadores recentes ficam para leitura
  await db.fotosLink
    .deleteMany({
      where: { companyId: input.companyId, expiresAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    })
    .catch(() => {});
  return code;
}

/** Lê o link pelo código, recortado pela loja do slug; null se não existe. */
export async function lerLinkDeFotos(code: string, companyId: string) {
  const v = (code ?? "").trim();
  if (!v || v.length > 32) return null;
  const link = await db.fotosLink.findUnique({ where: { code: v } });
  if (!link || link.companyId !== companyId) return null;
  return link;
}
