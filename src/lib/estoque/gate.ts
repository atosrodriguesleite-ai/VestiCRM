import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { db } from "../db";
import { requireUser, type SessionUser } from "../auth";
import { isManagerUp } from "../scope";

/**
 * A PORTEIRA DO MÓDULO ESTOQUE (RN-050).
 *
 * Uma chave só para ENTRAR (`Company.estoqueEnabled`, super admin liga por
 * loja): toda a equipe vê o Inventário — vendedora e suporte incluídos,
 * conferir estoque é operação do dia (mesma régua da tela Produtos). Quem
 * AJUSTA é gerência e admin (`podeAjustarEstoque`), e essa segunda chave é
 * conferida na porta de escrita, nunca só na tela.
 *
 * Sem o módulo a rota responde 404 (o módulo "não existe" para a loja) e a
 * tela volta ao Dashboard — mesmo desenho do Financeiro (RN-029).
 */

/** Pode entrar no módulo? (chave da loja) */
export function estoqueLiberado(estoqueEnabled: boolean): boolean {
  return estoqueEnabled;
}

/** Pode DIGITAR um estoque novo? (gerência) */
export function podeAjustarEstoque(user: Pick<SessionUser, "role">): boolean {
  return isManagerUp(user as SessionUser);
}

export type PorteiraEstoque =
  | { ok: true; user: SessionUser }
  | { ok: false; resposta: NextResponse };

/** Porteira das ROTAS: autentica e confere a chave da loja. */
export async function porteiraEstoque(): Promise<PorteiraEstoque> {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { estoqueEnabled: true },
  });
  if (!estoqueLiberado(company?.estoqueEnabled ?? false)) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Não encontrado" }, { status: 404 }),
    };
  }
  return { ok: true, user };
}

/** Porteira das TELAS: sem a chave, volta ao Dashboard. */
export async function porteiraEstoqueTela(): Promise<SessionUser> {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { estoqueEnabled: true },
  });
  if (!estoqueLiberado(company?.estoqueEnabled ?? false)) redirect("/dashboard");
  return user;
}
