import { NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { atualizarRastreiosSeDevido } from "@/lib/rastreio";
import { AGUARDANDO_POSTAGEM } from "@/lib/envios/painel";
import { lerNaEstrada } from "@/lib/envios/na-estrada";
import { inicioDoDiaSP } from "@/lib/periodo";
import { diaSP } from "@/lib/dia";
import { placarDaTv } from "@/lib/envios/tv-regra";

export const dynamic = "force-dynamic";

/**
 * MODO TV DOS ENVIOS (RN-104): a porta LEVE que a tela cheia pede a cada
 * minuto — só o que a TV mostra (a camada "na estrada" e o placar do dia),
 * nunca a lista de 300 linhas nem os dois mapas históricos da tela Envios.
 *
 * Mesmas réguas das outras portas: módulo contratado, recorte de quem vê
 * (RN-007: a vendedora vê a TV dos pedidos dela), a situação de cada pacote
 * pela RN-102 e a carona na varredura de rastreio (RN-103 avisa de lá).
 */
export async function GET() {
  try {
    const user = await requireUser();
    const company = await db.company.findUnique({
      where: { id: user.companyId },
      select: { shippingEnabled: true, name: true },
    });
    if (!company?.shippingEnabled)
      return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });

    after(() => atualizarRastreiosSeDevido());

    const agora = new Date();
    // a 0h de São Paulo de hoje (`diaSP` nunca devolve dia torto; o `?? agora` é só pelo tipo)
    const hoje0h = inicioDoDiaSP(diaSP(agora)) ?? agora;
    const escopo = { meOrderId: { not: null }, order: orderScope(user) };

    const [naEstrada, postadosHoje, entreguesHoje, aguardandoPostagem] = await Promise.all([
      lerNaEstrada(escopo, user.companyId, agora),
      db.shipping.count({ where: { ...escopo, shippedAt: { gte: hoje0h } } }),
      db.shipping.count({ where: { ...escopo, deliveredAt: { gte: hoje0h } } }),
      db.shipping.count({ where: { ...escopo, meStatus: { in: [...AGUARDANDO_POSTAGEM] } } }),
    ]);

    const { estrada, pacotes } = naEstrada;
    // o placar conta TODOS os pacotes lidos — o sem UF está na estrada,
    // mesmo fora do mapa
    const placar = placarDaTv(pacotes, { postadosHoje, entreguesHoje, aguardandoPostagem });
    return NextResponse.json({ loja: company.name, agora: agora.toISOString(), estrada, placar });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
