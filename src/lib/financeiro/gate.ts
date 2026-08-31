import { NextResponse } from "next/server";
import { db } from "../db";
import { requireUser, type SessionUser } from "../auth";
import { isManagerUp } from "../scope";

/**
 * A PORTEIRA DO MÓDULO FINANCEIRO (RN-027).
 *
 * Duas chaves, as duas obrigatórias em TODA porta do módulo (API e tela):
 *
 *  1. a loja pagou o módulo (`Company.financeEnabled`, super admin liga);
 *  2. quem pede é gerente ou admin — vendedora e SUPORTE ficam fora
 *     (suporte é operacional; dinheiro da loja é assunto comercial, mesma
 *     régua de Relatórios e Comissões).
 *
 * Loja com a chave desligada não muda em NADA: a rota responde 404 (o
 * módulo "não existe" para ela), e a tela antiga de contas a receber de
 * pedidos segue como sempre foi.
 */

/** A decisão pura, testável: pode entrar no financeiro? */
export function financeiroLiberado(
  user: Pick<SessionUser, "role" | "companyId">,
  financeEnabled: boolean
): boolean {
  return financeEnabled && isManagerUp(user as SessionUser);
}

export type PorteiraFinanceiro =
  | { ok: true; user: SessionUser }
  | { ok: false; resposta: NextResponse };

/** Porteira das ROTAS: autentica, confere a chave da loja e o papel. */
export async function porteiraFinanceiro(): Promise<PorteiraFinanceiro> {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  // a CHAVE vem primeiro: sem o módulo, a rota responde 404 para TODO papel
  // — um 403 aqui revelaria que o módulo existe e "só falta permissão"
  if (!company?.financeEnabled) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Não encontrado" }, { status: 404 }),
    };
  }
  if (!financeiroLiberado(user, company.financeEnabled)) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Sem permissão" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}
