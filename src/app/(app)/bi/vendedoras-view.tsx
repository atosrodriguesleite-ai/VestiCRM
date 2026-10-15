import Link from "next/link";
import { Card, Avatar, EmptyState } from "@/components/ui";
import { brl } from "@/lib/format";
import { hrefDaLista } from "@/lib/bi/listas";
import type { Vendedoras } from "@/lib/bi/painel";

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const minutos = (v: number | null) => (v == null ? "—" : v === Infinity ? "> 4 h" : `≤ ${v} min`);

/**
 * A ABA VENDEDORAS (RN-083): uma linha por pessoa que teve algum número no
 * período, do maior vendido para o menor. Cada coluna diz de que fato vem;
 * o que não tem dona (eco do celular da loja, lead da loja, loja online,
 * fila) aparece na linha cinza "Sem vendedora" — nunca some.
 */
export function VendedorasView({ dados, dias }: { dados: Vendedoras; dias: number }) {
  const { pessoas, loja, semVendedora, diasSemVendedoras } = dados;
  // CLICAR E CAVAR (RN-086): a célula leva à lista daquela pessoa no período
  const lista = (tipo: "sem-resposta" | "contatos" | "vendas", vendedora?: string) =>
    hrefDaLista({ tipo, de: dados.periodo.de, ate: dados.periodo.ate, vendedora, aba: "vendedoras" });
  const cel = (href: string, texto: React.ReactNode, cls = "") => (
    <Link href={href} className={`underline decoration-dotted underline-offset-2 hover:text-brand-700 ${cls}`}>
      {texto}
    </Link>
  );
  // a linha da loja na tabela responde a MESMA pergunta das pessoas: das que
  // ALGUÉM respondeu, quantas no prazo (a aberta estourada fica em "sem
  // resposta"); o número do painel inclui a aberta, e é outra pergunta
  const lojaNoPrazoDasRespondidas = loja.respondidas ? Math.round((loja.noPrazo / loja.respondidas) * 100) : null;
  const temSemVendedora =
    semVendedora.respondidas + semVendedora.leads + semVendedora.pedidosPagos + semVendedora.semResposta > 0;
  const maiorVendido = Math.max(...pessoas.map((p) => p.vendido), 1);
  const temNumeroNaLoja = loja.leads + loja.respondidas + loja.semResposta + loja.pedidos + loja.pedidosPagos > 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        {dias} dias no período. A espera conta para quem RESPONDEU; a sem resposta, para quem assumiu a conversa;
        o contato novo, para a dona da carteira; a venda, para a vendedora do pedido (RN-005).
      </p>
      {diasSemVendedoras > 0 && (
        <p className="text-xs rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
          {diasSemVendedoras} dia(s) do período ainda sem os números por vendedora (foram contados antes desta aba
          existir): o total da loja já os tem, e eles entram nas pessoas aos poucos, a cada abertura.
        </p>
      )}

      {pessoas.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            title={temNumeroNaLoja ? "Nenhum número com vendedora no período" : "Nenhum número no período"}
            hint={
              temNumeroNaLoja
                ? "A loja teve movimento, mas nada com dona: respostas pelo celular da loja, leads da loja ou vendas da loja online."
                : "Quando a equipe atender e vender, cada pessoa aparece aqui."
            }
          />
        </Card>
      ) : (
        <>
          {/* RANKING — o cartão de cada pessoa */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pessoas.map((p, i) => (
              <Card key={p.userId} className="p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-400 w-5 tabular-nums">{i + 1}º</span>
                  <Avatar name={p.nome} color={p.cor} />
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {p.nome}
                      {!p.ativa && <span className="ml-1.5 text-[10px] text-gray-400 font-normal">(desativada)</span>}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {p.pedidosPagos} pedidos pagos · ticket {p.ticket == null ? "—" : brl(p.ticket)}
                    </p>
                  </div>
                </div>
                <p className="text-2xl font-semibold tabular-nums mt-3">{brl(p.vendido)}</p>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1.5">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max((p.vendido / maiorVendido) * 100, 2)}%` }} />
                </div>
                <dl className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <Numero rotulo="No prazo" valor={pct(p.pctNoPrazo)} tom={p.pctNoPrazo == null ? "neutro" : p.pctNoPrazo >= 80 ? "ok" : p.pctNoPrazo >= 50 ? "warn" : "bad"} />
                  <Numero rotulo="Sem resposta" valor={String(p.semResposta)} tom={p.semResposta > 0 ? "bad" : "neutro"} />
                  <Numero rotulo="Converteu" valor={pct(p.conversaoPct)} />
                </dl>
              </Card>
            ))}
          </div>

          {/* A TABELA — todos os números, lado a lado */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase bg-gray-50/70">
                    <th className="px-4 py-3">Vendedora</th>
                    <th className="px-3 py-3 text-right">Contatos novos</th>
                    <th className="px-3 py-3 text-right">Pagaram</th>
                    <th className="px-3 py-3 text-right">Respondeu</th>
                    <th className="px-3 py-3 text-right">No prazo</th>
                    <th className="px-3 py-3 text-right">Metade em</th>
                    <th className="px-3 py-3 text-right">Sem resposta</th>
                    <th className="px-3 py-3 text-right">Pedidos pagos</th>
                    <th className="px-3 py-3 text-right">Vendido</th>
                    <th className="px-3 py-3 text-right">Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {pessoas.map((p) => (
                    <tr key={p.userId} className="border-t border-gray-100">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={p.nome} color={p.cor} size="sm" />
                          <span className="font-medium">{p.nome}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{cel(lista("contatos", p.userId), p.leads)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {p.leadsPagaram}
                        <span className="text-gray-400 text-xs"> ({pct(p.conversaoPct)})</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.respondidas}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(p.pctNoPrazo)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{minutos(p.medianaAproxMin)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {p.semResposta > 0 ? cel(lista("sem-resposta", p.userId), p.semResposta, "text-rose-600 font-medium") : p.semResposta}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.pedidosPagos}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{cel(lista("vendas", p.userId), brl(p.vendido))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.ticket == null ? "—" : brl(p.ticket)}</td>
                    </tr>
                  ))}
                  {temSemVendedora && (
                    <tr className="border-t border-gray-100 text-gray-400">
                      <td className="px-4 py-2.5">
                        Sem vendedora
                        <span className="block text-[11px]">celular da loja · lead da loja · loja online · fila</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{semVendedora.leads}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">—</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{semVendedora.respondidas}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">—</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">—</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{semVendedora.semResposta}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{semVendedora.pedidosPagos}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{brl(semVendedora.vendido)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">—</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-gray-200 font-semibold bg-gray-50/50">
                    <td className="px-4 py-2.5">Loja</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{cel(lista("contatos"), loja.leads)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{loja.leadsPagaram}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{loja.respondidas}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(lojaNoPrazoDasRespondidas)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{minutos(loja.medianaAproxMin)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{cel(lista("sem-resposta"), loja.semResposta)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{loja.pedidosPagos}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{cel(lista("vendas"), brl(loja.vendido))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{loja.ticket == null ? "—" : brl(loja.ticket)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-[11px] text-gray-400">
            «No prazo» é das esperas que a pessoa RESPONDEU (a cliente ainda sem resposta está na coluna própria,
            para quem assumiu a conversa — por isso o número da loja aqui difere do painel, que conta a aberta
            estourada como fora do prazo). «Pagaram» é quantos dos contatos novos da carteira dela pagaram um pedido
            em até 7 dias (o funil por fatos). «Metade em» é o tempo em que metade das clientes que ela respondeu já
            tinha resposta, em minutos com a loja aberta. A linha «Loja» é o painel inteiro — a diferença para a soma
            das pessoas é o que não tem dona. Os números sublinhados abrem a lista de quem está por trás deles.
          </p>
        </>
      )}
    </div>
  );
}

function Numero({ rotulo, valor, tom = "neutro" }: { rotulo: string; valor: string; tom?: "neutro" | "ok" | "warn" | "bad" }) {
  const cor = tom === "ok" ? "text-emerald-600" : tom === "warn" ? "text-amber-600" : tom === "bad" ? "text-rose-600" : "text-slate-800";
  return (
    <div className="rounded-xl bg-gray-50 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">{rotulo}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${cor}`}>{valor}</dd>
    </div>
  );
}
