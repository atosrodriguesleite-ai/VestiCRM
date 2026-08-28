import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FuncionarioDocTipo } from "@prisma/client";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { dataOuNull } from "@/lib/ficha-funcionario";

/**
 * ANEXAR DOCUMENTO à ficha (RN-025). Só ADMIN — documento de RH tem CPF e RG
 * dentro, é o tipo de coisa que não pode circular.
 *
 * Teto de ~4 MB por arquivo (data-URL): foto de celular comprimida passa;
 * scanner em resolução de pôster não — e o servidor cortaria o pedido de
 * qualquer jeito, melhor recusar com mensagem clara.
 */

const schema = z.object({
  // direto do enum do banco: tipo novo no schema entra aqui sozinho
  tipo: z.nativeEnum(FuncionarioDocTipo),
  fileName: z.string().min(1).max(160),
  arquivo: z.string().startsWith("data:").max(5_500_000),
  validade: z.string().nullable().optional(),
  dependenteId: z.string().nullable().optional(),
});

export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json(
        { error: "Documentos da ficha são do administrador." },
        { status: 403 }
      );
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Arquivo grande demais (máximo ~4 MB) ou campos inválidos." },
        { status: 400 }
      );

    const ficha = await db.funcionario.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!ficha) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    // dependente de OUTRA ficha não cola documento aqui
    if (parsed.data.dependenteId) {
      const dep = await db.funcionarioDependente.findFirst({
        where: { id: parsed.data.dependenteId, funcionarioId: id },
        select: { id: true },
      });
      if (!dep)
        return NextResponse.json({ error: "Dependente inválido" }, { status: 400 });
    }

    const validade = dataOuNull(parsed.data.validade);
    const doc = await db.funcionarioDocumento.create({
      data: {
        funcionarioId: id,
        dependenteId: parsed.data.dependenteId ?? null,
        tipo: parsed.data.tipo,
        fileName: parsed.data.fileName,
        arquivo: parsed.data.arquivo,
        validade,
      },
      select: { id: true, tipo: true, fileName: true, validade: true, dependenteId: true, createdAt: true },
    });
    return NextResponse.json(doc, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
