import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { db } from "../db";
import { requireUser, type SessionUser } from "../auth";
import { isManagerUp } from "../scope";

/**
 * A PORTEIRA DO CALENDÁRIO COMERCIAL (RN-092).
 *
 * Duas chaves, as duas na porta — o desenho do BI (RN-082): a da LOJA
 * (`Company.calendarioEnabled`, o Super Admin liga por loja) e a do PAPEL
 * (só gerência vê e edita, decisão do dono em 23/10/2026). Sem a chave da
 * loja a rota responde 404 (o módulo "não existe" para ela) e a tela volta
 * ao Dashboard; sem o papel, 403 e Dashboard.
 */
export function podeUsarCalendario(user: Pick<SessionUser, "role">): boolean {
  return isManagerUp(user as SessionUser);
}

export type PorteiraCalendario =
  | { ok: true; user: SessionUser }
  | { ok: false; resposta: NextResponse };

/** Porteira das ROTAS: autentica, confere a chave da loja e o papel. */
export async function porteiraCalendario(): Promise<PorteiraCalendario> {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { calendarioEnabled: true },
  });
  if (!company?.calendarioEnabled) {
    return { ok: false, resposta: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  }
  if (!podeUsarCalendario(user)) {
    return { ok: false, resposta: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true, user };
}

/** Porteira das TELAS: sem chave ou sem papel, volta ao Dashboard. */
export async function porteiraCalendarioTela(): Promise<SessionUser> {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { calendarioEnabled: true },
  });
  if (!company?.calendarioEnabled || !podeUsarCalendario(user)) redirect("/dashboard");
  return user;
}
