import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { db } from "../db";
import { requireUser, type SessionUser } from "../auth";
import { isManagerUp } from "../scope";
import { autorDeGente } from "./lancamentos";

/**
 * A PORTEIRA DO MÓDULO FINANCEIRO (RN-029).
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
  /**
   * O NOME DE QUEM FEZ sai daqui já desambiguado: "Sistema" é a identidade
   * da baixa automática da porta única de vendas (RN-033) e está no índice
   * único do banco. Uma vendedora chamada "Sistema" faria a baixa dela ser
   * lida como automática — a porta a estornaria sozinha — e esbarraria no
   * índice, devolvendo 500 em vez de frase. Tratando aqui, TODA rota do
   * módulo fica coberta de uma vez (auditoria de 03/09/2026).
   */
  return { ok: true, user: { ...user, name: autorDeGente(user.name) } };
}

/**
 * A PORTEIRA DAS TELAS (RN-029).
 *
 * As 13 páginas do módulo repetiam à mão as mesmas seis linhas — `requireUser`
 * + `isManagerUp` + a consulta da chave + `financeiroLiberado` + `redirect` —
 * e a varredura de teste só olhava as ROTAS. Uma página nova que esquecesse
 * uma das duas chaves entrava em produção sem guarda e sem teste vermelho, e
 * uma vendedora (ou uma loja sem o módulo) veria a tela de dinheiro. Achado
 * da auditoria completa do módulo, 03/09/2026.
 *
 * Devolve o usuário, ou REDIRECIONA — nunca devolve sem as duas chaves.
 */
export async function porteiraFinanceiroTela(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  if (!financeiroLiberado(user, company?.financeEnabled ?? false))
    redirect("/financeiro");
  return { ...user, name: autorDeGente(user.name) };
}
