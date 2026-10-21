import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { criarEtapa, estadoDoEditor, porteiraDoEditor, reordenarEtapas } from "@/lib/funil/editor";
import { respostaDoErro } from "@/lib/funil/resposta";

/** RN-091: abrir o editor (GET), criar etapa (POST) e reordenar (PUT). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const pipelineId = await porteiraDoEditor(user, req.nextUrl.searchParams.get("pipelineId") ?? "");
    return NextResponse.json(await estadoDoEditor(pipelineId));
  } catch (e) {
    return respostaDoErro(e);
  }
}

const criarSchema = z.object({
  pipelineId: z.string().min(1),
  name: z.string().max(200),
  color: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = criarSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const pipelineId = await porteiraDoEditor(user, parsed.data.pipelineId);
    return NextResponse.json(
      await criarEtapa(user, pipelineId, { name: parsed.data.name, color: parsed.data.color })
    );
  } catch (e) {
    return respostaDoErro(e);
  }
}

const ordemSchema = z.object({
  pipelineId: z.string().min(1),
  ids: z.array(z.string().min(1)).max(100),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = ordemSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const pipelineId = await porteiraDoEditor(user, parsed.data.pipelineId);
    return NextResponse.json(await reordenarEtapas(user, pipelineId, parsed.data.ids));
  } catch (e) {
    return respostaDoErro(e);
  }
}
