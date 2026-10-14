import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { porteiraBi } from "@/lib/bi/gate";
import { mesValido } from "@/lib/bi/metas";
import { TETO_DO_GASTO } from "@/lib/bi/anuncios";
import { r2 } from "@/lib/tracking/insights-puro";

/**
 * GASTO DE ANÚNCIO POR MÊS (RN-085): a gerência digita, por campanha e mês,
 * quanto gastou. Valor nulo APAGA o mês. Gerência, com a chave do módulo
 * (porteira do BI); a campanha tem que ser DA LOJA (RN-013). A tela manda SÓ
 * as células que mudaram, cada uma com o valor que a pessoa VIU (`visto`):
 * gravação condicional, a régua da RN-050 — o número que mudou por baixo
 * (outra aba, outra gerente) é recusado com frase, nunca sobrescrito calado.
 * Centavos (2 casas): "12,345" gravado cru voltava para a tela como "12.345"
 * e virava 12 mil na leitura seguinte (achado da revisão).
 */
const schema = z.object({
  gastos: z
    .array(
      z.object({
        campanhaId: z.string().min(1),
        mes: z.string(),
        valor: z.number().min(0).max(TETO_DO_GASTO).nullable(),
        visto: z.number().min(0).max(TETO_DO_GASTO).nullable(),
      })
    )
    .min(1)
    .max(200),
});

class Mudou extends Error {}

export async function PATCH(req: NextRequest) {
  const porta = await porteiraBi();
  if (!porta.ok) return porta.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const companyId = porta.user.companyId;
  const { gastos } = parsed.data;
  for (const g of gastos) {
    if (!mesValido(g.mes)) return NextResponse.json({ error: `Mês inválido (${g.mes}).` }, { status: 400 });
  }
  const ids = [...new Set(gastos.map((g) => g.campanhaId))];
  const minhas = await db.marketingCampaign.findMany({ where: { companyId, id: { in: ids } }, select: { id: true } });
  if (minhas.length !== ids.length) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  const nomeDe = new Map((await db.marketingCampaign.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  try {
    await db.$transaction(
      async (tx) => {
        for (const g of gastos) {
          const atual = await tx.biGastoDeAnuncio.findUnique({
            where: { companyId_campanhaId_mes: { companyId, campanhaId: g.campanhaId, mes: g.mes } },
            select: { valor: true },
          });
          const noBanco = atual ? r2(atual.valor) : null;
          const visto = g.visto === null ? null : r2(g.visto);
          if (noBanco !== visto) {
            throw new Mudou(`O gasto de "${nomeDe.get(g.campanhaId) ?? "campanha"}" em ${g.mes} mudou enquanto você editava (agora ${noBanco === null ? "sem gasto" : `R$ ${noBanco.toFixed(2).replace(".", ",")}`}). Recarregue a página e confira.`);
          }
          const valor = g.valor === null ? null : r2(g.valor);
          if (valor === null || valor === 0) {
            await tx.biGastoDeAnuncio.deleteMany({ where: { companyId, campanhaId: g.campanhaId, mes: g.mes } });
          } else {
            await tx.biGastoDeAnuncio.upsert({
              where: { companyId_campanhaId_mes: { companyId, campanhaId: g.campanhaId, mes: g.mes } },
              create: { companyId, campanhaId: g.campanhaId, mes: g.mes, valor },
              update: { valor },
            });
          }
        }
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  } catch (e) {
    if (e instanceof Mudou) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
