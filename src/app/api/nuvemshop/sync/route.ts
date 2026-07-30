import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { syncAbandonedCheckouts, syncProducts } from "@/lib/nuvemshop";
import {
  explicarNuvemshop,
  motivoPeloErro,
  motivoPeloStatus,
} from "@/lib/nuvemshop-erros";
import { logServerError } from "@/lib/health";

export const maxDuration = 60;

/**
 * Sincronização completa sob demanda (produtos + carrinhos abandonados).
 *
 * Quando falha, a resposta DIZ O QUE ACONTECEU e o que fazer — e o erro fica
 * registrado no painel de Saúde. Antes qualquer tropeço virava um 500 mudo e
 * a tela mostrava "Não foi possível sincronizar.", sem pista nenhuma para a
 * lojista nem para o suporte.
 */
export async function POST() {
  let user;
  try {
    user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }

  try {
    const produtos = await syncProducts(user.companyId);
    if (!produtos.ok) {
      const { motivo, mensagem } =
        produtos.status === -1
          ? explicarNuvemshop("SEM_CONEXAO")
          : explicarNuvemshop(motivoPeloStatus(produtos.status));
      await logServerError({
        source: "server",
        path: "/api/nuvemshop/sync",
        message: `Nuvemshop: sincronização recusada (${motivo})`,
        detail: `HTTP ${produtos.status} · empresa ${user.companyId}`,
      });
      return NextResponse.json({ error: mensagem, motivo }, { status: 502 });
    }

    const carrinhos = await syncAbandonedCheckouts(user.companyId);
    return NextResponse.json({
      ok: true,
      produtos: produtos.produtos,
      carrinhosNovos: carrinhos.novos,
    });
  } catch (e) {
    const { motivo, mensagem } = explicarNuvemshop(motivoPeloErro(e));
    await logServerError({
      source: "server",
      path: "/api/nuvemshop/sync",
      message: `Nuvemshop: falha na sincronização (${motivo})`,
      detail: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
    });
    return NextResponse.json({ error: mensagem, motivo }, { status: 502 });
  }
}
