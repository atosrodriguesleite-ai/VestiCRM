import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { dadosParaImprimir, TETO_ETIQUETAS_POR_LOTE } from "@/lib/etiquetas/imprimir";
import { modeloPadraoDaLoja } from "@/lib/etiquetas/modelos";
import { pdfDoLote } from "@/lib/etiquetas/pdf";
import { zplDoLote } from "@/lib/etiquetas/zpl";

/**
 * IMPRIMIR ETIQUETAS DE EMBALAGEM (RN-059): a tela manda (variação,
 * quantidade) e o formato; o servidor monta os dados do cadastro, aplica o
 * modelo padrão da loja e devolve o PDF (uma página por etiqueta, na medida)
 * ou o ZPL (texto para a Zebra). Toda a equipe pode; a chave do módulo é da
 * porteira.
 */
const schema = z.object({
  formato: z.enum(["pdf", "zpl"]),
  itens: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantidade: z.number().int().min(0).max(TETO_ETIQUETAS_POR_LOTE),
      })
    )
    .min(1)
    .max(2000),
});

export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Dados inválidos: cada linha aceita de 0 a ${TETO_ETIQUETAS_POR_LOTE} etiquetas.` },
        { status: 400 }
      );
    }
    const { formato, itens } = parsed.data;
    const dados = await dadosParaImprimir(porta.user.companyId, itens);
    if (!dados.ok) {
      return NextResponse.json({ error: dados.erro, faltando: dados.faltando ?? [] }, { status: 400 });
    }
    const { modelo } = await modeloPadraoDaLoja(porta.user.companyId);

    if (formato === "zpl") {
      const zpl = zplDoLote(modelo, dados.lote);
      return new NextResponse(zpl, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="etiquetas-${dados.total}.zpl"`,
          "X-Etiquetas": String(dados.total),
        },
      });
    }
    const pdf = await pdfDoLote(modelo, dados.lote);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="etiquetas-${dados.total}.pdf"`,
        "X-Etiquetas": String(dados.total),
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
