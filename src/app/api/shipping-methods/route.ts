import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";

/**
 * Meios de envio da loja (Correios / Transportadora): Sedex, Pac, Loggi,
 * Jadlog... Alimentam o seletor de envio de cada pedido.
 * GET: lista (qualquer usuário — vendedor precisa pra escolher no pedido).
 * POST: cadastra (admin/gerente ou Suporte).
 */

const KINDS = ["CORREIOS", "TRANSPORTADORA"] as const;

export async function GET() {
  try {
    const user = await requireUser();
    const methods = await db.shippingMethod.findMany({
      where: { companyId: user.companyId, active: true },
      orderBy: [{ kind: "asc" }, { order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true },
    });
    return NextResponse.json({ methods });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  name: z.string().min(1).max(40),
  kind: z.enum(KINDS).default("TRANSPORTADORA"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!(isManagerUp(user) || isSupport(user))) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Informe o nome do meio de envio." }, { status: 400 });
    const name = parsed.data.name.trim();

    const exists = await db.shippingMethod.findFirst({
      where: { companyId: user.companyId, name: { equals: name, mode: "insensitive" } },
      select: { id: true, active: true },
    });
    if (exists) {
      // se existir desativado, reativa; se ativo, avisa que já existe
      if (!exists.active) {
        const m = await db.shippingMethod.update({
          where: { id: exists.id },
          data: { active: true, kind: parsed.data.kind },
          select: { id: true, name: true, kind: true },
        });
        return NextResponse.json({ ok: true, method: m }, { status: 201 });
      }
      return NextResponse.json({ error: "Esse meio de envio já existe." }, { status: 409 });
    }

    const method = await db.shippingMethod.create({
      data: { companyId: user.companyId, name, kind: parsed.data.kind },
      select: { id: true, name: true, kind: true },
    });
    return NextResponse.json({ ok: true, method }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
