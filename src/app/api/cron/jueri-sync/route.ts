import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncJueriCompany } from "@/lib/jueri-sync";

/**
 * Sincronização automática da Jueri — roda 2x por dia (agendada no Vercel,
 * ver vercel.json). Puxa da Jueri, para TODAS as lojas conectadas, os preços,
 * o estoque, os produtos novos e as fotos — assim os dois sistemas ficam
 * sempre iguais sem ninguém precisar clicar em "Importar".
 *
 * Protegida pelo CRON_SECRET: o Vercel envia esse segredo no cabeçalho
 * Authorization automaticamente. Sem o segredo configurado, a rota recusa
 * (fail-safe) para ninguém de fora conseguir disparar a importação.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300; // catálogos grandes: até 5 min por execução

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado no servidor." },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const conns = await db.jueriConnection.findMany({ select: { companyId: true } });
  const results: { companyId: string; ok: boolean; resumo?: unknown; error?: string }[] = [];

  for (const c of conns) {
    try {
      const out = await syncJueriCompany(c.companyId);
      results.push({ companyId: c.companyId, ok: out.ok, resumo: out.resumo, error: out.error });
    } catch (e) {
      results.push({
        companyId: c.companyId,
        ok: false,
        error: e instanceof Error ? e.message : "falha",
      });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), lojas: conns.length, results });
}
