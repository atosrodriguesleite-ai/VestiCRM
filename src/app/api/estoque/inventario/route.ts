import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { varrerMinimosSeDevido } from "@/lib/estoque/alerta";
import { AuthError } from "@/lib/auth";
import { porteiraEstoque, podeAjustarEstoque } from "@/lib/estoque/gate";
import { podeOperarIntegracoes } from "@/lib/scope";
import { montarInventario, type FiltroDoInventario } from "@/lib/estoque/inventario";

export const dynamic = "force-dynamic";

const FILTROS: FiltroDoInventario[] = ["todos", "baixo", "zerado", "reservado", "externo"];

/** O Inventário da loja (RN-050): uma linha por variação, com o filtro pedido. */
export async function GET(req: NextRequest) {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    const sp = req.nextUrl.searchParams;
    const filtroPedido = sp.get("filtro") ?? "todos";
    const filtro = (FILTROS as string[]).includes(filtroPedido)
      ? (filtroPedido as FiltroDoInventario)
      : "todos";
    after(() => varrerMinimosSeDevido(porta.user.companyId));
    const inv = await montarInventario(porta.user.companyId, {
      q: sp.get("q") ?? "",
      categoria: sp.get("categoria") ?? "",
      filtro,
      incluirInativos: sp.get("inativos") === "1",
    });
    // a tela pede o resumo (loja inteira) só na primeira carga; a cada tecla
    // da busca vai só a lista — o resumo não muda com o filtro
    const soLista = sp.get("so") === "lista";
    return NextResponse.json({
      ...inv,
      ...(soLista ? { resumo: null, categorias: null } : {}),
      podeAjustar: podeAjustarEstoque(porta.user),
      // o botão "Sincronizar" chama a MESMA porta da tela Configurações
      podeSincronizar: podeOperarIntegracoes(porta.user),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
