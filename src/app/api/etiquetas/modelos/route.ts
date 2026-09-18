import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { criarModelo, listarModelos } from "@/lib/etiquetas/modelos";

/** Os modelos de etiqueta da loja (os padrões nascem se ainda não existirem). */
export async function GET() {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    return NextResponse.json({ modelos: await listarModelos(porta.user.companyId) });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  nome: z.string().trim().min(1).max(80),
  tipo: z.enum(["EMBALAGEM", "COMPOSICAO", "ENVIO"]),
  copiarDe: z.string().min(1).optional(),
});

/** Modelo novo (gerência e suporte, a mesma régua da ficha da peça). */
export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    if (!isManagerUp(porta.user) && !isSupport(porta.user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dê um nome ao modelo e escolha o tipo." }, { status: 400 });
    return NextResponse.json({ modelo: await criarModelo(porta.user.companyId, parsed.data) });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
