import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { configDaIa, estadoDaTrava, usoDoMes } from "@/lib/ia";

/**
 * Cérebro da IA — leitura e gravação da configuração da loja.
 * Gerente+ apenas (o tom da marca e as políticas são decisão da gestão),
 * e só com o módulo ativado pelo Super Admin.
 */

async function moduloAtivo(companyId: string) {
  const c = await db.company.findUnique({
    where: { id: companyId },
    select: { aiSalesEnabled: true },
  });
  return Boolean(c?.aiSalesEnabled);
}

export async function GET() {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (!(await moduloAtivo(user.companyId))) {
      return NextResponse.json({ error: "Módulo não contratado" }, { status: 403 });
    }
    const [config, uso] = await Promise.all([
      configDaIa(user.companyId),
      usoDoMes(user.companyId),
    ]);
    return NextResponse.json({
      config,
      uso,
      trava: estadoDaTrava(config.limiteConversasMes, uso.conversas),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  atendente: z.boolean().optional(),
  copilot: z.boolean().optional(),
  relatoriosAoDono: z.boolean().optional(),
  tomDeMarca: z.string().max(4000).optional(),
  roteiro: z.string().max(8000).optional(),
  politicas: z.string().max(8000).optional(),
  // o limite é o PLANO vendido para a loja — só o Super Admin mexe
  limiteConversasMes: z.number().int().min(0).max(1_000_000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (!(await moduloAtivo(user.companyId))) {
      return NextResponse.json({ error: "Módulo não contratado" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { limiteConversasMes, ...resto } = parsed.data;
    if (limiteConversasMes !== undefined && user.role !== "SUPERADMIN") {
      return NextResponse.json(
        { error: "O limite do plano é definido pela plataforma" },
        { status: 403 }
      );
    }
    await configDaIa(user.companyId); // garante que a linha existe
    const config = await db.aiSettings.update({
      where: { companyId: user.companyId },
      data: { ...resto, ...(limiteConversasMes !== undefined ? { limiteConversasMes } : {}) },
    });
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
