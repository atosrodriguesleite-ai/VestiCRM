import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chavesDoEventoDeFotos, ipDaRequisicao, registrarTentativa, segundosDeBloqueio } from "@/lib/rate-limit";

/**
 * RN-070 · a galeria avisa "baixou N fotos" (beacon, sem login). Porta
 * pública de escrita mínima: só soma num contador do link que EXISTE e
 * ainda vale — código desconhecido ou vencido não grava nada. O corpo não
 * é guardado, então não há o que inflar além do número — e o número tem
 * RITMO por IP (RN-044): quem passa do teto leva 429 e não conta.
 */
const TETO_POR_BATIDA = 200;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { code?: unknown; n?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 32) return NextResponse.json({ ok: false }, { status: 400 });
  const n = Math.min(TETO_POR_BATIDA, Math.max(1, Math.floor(typeof body?.n === "number" ? body.n : 1)));

  const chaves = chavesDoEventoDeFotos(ipDaRequisicao(req.headers));
  if (chaves.length) {
    if ((await segundosDeBloqueio(chaves)) !== null) return NextResponse.json({ ok: false }, { status: 429 });
    if ((await registrarTentativa(chaves)) !== null) return NextResponse.json({ ok: false }, { status: 429 });
  }

  await db.fotosLink
    .updateMany({
      where: { code, expiresAt: { gt: new Date() } },
      data: { downloads: { increment: n } },
    })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
