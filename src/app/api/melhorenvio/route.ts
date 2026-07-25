import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { meEnv, meBalance } from "@/lib/melhorenvio";

/** Estado da conexão Melhor Envio + configurações de remetente/embalagem. */
export async function GET() {
  try {
    const user = await requireUser();
    const [company, conn] = await Promise.all([
      db.company.findUnique({
        where: { id: user.companyId },
        select: { shippingEnabled: true },
      }),
      db.melhorEnvioConnection.findUnique({
        where: { companyId: user.companyId },
        select: {
          connectedAt: true,
          fromName: true,
          fromDocument: true,
          fromPhone: true,
          fromEmail: true,
          fromZip: true,
          fromStreet: true,
          fromNumber: true,
          fromComplement: true,
          fromDistrict: true,
          fromCity: true,
          fromState: true,
          defaultWeightGrams: true,
          boxWidthCm: true,
          boxHeightCm: true,
          boxLengthCm: true,
          categoryWeights: true,
        },
      }),
    ]);
    // saldo só quando conectado (chamada externa — melhor esforço)
    const balance = conn ? await meBalance(user.companyId).catch(() => null) : null;
    return NextResponse.json({
      enabled: Boolean(company?.shippingEnabled),
      platformReady: meEnv().configured,
      connected: Boolean(conn),
      balance,
      settings: conn ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const settingsSchema = z.object({
  fromName: z.string().max(120).optional(),
  fromDocument: z.string().max(20).optional(),
  fromPhone: z.string().max(20).optional(),
  fromEmail: z.string().max(120).optional(),
  fromZip: z.string().max(10).optional(),
  fromStreet: z.string().max(160).optional(),
  fromNumber: z.string().max(20).optional(),
  fromComplement: z.string().max(80).optional(),
  fromDistrict: z.string().max(80).optional(),
  fromCity: z.string().max(80).optional(),
  fromState: z.string().max(2).optional(),
  defaultWeightGrams: z.number().int().min(1).max(30000).optional(),
  boxWidthCm: z.number().int().min(1).max(100).optional(),
  boxHeightCm: z.number().int().min(1).max(100).optional(),
  boxLengthCm: z.number().int().min(1).max(100).optional(),
  // {"Vestidos": 350} — peso padrão por categoria, em gramas
  categoryWeights: z.record(z.string(), z.number().min(0).max(30000)).optional(),
});

/** Salva remetente e padrões de embalagem (admin). */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const parsed = settingsSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { categoryWeights, ...campos } = parsed.data;
    const r = await db.melhorEnvioConnection.updateMany({
      where: { companyId: user.companyId },
      data: {
        ...campos,
        ...(categoryWeights !== undefined
          ? { categoryWeights: JSON.stringify(categoryWeights) }
          : {}),
      },
    });
    if (r.count === 0)
      return NextResponse.json(
        { error: "Conecte o Melhor Envio primeiro." },
        { status: 409 }
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
