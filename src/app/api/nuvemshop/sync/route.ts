import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import {
  syncAbandonedCheckouts,
  syncPaginaDeProdutos,
  syncProducts,
} from "@/lib/nuvemshop";
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
const corpo = z.object({
  page: z.number().int().min(1).max(10_000).optional(),
  carrinhos: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
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
    // MODO EM ETAPAS (tela nova): cada chamada processa UMA página de
    // produtos OU os carrinhos abandonados — nunca os dois juntos, e nunca
    // perto do limite de tempo. Etapa lenta fica registrada no Saúde.
    // Molde em vez de `as`: `page` sem teto virava página absurda mandada
    // para a API da Nuvemshop, e o `as` não confere nada em tempo de execução.
    const lido = corpo.safeParse(await req.json().catch(() => ({})));
    if (!lido.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const body = lido.data;
    const t0 = Date.now();
    const telemetria = async (rotulo: string) => {
      const ms = Date.now() - t0;
      if (ms > 30_000) {
        await logServerError({
          source: "server",
          path: "/api/nuvemshop/sync",
          message: `Nuvemshop: etapa lenta (${rotulo} em ${Math.round(ms / 1000)}s)`,
          detail: `empresa ${user.companyId}`,
        });
      }
      return ms;
    };

    // etapa dos carrinhos abandonados (a tela chama DEPOIS dos produtos):
    // importar carrinho cria cliente/conversa — é pesado e já derrubou a
    // rodada quando corria junto com os produtos na mesma requisição
    if (body?.carrinhos === true) {
      const carrinhos = await syncAbandonedCheckouts(user.companyId);
      const ms = await telemetria("carrinhos");
      return NextResponse.json({ ok: true, carrinhosNovos: carrinhos.novos, ms });
    }

    const page = Number(body?.page);
    if (Number.isInteger(page) && page >= 1) {
      const etapa = await syncPaginaDeProdutos(user.companyId, page);
      if (!etapa.ok) {
        const { motivo, mensagem } =
          etapa.status === -1
            ? explicarNuvemshop("SEM_CONEXAO")
            : explicarNuvemshop(motivoPeloStatus(etapa.status));
        await logServerError({
          source: "server",
          path: "/api/nuvemshop/sync",
          message: `Nuvemshop: sincronização recusada (${motivo})`,
          detail: `HTTP ${etapa.status} · página ${page} · empresa ${user.companyId}`,
        });
        return NextResponse.json({ error: mensagem, motivo }, { status: 502 });
      }
      const ms = await telemetria(`produtos página ${page}`);
      return NextResponse.json({
        ok: true,
        produtos: etapa.produtos,
        fim: etapa.fim,
        proximaPagina: etapa.proximaPagina ?? page + 1,
        ms,
      });
    }

    // modo antigo (uma chamada só) — segue para quem chama sem página
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
