import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { isManagerUp, isSupport } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { composicoesPorCategoria, listarModelos } from "@/lib/etiquetas/modelos";
import { parseCategoryOrder, sortCategories } from "@/lib/categories";
import { ordenarVariantes } from "@/lib/tamanhos";
import { Abas, type AbaDeEtiquetas } from "./abas";
import { ModelosView } from "./modelos-view";
import { ImprimirView } from "./imprimir-view";
import { SeparacaoView } from "./separacao-view";
import { filaDeSeparacao, type PedidoNaFila } from "@/lib/etiquetas/separacao";

export const dynamic = "force-dynamic";

/** Datas viram texto ISO para atravessar a fronteira servidor → navegador. */
function paraTela(linhas: PedidoNaFila[]) {
  return linhas.map((l) => ({
    ...l,
    pagoEm: l.pagoEm?.toISOString() ?? null,
    separadoEm: l.separadoEm?.toISOString() ?? null,
    emAndamento: l.emAndamento ? { quem: l.emAndamento.quem, desde: l.emAndamento.desde.toISOString() } : null,
  }));
}

/**
 * Área ETIQUETAS (RN-059): Modelos (criar, editar, definir o padrão de cada
 * tipo, composição por categoria) e Imprimir (por peça ou por pedido, no
 * modelo escolhido) e Separação (RN-060: a fila de pedidos pagos e o bipe
 * com o leitor). A trava do módulo está no layout; toda a equipe entra,
 * gerência e suporte editam modelos.
 */
export default async function EtiquetasPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  // a chave do módulo já foi conferida no layout desta área
  const user = await requireUser();
  const { aba: abaPedida } = await searchParams;
  const aba: AbaDeEtiquetas = abaPedida === "imprimir" ? "imprimir" : abaPedida === "separacao" ? "separacao" : "modelos";
  const podeEditar = isManagerUp(user) || isSupport(user);

  const [company, modelos, composicoes, catRows, produtos, fila] = await Promise.all([
    db.company.findUnique({ where: { id: user.companyId }, select: { extraCategories: true, categoryOrder: true } }),
    listarModelos(user.companyId),
    composicoesPorCategoria(user.companyId),
    db.product.findMany({ where: { companyId: user.companyId }, select: { category: true }, distinct: ["category"] }),
    aba === "imprimir"
      ? db.product.findMany({
          where: { companyId: user.companyId, active: true },
          select: {
            id: true,
            name: true,
            sku: true,
            category: true,
            variants: { select: { id: true, color: true, size: true, stock: true } },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    aba === "separacao" ? filaDeSeparacao(user) : Promise.resolve(null),
  ]);
  const categorias = sortCategories(
    [...new Set([...catRows.map((r) => r.category), ...parseCategoryOrder(company?.extraCategories ?? null)])],
    parseCategoryOrder(company?.categoryOrder ?? null)
  );

  return (
    <div>
      <PageHeader
        title="Etiquetas"
        subtitle="Modelos de etiqueta da loja, impressão em lote e o código de barras que o leitor bipa."
      />
      <Abas ativa={aba} />
      {aba === "modelos" ? (
        <ModelosView
          modelos={modelos.map((m) => ({ ...m, updatedAt: m.updatedAt.toISOString() }))}
          composicoes={composicoes}
          categorias={categorias}
          podeEditar={podeEditar}
        />
      ) : aba === "separacao" && fila ? (
        <SeparacaoView aSeparar={paraTela(fila.aSeparar)} separados={paraTela(fila.separados)} cortada={fila.cortada} />
      ) : (
        <ImprimirView
          modelos={modelos.map((m) => ({ id: m.id, nome: m.nome, tipo: m.tipo, padrao: m.padrao }))}
          produtos={produtos.map((p) => ({ ...p, variants: ordenarVariantes(p.variants) }))}
        />
      )}
    </div>
  );
}
