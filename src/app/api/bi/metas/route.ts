import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { porteiraBi } from "@/lib/bi/gate";
import { TIPOS, mesValido, validarMeta } from "@/lib/bi/metas";

/**
 * METAS DO MÊS DO BI (RN-082): a loja escolhe quais metas quer e com que
 * número, por mês. Valor nulo APAGA a meta daquele tipo. Gerência, com a
 * chave do módulo (porteira do BI). Tudo numa transação: a tela manda o
 * conjunto do mês, e metade gravada seria uma tela mentindo.
 */
const schema = z.object({
  mes: z.string(),
  metas: z
    .array(z.object({ tipo: z.string(), valor: z.number().nullable() }))
    .max(TIPOS.length),
});

export async function PATCH(req: NextRequest) {
  const porta = await porteiraBi();
  if (!porta.ok) return porta.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { mes, metas } = parsed.data;
  if (!mesValido(mes)) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  for (const m of metas) {
    if (!TIPOS.includes(m.tipo)) return NextResponse.json({ error: "Tipo de meta desconhecido." }, { status: 400 });
    if (m.valor !== null) {
      const erro = validarMeta(m.tipo, m.valor);
      if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    }
  }
  const companyId = porta.user.companyId;
  await db.$transaction(async (tx) => {
    for (const m of metas) {
      if (m.valor === null) {
        await tx.biMeta.deleteMany({ where: { companyId, mes, tipo: m.tipo } });
      } else {
        await tx.biMeta.upsert({
          where: { companyId_mes_tipo: { companyId, mes, tipo: m.tipo } },
          create: { companyId, mes, tipo: m.tipo, valor: m.valor },
          update: { valor: m.valor },
        });
      }
    }
  });
  return NextResponse.json({ ok: true });
}
