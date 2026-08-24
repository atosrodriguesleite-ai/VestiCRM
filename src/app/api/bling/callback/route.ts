import { NextRequest, NextResponse } from "next/server";
import { verifyState, blingExchangeCode, blingSaveConnection } from "@/lib/bling";
import { appBaseUrl } from "@/lib/comm/evolution";
import { sessaoAutorizadaPara } from "@/lib/oauth-state";

/** Volta do OAuth do Bling: troca o code pelos tokens e salva. */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/configuracoes?${q}`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const companyId = verifyState(state);
  if (!code || !companyId) return back("bling=erro");
  // quem voltou tem que ser da própria loja (ver lib/oauth-state.ts)
  const sessao = await sessaoAutorizadaPara(companyId);
  if (sessao !== "ok") return back(`bling=${sessao}`);

  const tokens = await blingExchangeCode(code);
  if (!tokens) return back("bling=erro");
  // conexão sem refresh_token é recusada (morreria sozinha em ~6h)
  const salvo = await blingSaveConnection(companyId, tokens);
  if (!salvo) return back("bling=erro");
  return back("bling=ok");
}
