import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { conciliar, desconciliar, ignorarLinha } from "@/lib/financeiro/conciliacao";

const acaoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("conciliar"), baixaIds: z.array(z.string()).min(1).max(50) }),
  z.object({ acao: z.literal("desconciliar") }),
  z.object({ acao: z.literal("ignorar"), ignorar: z.boolean() }),
]);

/**
 * Conciliar, desfazer e "não é do sistema" (RN-035). Nenhuma delas mexe em
 * dinheiro: conciliação carimba "conferido", nunca cria nem apaga baixa.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ linhaId: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { linhaId } = await params;
    const parsed = acaoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const { companyId, name } = porta.user;
    const r =
      parsed.data.acao === "conciliar"
        ? await conciliar(companyId, linhaId, parsed.data.baixaIds, name)
        : parsed.data.acao === "desconciliar"
          ? await desconciliar(companyId, linhaId)
          : await ignorarLinha(companyId, linhaId, name, parsed.data.ignorar);

    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json({ ok: true, conciliado: r.conciliado });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
