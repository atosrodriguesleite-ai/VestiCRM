import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { descricaoMudancaSalario } from "@/lib/funcionarios";
import { fichaSchema, corpoDaFicha, dataOuNull } from "@/lib/ficha-funcionario";

/**
 * EDITAR / DESLIGAR uma ficha (RN-025). Só ADMIN.
 *
 * NÃO EXISTE DELETE: ficha de ex-funcionário fica arquivada (questão
 * trabalhista dura anos). Desligar preenche `desligamento` + motivo, e
 * reativar limpa — os dois com registro no histórico. Mudança de salário
 * também fica registrada (quem, quando, de quanto para quanto).
 */

const patchSchema = fichaSchema.partial().extend({
  desligamento: z.string().nullable().optional(),
  motivoDesligamento: z.string().max(300).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json(
        { error: "A ficha de funcionário é do administrador." },
        { status: 403 }
      );
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Confira os campos da ficha." }, { status: 400 });

    const antes = await db.funcionario.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!antes) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const { desligamento, motivoDesligamento, ...ficha } = parsed.data;
    // só o que VEIO no corpo entra no update — o resto da ficha fica como está
    const dados: Record<string, unknown> = { ...corpoDaFicha(ficha) };
    if (desligamento !== undefined) {
      dados.desligamento = dataOuNull(desligamento);
      dados.motivoDesligamento = dados.desligamento ? (motivoDesligamento ?? null) : null;
    }

    const depois = await db.funcionario.update({ where: { id }, data: dados });

    // ---- histórico: salário e desligamento não mudam em silêncio ----
    const registros: string[] = [];
    const mudancaSalario = descricaoMudancaSalario(antes, depois);
    if (mudancaSalario) registros.push(mudancaSalario);
    if (!antes.desligamento && depois.desligamento)
      registros.push(
        `Desligada em ${depois.desligamento.toLocaleDateString("pt-BR")}${
          depois.motivoDesligamento ? ` — ${depois.motivoDesligamento}` : ""
        }.`
      );
    if (antes.desligamento && !depois.desligamento) registros.push("Ficha reativada.");
    for (const descricao of registros) {
      await db.funcionarioEvento.create({
        data: { funcionarioId: id, descricao, autorNome: user.name },
      });
    }

    return NextResponse.json(depois);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
