import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

const ORIGINS = [
  "WHATSAPP", "CATALOGO_PUBLICO", "INSTAGRAM", "FACEBOOK", "SITE",
  "NUVEMSHOP", "BLING", "MARKETPLACE", "INDICACAO", "LOJA_FISICA",
  "TRAFEGO_PAGO", "GOOGLE", "EVENTO", "MANUAL",
] as const;

const schema = z.object({
  distribution: z.enum(["ROUND_ROBIN", "FIXED"]).optional(),
  defaultUserId: z.string().nullable().optional(),
  slaMinutes: z.number().int().positive().optional(),
  oppPolicy: z.enum(["SEMPRE", "SE_NAO_HOUVER_ABERTA", "NUNCA"]).optional(),
  rules: z
    .array(z.object({ origin: z.enum(ORIGINS), stageId: z.string().nullable() }))
    .optional(),
});

/** Configuração do Lead Intake Engine (admin). */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { rules, distribution, defaultUserId, slaMinutes, oppPolicy } =
      parsed.data;

    if (defaultUserId) {
      const target = await db.user.findFirst({
        where: { id: defaultUserId, companyId: user.companyId, active: true },
      });
      if (!target) {
        return NextResponse.json({ error: "Vendedor inválido" }, { status: 404 });
      }
    }

    await db.company.update({
      where: { id: user.companyId },
      data: {
        ...(distribution ? { intakeDistribution: distribution } : {}),
        ...(defaultUserId !== undefined
          ? { intakeDefaultUserId: defaultUserId }
          : {}),
        ...(slaMinutes ? { intakeSlaMinutes: slaMinutes } : {}),
        ...(oppPolicy ? { intakeOppPolicy: oppPolicy } : {}),
      },
    });

    if (rules) {
      for (const rule of rules) {
        if (rule.stageId) {
          const stage = await db.stage.findFirst({
            where: { id: rule.stageId, pipeline: { companyId: user.companyId } },
          });
          if (!stage) continue;
        }
        await db.originRule.upsert({
          where: {
            companyId_origin: { companyId: user.companyId, origin: rule.origin },
          },
          update: { stageId: rule.stageId },
          create: {
            companyId: user.companyId,
            origin: rule.origin,
            stageId: rule.stageId,
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
