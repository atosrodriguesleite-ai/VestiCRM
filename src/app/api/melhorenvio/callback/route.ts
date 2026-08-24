import { NextRequest, NextResponse } from "next/server";
import {
  verifyState,
  meExchangeCode,
  meSaveConnection,
  meLimparCacheServicos,
} from "@/lib/melhorenvio";
import { appBaseUrl } from "@/lib/comm/evolution";
import { sessaoAutorizadaPara } from "@/lib/oauth-state";

/** Volta do OAuth do Melhor Envio: troca o code pelos tokens e salva. */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appBaseUrl()}/configuracoes?${q}`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const companyId = verifyState(state);
  if (!code || !companyId) return back("me=erro");
  // QUEM VOLTOU É DA LOJA? Sem isto, um link de autorização repassado a outra
  // pessoa ligava a conta (e a carteira) dela na loja de quem mandou o link.
  const sessao = await sessaoAutorizadaPara(companyId);
  if (sessao !== "ok") return back(`me=${sessao}`);

  const tokens = await meExchangeCode(code);
  if (!tokens) return back("me=erro");
  await meSaveConnection(companyId, tokens);
  // conta ME nova = lista de serviços possivelmente outra (aqui, e não na
  // renovação automática de token, que salva a MESMA conta o tempo todo)
  meLimparCacheServicos(companyId);
  return back("me=ok");
}
