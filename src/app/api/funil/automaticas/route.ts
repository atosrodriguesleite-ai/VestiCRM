import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { porteiraDoEditor, salvarMarcos } from "@/lib/funil/editor";
import { respostaDoErro } from "@/lib/funil/resposta";

/** RN-091: para qual etapa o sistema move o cartão sozinho (null = não mover). */
const alvo = z.string().min(1).nullable().optional();
const schema = z.object({
  pipelineId: z.string().min(1),
  marcos: z
    .object({
      PRIMEIRO_CONTATO: alvo,
      CATALOGO_ENVIADO: alvo,
      NEGOCIACAO: alvo,
      PAGAMENTO: alvo,
    })
    .strict(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const pipelineId = await porteiraDoEditor(user, parsed.data.pipelineId);
    // só os marcos que vieram mudam (undefined = não mexe)
    const pedido = Object.fromEntries(
      Object.entries(parsed.data.marcos).filter(([, v]) => v !== undefined)
    );
    return NextResponse.json(await salvarMarcos(user, pipelineId, pedido));
  } catch (e) {
    return respostaDoErro(e);
  }
}
