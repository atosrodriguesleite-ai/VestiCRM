import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCode,
  registerWebhooks,
  saveConnection,
  syncProducts,
  verifyState,
} from "@/lib/nuvemshop";
import { sessaoAutorizadaPara } from "@/lib/oauth-state";

/**
 * Retorno do OAuth da Nuvemshop: troca o código pelo token, salva a conexão
 * da loja, registra os webhooks e dispara a primeira importação de produtos
 * em segundo plano. O estado assinado garante que o retorno pertence à
 * empresa que iniciou a conexão.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const companyId = verifyState(state);
  const back = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin));

  if (!code || !companyId) return back("/configuracoes?nuvemshop=erro");
  // quem voltou tem que ser da própria loja (ver lib/oauth-state.ts)
  const sessao = await sessaoAutorizadaPara(companyId);
  if (sessao !== "ok") return back(`/configuracoes?nuvemshop=${sessao}`);

  const cred = await exchangeCode(code);
  if (!cred) return back("/configuracoes?nuvemshop=erro");

  await saveConnection(companyId, cred.storeId, cred.token);
  await registerWebhooks(companyId).catch(() => {});
  // primeira importação sem travar o redirecionamento
  syncProducts(companyId).catch(() => {});

  return back("/configuracoes?nuvemshop=ok");
}
