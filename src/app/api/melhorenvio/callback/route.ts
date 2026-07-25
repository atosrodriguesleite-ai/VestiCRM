import { NextRequest, NextResponse } from "next/server";
import { verifyState, meExchangeCode, meSaveConnection } from "@/lib/melhorenvio";
import { appBaseUrl } from "@/lib/comm/evolution";

/** Volta do OAuth do Melhor Envio: troca o code pelos tokens e salva. */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/configuracoes?${q}`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const companyId = verifyState(state);
  if (!code || !companyId) return back("me=erro");

  const tokens = await meExchangeCode(code);
  if (!tokens) return back("me=erro");
  await meSaveConnection(companyId, tokens);
  return back("me=ok");
}
