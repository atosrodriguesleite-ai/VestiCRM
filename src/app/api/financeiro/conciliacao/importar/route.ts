import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { importarOFX } from "@/lib/financeiro/conciliacao";
import { decodificarOFX } from "@/lib/financeiro/ofx";

/** Teto do arquivo: extrato de um ano de loja grande não passa de uns 2 MB. */
const TETO_BYTES = 5 * 1024 * 1024;

// ler o arquivo, gravar as linhas e casar o óbvio leva mais que o padrão da
// Vercel num extrato grande — e função cortada no meio deixaria a importação
// pela metade (mesma régua das outras rotas de upload da casa)
export const maxDuration = 60;

/**
 * IMPORTAR EXTRATO OFX (RN-037). O arquivo NÃO é guardado: dele saem as
 * linhas do extrato, que é o que a conciliação usa — guardar o OFX inteiro
 * como data-URL só aumentaria a dívida técnica nº 1 sem servir para nada.
 */
export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;

    const form = await req.formData().catch(() => null);
    const arquivo = form?.get("arquivo");
    const contaId = String(form?.get("contaId") ?? "");
    if (!contaId)
      return NextResponse.json({ error: "Escolha a conta do extrato" }, { status: 400 });
    if (!(arquivo instanceof File))
      return NextResponse.json({ error: "Envie o arquivo OFX do banco" }, { status: 400 });
    if (arquivo.size > TETO_BYTES)
      return NextResponse.json(
        { error: "Arquivo grande demais — exporte um período menor" },
        { status: 400 }
      );

    const texto = decodificarOFX(await arquivo.arrayBuffer());
    const r = await importarOFX(
      porta.user.companyId,
      contaId,
      { nome: arquivo.name, texto },
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
