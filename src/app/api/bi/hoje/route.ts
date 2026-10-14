import { NextResponse } from "next/server";
import { porteiraBi } from "@/lib/bi/gate";
import { numerosDeHoje } from "@/lib/bi/hoje";

export const dynamic = "force-dynamic";

/** Os números de hoje ao vivo (RN-088) — gerência, com a chave do módulo. */
export async function GET() {
  const porta = await porteiraBi();
  if (!porta.ok) return porta.resposta;
  return NextResponse.json(await numerosDeHoje(porta.user.companyId));
}
