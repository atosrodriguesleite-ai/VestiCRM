import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apagarEtapa, editarEtapa, porteiraDoEditor } from "@/lib/funil/editor";
import { respostaDoErro } from "@/lib/funil/resposta";

/** RN-091: renomear/mudar a cor (PATCH) e apagar com destino (DELETE). */
const editarSchema = z.object({
  pipelineId: z.string().min(1),
  name: z.string().max(200).optional(),
  color: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = editarSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const pipelineId = await porteiraDoEditor(user, parsed.data.pipelineId);
    return NextResponse.json(
      await editarEtapa(user, pipelineId, id, { name: parsed.data.name, color: parsed.data.color })
    );
  } catch (e) {
    return respostaDoErro(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const busca = req.nextUrl.searchParams;
    const pipelineId = await porteiraDoEditor(user, busca.get("pipelineId") ?? "");
    return NextResponse.json(await apagarEtapa(user, pipelineId, id, busca.get("destino")));
  } catch (e) {
    return respostaDoErro(e);
  }
}
