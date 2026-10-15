import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { db } from "../db";
import { requireUser, type SessionUser } from "../auth";
import { isManagerUp } from "../scope";

/**
 * A PORTEIRA DO MÓDULO BI DE VENDAS (RN-082, ADR-019).
 *
 * Duas chaves, as duas na porta: a da LOJA (`Company.biEnabled`, o Super
 * Admin liga por loja — é o módulo da assessoria) e a do PAPEL (só gerência:
 * decisão do dono, 13/10/2026 — o painel mostra dinheiro da loja inteira e
 * o desempenho de cada vendedora). Sem a chave da loja a rota responde 404
 * (o módulo "não existe" para ela) e a tela volta ao Dashboard; sem o papel,
 * 403 e Dashboard. O mesmo desenho do Financeiro (RN-029).
 */
export function biLiberado(biEnabled: boolean): boolean {
  return biEnabled;
}

export function podeVerBi(user: Pick<SessionUser, "role">): boolean {
  return isManagerUp(user as SessionUser);
}

export type PorteiraBi = { ok: true; user: SessionUser } | { ok: false; resposta: NextResponse };

/** Porteira das ROTAS: autentica, confere a chave da loja e o papel. */
export async function porteiraBi(): Promise<PorteiraBi> {
  const user = await requireUser();
  const company = await db.company.findUnique({ where: { id: user.companyId }, select: { biEnabled: true } });
  if (!biLiberado(company?.biEnabled ?? false)) {
    return { ok: false, resposta: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };
  }
  if (!podeVerBi(user)) {
    return { ok: false, resposta: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true, user };
}

/** Porteira das TELAS: sem chave ou sem papel, volta ao Dashboard. */
export async function porteiraBiTela(): Promise<SessionUser> {
  const user = await requireUser();
  const company = await db.company.findUnique({ where: { id: user.companyId }, select: { biEnabled: true } });
  if (!biLiberado(company?.biEnabled ?? false) || !podeVerBi(user)) redirect("/dashboard");
  return user;
}
