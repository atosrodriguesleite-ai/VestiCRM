import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { brl } from "@/lib/format";
import { hrefDaLista } from "@/lib/bi/listas";
import { rotuloDoCanal, type Anuncios } from "@/lib/bi/anuncios";
import { GastosDeAnuncio } from "./gastos-de-anuncio";

const dinheiro = (v: number | null) => (v == null ? "—" : brl(v));
const vezes = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`);
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

/**
 * A ABA ANÚNCIOS (RN-085): gasto × contatos × vendas por campanha de
 * anúncio, no período da tela. Duas perguntas, ditas: a coorte (quem o
 * anúncio trouxe no período, e quantas já pagaram) e o caixa (o que entrou
 * no período das clientes da campanha).
 */
export function AnunciosView({ dados, dias }: { dados: Anuncios; dias: number }) {
  const { linhas, totais, meses } = dados;
  // CLICAR E CAVAR (RN-086): contatos e vendas da campanha no período
  const lista = (tipo: "contatos" | "vendas", campanha: string) =>
    hrefDaLista({ tipo, de: dados.periodo.de, ate: dados.periodo.ate, campanha, aba: "anuncios" });
  const cel = (href: string, texto: React.ReactNode) => (
    <Link href={href} className="underline decoration-dotted underline-offset-2 hover:text-brand-700">
      {texto}
    </Link>
  );
  const rotuloDosMeses = meses.length === 1 ? "o mês" : `os ${meses.length} meses`;
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        {dias} dias no período, tocando {rotuloDosMeses} do gasto. A atribuição é automática: a cliente que chega pelo
        link do anúncio entra na campanha dele (Marketing). {dados.semAnuncio > 0 && (
          <>
            <b>{dados.semAnuncio}</b> contato{dados.semAnuncio === 1 ? "" : "s"} novo{dados.semAnuncio === 1 ? "" : "s"} do período
            chegaram sem anúncio identificado.
          </>
        )}
      </p>

      {/* a chave pelos meses: trocar o período REMONTA o editor com o gasto daquele período
          (o estado preso ao primeiro período fazia o salvar apagar o mês do outro — achado da revisão) */}
      <GastosDeAnuncio key={meses.join(",")} meses={meses} campanhas={dados.campanhas} gastos={dados.gastos} />

      {linhas.length === 0 ? (
        <Card className="p-5">
          <EmptyState title="Nenhum anúncio com número no período" hint="Quando houver gasto informado, contato atribuído ou venda de cliente de campanha, cada campanha aparece aqui." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-xs text-gray-400">Gasto no período</p>
              <p className="text-2xl font-semibold tabular-nums mt-1">{brl(totais.gasto)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-gray-400">Custo por contato novo</p>
              <p className="text-2xl font-semibold tabular-nums mt-1">{dinheiro(totais.cac)}</p>
              <p className="text-[11px] text-gray-400 mt-1">{totais.leads} contatos pelos anúncios</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-gray-400">Custo por venda</p>
              <p className="text-2xl font-semibold tabular-nums mt-1">{dinheiro(totais.custoPorVenda)}</p>
              <p className="text-[11px] text-gray-400 mt-1">{totais.pagaram} dos contatos já pagaram ({pct(totais.conversaoPct)})</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-gray-400">Retorno</p>
              <p className={`text-2xl font-semibold tabular-nums mt-1 ${totais.retorno == null ? "" : totais.retorno >= 1 ? "text-emerald-600" : "text-rose-600"}`}>{vezes(totais.retorno)}</p>
              <p className="text-[11px] text-gray-400 mt-1">{brl(totais.vendido)} vendido no período</p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase bg-gray-50/70">
                    <th className="px-4 py-3">Campanha</th>
                    <th className="px-3 py-3 text-right">Gasto</th>
                    <th className="px-3 py-3 text-right">Contatos novos</th>
                    <th className="px-3 py-3 text-right">Custo por contato</th>
                    <th className="px-3 py-3 text-right">Pagaram</th>
                    <th className="px-3 py-3 text-right">Custo por venda</th>
                    <th className="px-3 py-3 text-right">Vendido</th>
                    <th className="px-3 py-3 text-right">Retorno</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{l.nome}</span>
                        <span className="block text-[11px] text-gray-400">
                          {rotuloDoCanal(l.canal)}
                          {!l.ativa && " · parada"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{l.gasto ? brl(l.gasto) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{cel(lista("contatos", l.id), l.leads)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{dinheiro(l.cac)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {l.pagaram}
                        <span className="text-gray-400 text-xs"> ({pct(l.conversaoPct)})</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{dinheiro(l.custoPorVenda)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{cel(lista("vendas", l.id), brl(l.vendido))}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${l.retorno == null ? "text-gray-400" : l.retorno >= 1 ? "text-emerald-600" : "text-rose-600"}`}>{vezes(l.retorno)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 font-semibold bg-gray-50/50">
                    <td className="px-4 py-2.5">Todos os anúncios</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{brl(totais.gasto)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{totais.leads}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{dinheiro(totais.cac)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{totais.pagaram}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{dinheiro(totais.custoPorVenda)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{brl(totais.vendido)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{vezes(totais.retorno)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-[11px] text-gray-400">
            «Gasto» soma os meses inteiros que o período toca (a loja não gasta igual todo dia — ratear seria precisão
            de mentira). «Contatos novos» e «Pagaram» são a coorte: quem o anúncio trouxe no período e quantas dessas já
            pagaram um pedido, em qualquer data. «Vendido» é o caixa: o que entrou no período de qualquer cliente da
            campanha, pela data do pagamento e sem o frete — o anúncio antigo que ainda traz recompra aparece aqui.
            «Retorno» = vendido ÷ gasto. O «retorno por R$ 1» da tela Marketing é outra conta: toda a vida da campanha ÷
            o investimento total digitado lá.
          </p>
        </>
      )}
    </div>
  );
}
