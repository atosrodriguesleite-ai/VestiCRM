import { NextResponse } from "next/server";
import { db } from "./db";
import { requireUser, AuthError } from "./auth";

/**
 * Trava do módulo Produção: pago à parte, ativado por loja pelo Super Admin
 * (painel Lojas). Sem a chave ligada, nenhuma rota/tela do módulo responde.
 */
export class ProducaoDesativada extends Error {
  constructor() {
    super("Módulo Produção não está ativo nesta loja");
  }
}

export async function requireProducao() {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { productionEnabled: true },
  });
  if (!company?.productionEnabled) throw new ProducaoDesativada();
  return user;
}

/** Tradução padrão dos erros do módulo pra resposta HTTP. */
export function producaoErro(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (e instanceof ProducaoDesativada)
    return NextResponse.json({ error: e.message }, { status: 403 });
  throw e;
}
