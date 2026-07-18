import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { parseNuvemshopCsv, simularVinculo } from "@/lib/nuvemshop-simulacao";

/**
 * Relatório pré-conexão: recebe o CSV exportado da Nuvemshop e devolve o
 * que casaria / entraria novo / ficaria pendente — SEM criar nem alterar
 * nada. Serve pra testar o vínculo antes de conectar a loja de verdade.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as { csv?: string } | null;
    const csv = body?.csv ?? "";
    if (!csv.trim()) {
      return NextResponse.json({ error: "Arquivo vazio" }, { status: 400 });
    }
    if (csv.length > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Arquivo muito grande (máx. 5 MB)" },
        { status: 400 }
      );
    }
    const produtos = parseNuvemshopCsv(csv);
    if (produtos.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não consegui ler a planilha. Use o arquivo exportado da Nuvemshop (Produtos → Exportar) sem mudar as colunas.",
        },
        { status: 400 }
      );
    }
    const report = await simularVinculo(user.companyId, produtos);
    return NextResponse.json(report);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
