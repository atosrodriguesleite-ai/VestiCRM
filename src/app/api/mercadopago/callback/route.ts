import { NextRequest, NextResponse } from "next/server";
import { verifyState, mpExchangeCode, mpSaveConnection } from "@/lib/mercadopago";
import { appBaseUrl } from "@/lib/comm/evolution";

/** Volta do OAuth do Mercado Pago: troca o code pelos tokens e salva. */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/configuracoes?${q}`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const companyId = verifyState(state);
  if (!code || !companyId) return back("mp=erro");

  const tokens = await mpExchangeCode(code);
  if (!tokens) return back("mp=erro");
  await mpSaveConnection(companyId, tokens);
  return back("mp=ok");
}
