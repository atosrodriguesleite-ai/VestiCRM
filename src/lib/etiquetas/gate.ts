import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { db } from "../db";
import { requireUser, type SessionUser } from "../auth";

/**
 * A PORTEIRA DO MÓDULO ETIQUETAS (RN-059).
 *
 * Uma chave só (`Company.etiquetasEnabled`, super admin liga por loja) e
 * TODA a equipe entra: imprimir etiqueta e separar pedido é operação do dia,
 * feita por quem está na arara — vendedora e suporte incluídos (decisão do
 * dono, 18/09/2026: "todos usuários, desde que fique registrado quem
 * separou"). Sem a chave a rota responde 404 (o módulo "não existe" para a
 * loja), mesmo desenho do Estoque (RN-050) e do Financeiro (RN-029).
 *
 * O CÓDIGO DE BARRAS existe com ou sem a chave (nasce no banco): a chave só
 * abre as portas de imprimir e bipar.
 */
export function etiquetasLiberado(etiquetasEnabled: boolean): boolean {
  return etiquetasEnabled;
}

export type PorteiraEtiquetas =
  | { ok: true; user: SessionUser }
  | { ok: false; resposta: NextResponse };

/** Porteira das ROTAS: autentica e confere a chave da loja. */
export async function porteiraEtiquetas(): Promise<PorteiraEtiquetas> {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { etiquetasEnabled: true },
  });
  if (!etiquetasLiberado(company?.etiquetasEnabled ?? false)) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Não encontrado" }, { status: 404 }),
    };
  }
  return { ok: true, user };
}

/** Porteira das TELAS: sem a chave, volta ao Dashboard. */
export async function porteiraEtiquetasTela(): Promise<SessionUser> {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { etiquetasEnabled: true },
  });
  if (!etiquetasLiberado(company?.etiquetasEnabled ?? false)) redirect("/dashboard");
  return user;
}
