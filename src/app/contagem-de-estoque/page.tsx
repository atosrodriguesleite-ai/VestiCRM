import Link from "next/link";
import { db } from "@/lib/db";
import { porteiraEstoqueTela } from "@/lib/estoque/gate";
import { linhasDaContagem, type FiltroDoInventario } from "@/lib/estoque/inventario";
import { agruparParaContagem, ehListaDeProducao, faltaParaOMinimo, recorteDaFolha } from "@/lib/estoque/contagem";
import { NOME_DO_DONO } from "@/lib/estoque/dono-do-estoque";
import { BotaoImprimir } from "./botao-imprimir";

export const dynamic = "force-dynamic";

/**
 * FOLHA DE CONTAGEM DE ESTOQUE — página para imprimir em A4 (pedido do
 * dono, 28/09/2026). Fica FORA da área com menu (como a Declaração de
 * Conteúdo): o que sai no papel é só a folha. Mesma porteira do módulo
 * Estoque e o mesmo recorte do Inventário (categoria, busca, inativos),
 * vindo pelo endereço — o botão "Imprimir contagem" da aba monta o link.
 *
 * Duas escolhas de quem conta: **contagem às cegas** (`cega=1`, esconde o
 * número do sistema — quem conta sem ver o esperado não "acerta" para
 * bater) e **uma categoria por folha** (`quebra=1`, para dividir as araras
 * entre as pessoas).
 *
 * O CHIP do Inventário vem junto (`filtro=`): com "No mínimo" ou "Zeradas"
 * a folha vira LISTA DE PRODUÇÃO (pedido do dono, 08/10/2026) — disponível,
 * mínimo, quanto falta e uma coluna para anotar quanto produzir.
 */
const FILTROS: FiltroDoInventario[] = ["todos", "baixo", "zerado", "reservado", "externo"];
export default async function ContagemDeEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; q?: string; inativos?: string; cega?: string; quebra?: string; filtro?: string }>;
}) {
  const user = await porteiraEstoqueTela();
  const sp = await searchParams;
  const categoria = sp.categoria?.trim() || "";
  const q = sp.q?.trim() || "";
  const inativos = sp.inativos === "1";
  const quebra = sp.quebra === "1";
  const filtro = (FILTROS as string[]).includes(sp.filtro ?? "") ? (sp.filtro as FiltroDoInventario) : "todos";
  const producao = ehListaDeProducao(filtro);
  // a lista de produção precisa dos números; às cegas não faz sentido nela
  const cega = sp.cega === "1" && !producao;

  const [{ linhas, categorias }, company] = await Promise.all([
    linhasDaContagem(user.companyId, { q, categoria: categoria || undefined, incluirInativos: inativos, filtro }),
    db.company.findUnique({ where: { id: user.companyId }, select: { name: true } }),
  ]);
  const grupos = agruparParaContagem(linhas);
  const totalPecas = grupos.reduce((s, g) => s + g.total, 0);
  const totalVariacoes = linhas.length;
  const emitidaEm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());

  const th = "border border-gray-700 px-2 py-1 text-left text-[10px] font-bold uppercase";
  const td = "border border-gray-700 px-2 py-1 text-[11px]";
  const colunas = producao ? 7 : cega ? 5 : 7;
  const totalFalta = producao ? linhas.reduce((s, l) => s + faltaParaOMinimo(l), 0) : 0;

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-gray-900 print:p-0">
      <style>{`@page { size: A4; margin: 10mm; }`}</style>

      {/* controles — somem no papel */}
      <form method="get" className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <select name="categoria" defaultValue={categoria} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
            <option value="">Todas as categorias</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {q && <input type="hidden" name="q" value={q} />}
          {filtro !== "todos" && <input type="hidden" name="filtro" value={filtro} />}
          {!producao && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="cega" value="1" defaultChecked={cega} />
              contagem às cegas (sem o número do sistema)
            </label>
          )}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="quebra" value="1" defaultChecked={quebra} />
            uma categoria por folha
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="inativos" value="1" defaultChecked={inativos} />
            incluir produtos inativos
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded-xl border border-gray-300 bg-white px-4 py-2 font-medium hover:bg-gray-100">
            Atualizar a folha
          </button>
          <BotaoImprimir />
          <Link href="/estoque" className="text-gray-500 underline">
            Voltar ao Estoque
          </Link>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          {producao ? (
            <>
              Esta é a lista das peças que chegaram ao mínimo, para passar à produção. &quot;Falta&quot; é
              quanto a peça precisa para <b>voltar ao mínimo</b>; anote em &quot;Produzir&quot; quanto vai
              ser feito.
            </>
          ) : (
            <>Conte <b>todas</b> as peças que estão na loja, inclusive as já separadas para pedidos.</>
          )}
          {!cega && !producao && (
            <>
              {" "}
              &quot;Na loja&quot; é o que o sistema espera encontrar (disponível + reservado). Para
              acertar no Inventário, o número a digitar é o <b>disponível</b>: contado − reservado.
            </>
          )}
        </p>
      </form>

      <header className="mb-3 border-b-2 border-gray-900 pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-lg font-bold">
            {producao ? "Peças para produção" : "Contagem de estoque"}
            {company?.name ? ` — ${company.name}` : ""}
          </h1>
          <span className="text-[11px] text-gray-600">emitida em {emitidaEm}</span>
        </div>
        <p className="text-[11px] text-gray-600">
          {recorteDaFolha({ categoria, q, inativos, filtro })} · {totalVariacoes}{" "}
          {totalVariacoes === 1 ? "variação" : "variações"}
          {producao
            ? ` · faltam ${totalFalta} ${totalFalta === 1 ? "peça" : "peças"} para voltar ao mínimo`
            : !cega && ` · ${totalPecas} ${totalPecas === 1 ? "peça" : "peças"} no sistema`}
        </p>
        <p className="mt-2 text-[11px]">
          {producao ? (
            <>Pedido por: ______________________ &nbsp; Data: ___/___/______ &nbsp; Entregar até: ___/___/______</>
          ) : (
            <>
              Contado por: ______________________ &nbsp; Data: ___/___/______ &nbsp; Conferido por:
              ______________________
            </>
          )}
        </p>
      </header>

      {grupos.length === 0 && (
        <p className="py-10 text-center text-sm text-gray-500">Nenhuma peça neste recorte.</p>
      )}

      {grupos.map((g, i) => (
        <section
          key={g.categoria}
          className="mb-5"
          style={quebra && i > 0 ? { breakBefore: "page" } : undefined}
        >
          <table className="w-full border-collapse">
            {/* o nome da categoria mora no cabeçalho da tabela: não fica
                sozinho no pé da página e se repete no topo de cada folha */}
            <thead>
              <tr>
                <th colSpan={colunas} className="px-0 pb-1 pt-0 text-left">
                  <div className="flex items-baseline justify-between text-[13px] font-bold uppercase tracking-wide">
                    <span>{g.categoria}</span>
                    <span className="text-[10px] font-normal normal-case text-gray-600">
                      {g.variacoes} {g.variacoes === 1 ? "variação" : "variações"}
                      {!cega && !producao && ` · ${g.total} ${g.total === 1 ? "peça" : "peças"}`}
                    </span>
                  </div>
                </th>
              </tr>
              <tr>
                <th className={th}>Cor</th>
                <th className={`${th} w-14`}>Tam.</th>
                <th className={`${th} w-36`}>Código</th>
                {producao ? (
                  <>
                    <th className={`${th} w-16 text-right`}>Dispon.</th>
                    <th className={`${th} w-14 text-right`}>Mín.</th>
                    <th className={`${th} w-14 text-right`}>Falta</th>
                    <th className={`${th} w-24 text-center`}>Produzir</th>
                  </>
                ) : (
                  <>
                    {!cega && <th className={`${th} w-16 text-right`}>Na loja</th>}
                    {!cega && <th className={`${th} w-16 text-right`}>Reserv.</th>}
                    <th className={`${th} w-20 text-center`}>Contado</th>
                    <th className={`${th} w-20 text-center`}>Diferença</th>
                  </>
                )}
              </tr>
            </thead>
            {g.modelos.map((m) => (
              // o modelo não se parte entre duas páginas (quando cabe numa)
              <tbody key={m.productId} style={{ breakInside: "avoid" }}>
                <tr className="bg-gray-100 print:bg-gray-100">
                  <td className={`${td} font-bold`} colSpan={colunas}>
                    {m.produto}
                    {!cega && !producao && (
                      <span className="ml-2 font-normal text-gray-600">
                        · {m.total} {m.total === 1 ? "peça" : "peças"}
                      </span>
                    )}
                  </td>
                </tr>
                {m.linhas.map((l) => (
                  <tr key={l.variantId}>
                    <td className={td}>{l.cor || "—"}</td>
                    <td className={td}>{l.tamanho || "—"}</td>
                    <td className={`${td} font-mono text-[10px]`}>
                      {l.sku}
                      {/* peça de outro sistema: o acerto é feito LÁ (RN-050) */}
                      {l.dono && (
                        <span className="ml-1 font-sans text-[9px] text-gray-600">
                          ({NOME_DO_DONO[l.dono]})
                        </span>
                      )}
                    </td>
                    {producao ? (
                      <>
                        <td className={`${td} text-right tabular-nums`}>{l.disponivel}</td>
                        <td className={`${td} text-right tabular-nums text-gray-600`}>{l.minimo}</td>
                        <td className={`${td} text-right tabular-nums font-bold`}>{faltaParaOMinimo(l)}</td>
                        <td className={td}>&nbsp;</td>
                      </>
                    ) : (
                      <>
                        {!cega && <td className={`${td} text-right tabular-nums`}>{l.emEstoque}</td>}
                        {!cega && (
                          <td className={`${td} text-right tabular-nums text-gray-600`}>
                            {l.reservado > 0 ? l.reservado : ""}
                          </td>
                        )}
                        <td className={td}>&nbsp;</td>
                        <td className={td}>&nbsp;</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </section>
      ))}

      {linhas.some((l) => l.dono) && (
        <p className="mt-2 text-[10px] text-gray-600">
          Peças marcadas com (Nuvemshop) ou (Jueri) têm o estoque controlado pela integração: a
          diferença encontrada se acerta lá, e o número volta para cá na sincronização.
        </p>
      )}
    </div>
  );
}
