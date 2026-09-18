import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { orderScope } from "@/lib/scope";
import { dadosDeEnvioDoPedido, dadosParaImprimir, TETO_ETIQUETAS_POR_LOTE } from "@/lib/etiquetas/imprimir";
import { modeloDaLoja, modeloPadraoDaLoja } from "@/lib/etiquetas/modelos";
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
  /** qual modelo (ausente = o padrão de embalagem da loja) */
  modeloId: z.string().min(1).optional(),
  /** etiqueta de ENVIO: o pedido, e `copias` = quantas etiquetas do pacote */
  orderId: z.string().min(1).optional(),
  copias: z.number().int().min(1).max(50).optional(),
  itens: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantidade: z.number().int().min(0).max(TETO_ETIQUETAS_POR_LOTE),
      })
    )
    .max(2000)
    .optional(),
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
    const { formato, itens, modeloId, orderId, copias } = parsed.data;
    // o modelo: o pedido explicitamente, senão o padrão de embalagem
    const escolhido = modeloId ? await modeloDaLoja(porta.user.companyId, modeloId) : null;
    if (modeloId && !escolhido) return NextResponse.json({ error: "Modelo de etiqueta não encontrado." }, { status: 404 });
    const tipo = escolhido?.tipo ?? "EMBALAGEM";
    const modelo = escolhido?.modelo ?? (await modeloPadraoDaLoja(porta.user.companyId)).modelo;

    let dados: Awaited<ReturnType<typeof dadosParaImprimir>>;
    if (tipo === "ENVIO") {
      // etiqueta do PACOTE: uma por pedido (× cópias), com os dados da ficha
      if (!orderId) return NextResponse.json({ error: "A etiqueta de envio precisa de um pedido." }, { status: 400 });
      const envio = await dadosDeEnvioDoPedido(porta.user.companyId, orderId, orderScope(porta.user));
      if (!envio.ok) return NextResponse.json({ error: envio.erro }, { status: 404 });
      dados = { ok: true, lote: [{ dados: envio.dados, quantidade: copias ?? 1 }], total: copias ?? 1 };
    } else {
      if (!itens || itens.length === 0) return NextResponse.json({ error: "Escolha ao menos uma peça." }, { status: 400 });
      dados = await dadosParaImprimir(porta.user.companyId, itens);
    }
    if (!dados.ok) {
      return NextResponse.json({ error: dados.erro, faltando: dados.faltando ?? [] }, { status: 400 });
    }

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
