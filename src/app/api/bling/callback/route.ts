import { NextRequest, NextResponse } from "next/server";
import { verifyState, blingExchangeCode, blingSaveConnection } from "@/lib/bling";
import { appBaseUrl } from "@/lib/comm/evolution";

/** Volta do OAuth do Bling: troca o code pelos tokens e salva. */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/configuracoes?${q}`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const companyId = verifyState(state);
  if (!code || !companyId) return back("bling=erro");

  const tokens = await blingExchangeCode(code);
  if (!tokens) return back("bling=erro");
  await blingSaveConnection(companyId, tokens);
  return back("bling=ok");
}
