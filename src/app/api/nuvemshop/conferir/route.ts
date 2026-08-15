import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { conferirIntegracao } from "@/lib/nuvemshop-conferencia";
import { explicarNuvemshop, motivoPeloStatus } from "@/lib/nuvemshop-erros";

/**
 * CONFERÊNCIA DA INTEGRAÇÃO — SÓ LEITURA, nunca altera nada.
 *
 * Responde "o vínculo com a Nuvemshop está correto?", que é diferente de
 * "sincronizou?". Nasceu do incidente do SKU duplicado na Toque Leve: o
 * relatório do sync dizia 0 pendências e ainda assim havia uma cor morando
 * dentro do produto de outra cor. Pode rodar em loja em produção sem medo.
 */
export const maxDuration = 60;

export async function GET() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const r = await conferirIntegracao(user.companyId);
    if (!r.ok) {
      const { mensagem } =
        r.status === -1
          ? explicarNuvemshop("SEM_CONEXAO")
          : explicarNuvemshop(motivoPeloStatus(r.status));
      return NextResponse.json({ error: mensagem }, { status: 400 });
    }
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
