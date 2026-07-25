import { NextResponse } from "next/server";
import { db } from "./db";
import { requireUser, AuthError } from "./auth";

/**
 * Trava do módulo Plano de Corte: pago à parte, ativado por loja pelo
 * Super Admin (painel Lojas) — independente do módulo Produção. Sem a
 * chave ligada, nenhuma rota/tela do módulo responde.
 */
export class PlanoCorteDesativado extends Error {
  constructor() {
    super("Módulo Plano de Corte não está ativo nesta loja");
  }
}

export async function requirePlanoCorte() {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { cutPlanEnabled: true },
  });
  if (!company?.cutPlanEnabled) throw new PlanoCorteDesativado();
  return user;
}

/** Tradução padrão dos erros do módulo pra resposta HTTP. */
export function planoCorteErro(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (e instanceof PlanoCorteDesativado)
    return NextResponse.json({ error: e.message }, { status: 403 });
  throw e;
}
