import { NextResponse } from "next/server";
import { VERSAO_DO_APP } from "@/lib/versao-do-app";

/**
 * RN-113 · Qual versão do sistema está no ar AGORA.
 *
 * A tela aberta guarda a versão de quando carregou e pergunta aqui de tempos
 * em tempos; diferente, ela mostra "tem versão nova" com o botão de
 * atualizar. Não lê banco e não recebe nada. Só para quem está logado (o
 * porteiro global barra antes de chegar aqui) — sessão vencida leva 401 e a
 * tela simplesmente não avisa.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { versao: VERSAO_DO_APP },
    // a resposta guardada em qualquer lugar do caminho diria a versão de ontem
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
