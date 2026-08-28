import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin, isManagerUp } from "@/lib/scope";
import { fichaBasica } from "@/lib/funcionarios";
import { fichaSchema, corpoDaFicha } from "@/lib/ficha-funcionario";

/**
 * FICHAS DE FUNCIONÁRIO (RN-025) — registro de RH da empresa, sem vínculo com
 * login. QUEM VÊ O QUÊ é decidido AQUI, no servidor: ADMIN recebe a ficha
 * inteira; GERENTE recebe só o recorte básico (`fichaBasica` — lista do que
 * ENTRA, nunca do que sai); vendedora/suporte não recebem nada.
 */

export async function GET() {
  try {
    const user = await requireUser();
    if (!isManagerUp(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const admin = isAdmin(user);

    const fichas = await db.funcionario.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ desligamento: "asc" }, { nome: "asc" }],
      include: admin
        ? {
            dependentes: { orderBy: { createdAt: "asc" } },
            // o ARQUIVO fica de fora da lista (base64 pesa; baixa por rota própria)
            documentos: {
              select: {
                id: true,
                tipo: true,
                fileName: true,
                validade: true,
                dependenteId: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
            },
            eventos: { orderBy: { createdAt: "desc" }, take: 20 },
            // resposta do formulário aguardando conferência (RN-025)
            formLinks: {
              where: { usadoEm: { not: null }, conferidoEm: null },
              select: { id: true, usadoEm: true, resposta: true },
              orderBy: { usadoEm: "desc" },
            },
          }
        : undefined,
    });

    return NextResponse.json({
      admin,
      funcionarios: admin ? fichas : fichas.map(fichaBasica),
    });
  } catch (e) {
    return trata(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    // criar/editar ficha é de ADMIN: gerente só lê o básico
    if (!isAdmin(user))
      return NextResponse.json(
        { error: "Cadastrar funcionário é do administrador." },
        { status: 403 }
      );
    const parsed = fichaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Confira os campos da ficha." }, { status: 400 });

    const f = await db.funcionario.create({
      // o `nome` explícito é pelo tipo: corpoDaFicha aceita ficha parcial
      data: { companyId: user.companyId, ...corpoDaFicha(parsed.data), nome: parsed.data.nome },
    });
    await db.funcionarioEvento.create({
      data: { funcionarioId: f.id, descricao: "Ficha criada.", autorNome: user.name },
    });
    return NextResponse.json(f, { status: 201 });
  } catch (e) {
    return trata(e);
  }
}

function trata(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  throw e;
}
