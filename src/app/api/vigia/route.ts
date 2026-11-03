import { NextResponse, after } from "next/server";
import { runWatchdogIfDue } from "@/lib/health";

/**
 * O DESPERTADOR DO VIGIA (RN-106, ADR-024). O vigia do WhatsApp roda de
 * carona no tráfego (ADR-002: nada de 3º cron na Vercel) — e de madrugada ou
 * num domingo sem ninguém usando, ninguém vigia nada. Um serviço externo de
 * "despertador de site" (cron-job.org) chama este endereço a cada 5 minutos.
 *
 * PÚBLICO DE PROPÓSITO, e por isso não faz nada além de acordar o vigia: a
 * rodada tem trava atômica no banco (no máximo uma a cada 5 min, não importa
 * quantas chamadas cheguem), não recebe nada de quem chama e não devolve
 * nada sobre as lojas. Chamar mil vezes custa o mesmo que chamar uma. Sem
 * segredo, o dono configura o despertador sem mexer nas variáveis da Vercel.
 *
 * Responde na hora (o despertador espera poucos segundos) e roda o vigia
 * depois da resposta — com folga para a cura automática, que reinicia a
 * conexão de uma loja (10 a 25 s no comum; bem mais no pior caso).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET() {
  after(() => runWatchdogIfDue());
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
