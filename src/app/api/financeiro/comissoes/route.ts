import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { gerarContaDaComissao } from "@/lib/financeiro/comissoes";
import { dataDoDia } from "@/lib/financeiro/lancamentos";

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const schema = z.object({
  sellerId: z.string().min(1),
  de: dia,
  ate: dia,
  vencimento: dia,
});

/**
 * GERAR A CONTA A PAGAR DA COMISSÃO (RN-036). Porta do módulo Financeiro
 * (RN-027): exige a chave da loja e gerente/admin — vendedora não gera a
 * própria comissão.
 */
export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const { sellerId, de, ate, vencimento } = parsed.data;
    const r = await gerarContaDaComissao(
      porta.user.companyId,
      // o período viaja em DIA: quem transforma em janela de tempo é o motor
      // (`janelaDoPeriodo`), que inclui o dia inteiro do fim — o pedido pago
      // às 22h do último dia do mês é comissão daquele mês
      { sellerId, de, ate, vencimento: dataDoDia(vencimento)! },
      porta.user.name
    );
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
