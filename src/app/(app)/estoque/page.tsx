import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { porteiraEstoqueTela, podeVerAnaliseDoEstoque } from "@/lib/estoque/gate";
import { Abas, type AbaDoEstoque } from "./abas";
import { InventarioView } from "./inventario-view";
import { PainelView } from "./painel-view";
import { MinimosView } from "./minimos-view";
import { ProducaoView } from "./producao-view";
import type { FiltroDoInventario } from "@/lib/estoque/inventario";

export const dynamic = "force-dynamic";

const ABAS: AbaDoEstoque[] = ["inventario", "painel", "minimos", "producao"];
const FILTROS: FiltroDoInventario[] = ["todos", "baixo", "zerado", "reservado", "externo"];

/**
 * Tela ESTOQUE (RN-050/051/052): Inventário (contar e acertar), Painel (o
 * que repor, o que encalhou, o que mais vende), Mínimos (por peça, categoria
 * e loja) e, na confecção, Produção (cortado esperando costura e tecido para
 * cortar). A trava do módulo está no layout; a aba Produção só existe com o
 * módulo Produção ligado.
 */
export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; filtro?: string }>;
}) {
  const user = await porteiraEstoqueTela();
  const [{ aba: abaPedida, filtro: filtroPedido }, company] = await Promise.all([
    searchParams,
    db.company.findUnique({ where: { id: user.companyId }, select: { productionEnabled: true } }),
  ]);
  // Painel e Produção mostram dinheiro (custo, atacado, tecido): só gerência
  const veAnalise = podeVerAnaliseDoEstoque(user);
  const temProducao = (company?.productionEnabled ?? false) && veAnalise;
  let aba: AbaDoEstoque = (ABAS as string[]).includes(abaPedida ?? "")
    ? (abaPedida as AbaDoEstoque)
    : "inventario";
  if (aba === "producao" && !temProducao) aba = "inventario";
  if (aba === "painel" && !veAnalise) aba = "inventario";
  const filtro: FiltroDoInventario = (FILTROS as string[]).includes(filtroPedido ?? "")
    ? (filtroPedido as FiltroDoInventario)
    : "todos";

  const subtitulo: Record<AbaDoEstoque, string> = {
    inventario:
      "Cada cor e tamanho com o que está na loja, o que já está reservado em pedido e o que sobra para vender. Ajuste na própria linha — sempre com motivo.",
    painel: "O que repor, o que encalhou e o que mais vende — contas claras, pela venda paga dos últimos 30 dias.",
    minimos: "Quantas peças você quer ter, no mínimo, de cada modelo, categoria ou da loja inteira. Chegou lá, a gerência é avisada.",
    producao: "O que está cortado esperando costura, o que está na facção e quanto tecido ainda dá para cortar.",
  };

  return (
    <div>
      <PageHeader title="Estoque" subtitle={subtitulo[aba]} />
      <Abas ativa={aba} temProducao={temProducao} veAnalise={veAnalise} />
      <div className="mt-4">
        {/* key: o sino troca só a URL com a aba já aberta; sem remontar, o filtro novo era ignorado */}
        {aba === "inventario" && <InventarioView key={filtro} filtroInicial={filtro} />}
        {aba === "painel" && <PainelView />}
        {aba === "minimos" && <MinimosView />}
        {aba === "producao" && <ProducaoView />}
      </div>
    </div>
  );
}
