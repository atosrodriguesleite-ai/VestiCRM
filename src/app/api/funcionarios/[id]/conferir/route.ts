import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { rotuloCampoFicha } from "@/lib/funcionarios";
import { aplicarResposta, dataOuNull } from "@/lib/ficha-funcionario";

/**
 * CONFERÊNCIA da ficha enviada pelo link (RN-025). Só ADMIN.
 *
 * Aprovar grava NA FICHA só os campos que o funcionário preencheu (campo em
 * branco não apaga nada) e cria os dependentes; dispensar arquiva a resposta
 * sem gravar. Os dois deixam registro no histórico.
 */
const schema = z.object({
  linkId: z.string().min(1),
  aprovar: z.boolean(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json(
        { error: "A conferência da ficha é do administrador." },
        { status: 403 }
      );
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

    // escopo RN-013: link da própria loja, da própria ficha, ainda pendente
    const link = await db.fichaFormLink.findFirst({
      where: {
        id: parsed.data.linkId,
        funcionarioId: id,
        companyId: user.companyId,
        usadoEm: { not: null },
        conferidoEm: null,
      },
    });
    if (!link)
      return NextResponse.json(
        { error: "Nada aguardando conferência neste link." },
        { status: 404 }
      );

    if (!parsed.data.aprovar) {
      await db.fichaFormLink.update({
        where: { id: link.id },
        data: { conferidoEm: new Date() },
      });
      await db.funcionarioEvento.create({
        data: {
          funcionarioId: id,
          descricao: "Resposta do formulário dispensada (nada foi gravado).",
          autorNome: user.name,
        },
      });
      return NextResponse.json({ ok: true });
    }

    const aplicavel = aplicarResposta(link.resposta);
    if (!aplicavel)
      return NextResponse.json(
        { error: "A resposta guardada não é mais válida — dispense e peça um novo link." },
        { status: 422 }
      );

    await db.funcionario.update({ where: { id }, data: aplicavel.dados });
    for (const dep of aplicavel.dependentes) {
      await db.funcionarioDependente.create({
        data: {
          funcionarioId: id,
          nome: dep.nome,
          nascimento: dataOuNull(dep.nascimento),
        },
      });
    }
    await db.fichaFormLink.update({
      where: { id: link.id },
      data: { conferidoEm: new Date() },
    });

    const campos = Object.keys(link.resposta as object)
      .map((k) => rotuloCampoFicha[k] ?? k)
      .join(", ");
    await db.funcionarioEvento.create({
      data: {
        funcionarioId: id,
        descricao: `Ficha do formulário conferida e aplicada (${campos}).`,
        autorNome: user.name,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
