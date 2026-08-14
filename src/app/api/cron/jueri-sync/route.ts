import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncJueriCompany } from "@/lib/jueri-sync";
import { runWatchdogIfDue } from "@/lib/health";
import { atualizarRastreiosSeDevido } from "@/lib/rastreio";

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

  // quem sincronizou há mais tempo (ou nunca/falhou — lastSyncAt não marcado)
  // vai PRIMEIRO: se o tempo da função acabar no meio da fila, a loja que
  // ficou de fora é priorizada na próxima rodada, em vez de ficar para trás
  // em silêncio para sempre (auditoria 07/08/2026)
  const conns = await db.jueriConnection.findMany({
    // loja suspensa fica fora da fila do cron (não gasta o tempo da rodada)
    where: { company: { suspended: false } },
    select: { companyId: true },
    orderBy: { lastSyncAt: { sort: "asc", nulls: "first" } },
  });
  const results: { companyId: string; ok: boolean; resumo?: unknown; error?: string }[] = [];

  // O RELÓGIO COMEÇA AQUI, ANTES DO RASTREIO. A varredura faz chamadas
  // externas e pode demorar; com o marco zero depois dela, o guard de 240s
  // achava que tinha a rodada inteira e a Vercel cortava a função no meio da
  // fila do Jueri — sem sincronizar ninguém e sem deixar rastro (revisão da
  // bancada, 14/08/2026).
  const inicio = Date.now();
  // RASTREIO ANTES da fila do Jueri: a sincronização pode consumir os ~4 min
  // da rodada, e a varredura trava o relógio global assim que é chamada. No
  // fim da fila ela queimaria a vaga da madrugada — justo quando não há
  // ninguém na inbox para dar a carona.
  await atualizarRastreiosSeDevido();
  for (const c of conns) {
    // folga de ~1 min antes do teto: parar por conta própria deixa registro
    // (cortadas) — o corte da Vercel matava a função sem rastro nenhum
    if (Date.now() - inicio > 240_000) {
      results.push({ companyId: c.companyId, ok: false, error: "sem tempo nesta rodada (vai primeiro na próxima)" });
      continue;
    }
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

  // vigia do sistema também roda aqui — garante checagem mesmo em período
  // sem ninguém logado (madrugada/fim de semana)
  await runWatchdogIfDue();

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    lojas: conns.length,
    results,
  });
}
