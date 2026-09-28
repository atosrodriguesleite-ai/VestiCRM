import Link from "next/link";
import { db } from "@/lib/db";
import { porteiraEstoqueTela } from "@/lib/estoque/gate";
import { linhasDaContagem } from "@/lib/estoque/inventario";
import { agruparParaContagem, recorteDaFolha } from "@/lib/estoque/contagem";
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
 */
export default async function ContagemDeEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; q?: string; inativos?: string; cega?: string; quebra?: string }>;
}) {
  const user = await porteiraEstoqueTela();
  const sp = await searchParams;
  const categoria = sp.categoria?.trim() || "";
  const q = sp.q?.trim() || "";
  const inativos = sp.inativos === "1";
  const cega = sp.cega === "1";
  const quebra = sp.quebra === "1";

  const [{ linhas, categorias }, company] = await Promise.all([
    linhasDaContagem(user.companyId, { q, categoria: categoria || undefined, incluirInativos: inativos }),
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
  const colunas = cega ? 5 : 7;

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
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="cega" value="1" defaultChecked={cega} />
            contagem às cegas (sem o número do sistema)
          </label>
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
          Conte <b>todas</b> as peças que estão na loja, inclusive as já separadas para pedidos.
          {!cega && (
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
          <h1 className="text-lg font-bold">Contagem de estoque{company?.name ? ` — ${company.name}` : ""}</h1>
          <span className="text-[11px] text-gray-600">emitida em {emitidaEm}</span>
        </div>
        <p className="text-[11px] text-gray-600">
          {recorteDaFolha({ categoria, q, inativos })} · {totalVariacoes}{" "}
          {totalVariacoes === 1 ? "variação" : "variações"}
          {!cega && ` · ${totalPecas} ${totalPecas === 1 ? "peça" : "peças"} no sistema`}
        </p>
        <p className="mt-2 text-[11px]">
          Contado por: ______________________ &nbsp; Data: ___/___/______ &nbsp; Conferido por:
          ______________________
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
                      {!cega && ` · ${g.total} ${g.total === 1 ? "peça" : "peças"}`}
                    </span>
                  </div>
                </th>
              </tr>
              <tr>
                <th className={th}>Cor</th>
                <th className={`${th} w-14`}>Tam.</th>
                <th className={`${th} w-36`}>Código</th>
                {!cega && <th className={`${th} w-16 text-right`}>Na loja</th>}
                {!cega && <th className={`${th} w-16 text-right`}>Reserv.</th>}
                <th className={`${th} w-20 text-center`}>Contado</th>
                <th className={`${th} w-20 text-center`}>Diferença</th>
              </tr>
            </thead>
            {g.modelos.map((m) => (
              // o modelo não se parte entre duas páginas (quando cabe numa)
              <tbody key={m.productId} style={{ breakInside: "avoid" }}>
                <tr className="bg-gray-100 print:bg-gray-100">
                  <td className={`${td} font-bold`} colSpan={colunas}>
                    {m.produto}
                    {!cega && (
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
                    {!cega && <td className={`${td} text-right tabular-nums`}>{l.emEstoque}</td>}
                    {!cega && (
                      <td className={`${td} text-right tabular-nums text-gray-600`}>
                        {l.reservado > 0 ? l.reservado : ""}
                      </td>
                    )}
                    <td className={td}>&nbsp;</td>
                    <td className={td}>&nbsp;</td>
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
