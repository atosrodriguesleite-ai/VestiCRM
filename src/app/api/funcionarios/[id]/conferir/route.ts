import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/scope";
import { rotuloCampoFicha, chaveDoDependente } from "@/lib/funcionarios";
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
      // "Dispensar" tem que CUMPRIR o que a tela promete: a resposta some.
      // Carimbar só a data deixaria CPF, chave Pix e conta bancária guardados
      // para sempre num registro que ninguém mais olha.
      const fechou = await db.fichaFormLink.updateMany({
        where: { id: link.id, conferidoEm: null },
        data: { conferidoEm: new Date(), resposta: Prisma.DbNull },
      });
      if (fechou.count === 0)
        return NextResponse.json({ error: "Já foi conferido." }, { status: 409 });
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

    const campos = Object.keys(link.resposta as object)
      .map((k) => rotuloCampoFicha[k] ?? k)
      .join(", ");

    // filho que já está na ficha não entra de novo (casa por nome, sem acento
    // nem maiúscula): duplo clique duplicava a família inteira
    const jaCadastrados = await db.funcionarioDependente.findMany({
      where: { funcionarioId: id },
      select: { nome: true },
    });
    const conhecidos = new Set(jaCadastrados.map((d) => chaveDoDependente(d.nome)));
    const novos = aplicavel.dependentes
      // o nome entra LIMPO na ficha: espaço duplo do teclado do celular não
      // vira parte do nome do filho
      .map((d) => ({ ...d, nome: d.nome.replace(/\s+/g, " ").trim() }))
      .filter((d) => !conhecidos.has(chaveDoDependente(d.nome)));

    // TUDO OU NADA, com a porteira do `conferidoEm: null` DENTRO da transação:
    // dois cliques seguidos (ou dois admins juntos) — só o primeiro grava
    const aplicado = await db.$transaction(async (tx) => {
      const fechou = await tx.fichaFormLink.updateMany({
        where: { id: link.id, conferidoEm: null },
        data: { conferidoEm: new Date(), resposta: Prisma.DbNull },
      });
      if (fechou.count === 0) return false;
      await tx.funcionario.update({ where: { id }, data: aplicavel.dados });
      for (const dep of novos) {
        await tx.funcionarioDependente.create({
          data: {
            funcionarioId: id,
            nome: dep.nome,
            nascimento: dataOuNull(dep.nascimento),
          },
        });
      }
      return true;
    });
    if (!aplicado)
      return NextResponse.json({ error: "Já foi conferido." }, { status: 409 });

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
