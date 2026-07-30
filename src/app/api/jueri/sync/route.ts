import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { syncJueriPage } from "@/lib/jueri-sync";

/**
 * Sincronização do catálogo Jueri — UMA PÁGINA por chamada (a tela chama
 * em sequência até acabar, com barra de progresso), para caber no tempo de
 * execução do servidor mesmo com catálogos grandes.
 *
 * simular=true: NADA é gravado — só o relatório do que aconteceria
 * (é o "relatório pré-conexão" que a cliente aprova antes de importar).
 *
 * A lógica em si mora em @/lib/jueri-sync (compartilhada com o cron 2x/dia).
 */

const schema = z.object({
  pagina: z.number().int().positive().max(500),
  simular: z.boolean(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Só admin sincroniza integrações." }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { pagina, simular } = parsed.data;

    const out = await syncJueriPage(user.companyId, pagina, simular);
    if (!out.ok) {
      return NextResponse.json({ error: out.error }, { status: out.status });
    }
    return NextResponse.json({
      pagina,
      temMais: out.temMais,
      resumo: out.resumo,
      exemplos: out.exemplos,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const msg = e instanceof Error ? e.message : "Falha na sincronização";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
