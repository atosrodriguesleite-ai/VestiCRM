import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { novoCodigoDeLink } from "@/lib/catalogo/tabelas-de-preco-servidor";

/**
 * LINKS COM TABELA DE PREÇO (atacado / varejo) — recurso gated.
 *
 * GET    → lista os links da loja
 * POST   → cria um link ({ name, priceMode })
 * PATCH  → liga/desliga um link ({ id, active })
 *
 * Só gerente/admin mexem, e só se a loja tiver o recurso ativado pelo Super
 * Admin: sem isso a porta responde 403 e nada muda para ninguém.
 */

async function guardar(user: { companyId: string; role: string }) {
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { priceTablesEnabled: true },
  });
  if (!company?.priceTablesEnabled) return "Recurso não contratado.";
  if (!isManagerUp(user as never)) return "Só gerente ou admin podem mexer nos links.";
  return null;
}

export async function GET() {
  try {
    const user = await requireUser();
    const erro = await guardar(user);
    if (erro) return NextResponse.json({ error: erro }, { status: 403 });
    const links = await db.catalogLink.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, code: true, priceMode: true, active: true },
    });
    return NextResponse.json({ links });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const erro = await guardar(user);
    if (erro) return NextResponse.json({ error: erro }, { status: 403 });
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40),
        priceMode: z.enum(["VAREJO", "ATACADO"]),
      })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dê um nome ao link." }, { status: 400 });
    // teto de bom senso: a loja precisa de dois ou três links, não de mil.
    // Conta só os ATIVOS — senão o conselho "desative algum" não destravava.
    const quantos = await db.catalogLink.count({
      where: { companyId: user.companyId, active: true },
    });
    if (quantos >= 20)
      return NextResponse.json(
        { error: "Você já tem 20 links. Desative algum antes de criar outro." },
        { status: 409 }
      );
    const link = await db.catalogLink.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name,
        priceMode: parsed.data.priceMode,
        code: novoCodigoDeLink(),
      },
      select: { id: true, name: true, code: true, priceMode: true, active: true },
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const erro = await guardar(user);
    if (erro) return NextResponse.json({ error: erro }, { status: 403 });
    const parsed = z
      .object({ id: z.string().min(1), active: z.boolean() })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    // updateMany com companyId: link de outra loja não é alcançável
    const r = await db.catalogLink.updateMany({
      where: { id: parsed.data.id, companyId: user.companyId },
      data: { active: parsed.data.active },
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Link não encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
