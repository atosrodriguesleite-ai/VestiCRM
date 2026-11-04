import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";
import { lerParametros } from "@/lib/dashboard/faturamento-regra";
import { dadosDoFaturamento } from "@/lib/dashboard/faturamento-dados";

export const dynamic = "force-dynamic";

/**
 * A porta do gráfico de faturamento do Dashboard (RN-108): a tela a chama
 * quando a pessoa troca a comparação (período anterior, ano passado, outra
 * data) ou o modo, sem recarregar a página. Devolve as DUAS séries diárias
 * pela mesma régua da página — quem vê a loja inteira ou só a própria
 * carteira é a sessão (RN-007/RN-013), nunca um id da URL.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    // o Dashboard não é do suporte (ele trabalha em Pedidos) nem do Super
    // Admin fora do "acessar como loja" — a página já os manda embora
    if (user.role === "SUPPORT" || (isSuperAdmin(user) && !user.impersonatedBy))
      return NextResponse.json({ error: "Sem acesso ao faturamento" }, { status: 403 });
    const q = new URL(req.url).searchParams;
    const p = lerParametros({ de: q.get("de"), ate: q.get("ate"), tipo: q.get("tipo"), cmpDe: q.get("cmpDe") });
    if (!p) return NextResponse.json({ error: "Período ou comparação inválidos" }, { status: 400 });
    return NextResponse.json(await dadosDoFaturamento(user, p));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
