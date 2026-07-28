import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";
import { ensurePlatformCompany } from "@/lib/platform";

/**
 * Portfólio de produtos e serviços — listagem e criação.
 *
 * Material interno do dono da plataforma: fica SEMPRE na empresa-plataforma e
 * só o Super Admin enxerga. Nenhuma loja tem acesso, nem por impersonação —
 * a checagem é de papel, não de empresa.
 */

const criar = z.object({
  name: z.string().min(1, "informe o nome").max(160),
});

export async function GET() {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const companyId = await ensurePlatformCompany();
    const products = await db.portfolioProduct.findMany({
      where: { companyId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: {
        variants: { orderBy: { order: "asc" } },
        positions: { orderBy: { order: "asc" } },
      },
    });
    return NextResponse.json(products);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao listar" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = criar.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }
    const companyId = await ensurePlatformCompany();

    // nasce como RASCUNHO: produto recém-criado ainda não está pronto para
    // ser vendido, e o dono decide quando vira "Disponível".
    const created = await db.portfolioProduct.create({
      data: {
        companyId,
        name: parsed.data.name.trim(),
        status: "RASCUNHO",
      },
      select: { id: true, name: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao criar" }, { status: 500 });
  }
}
