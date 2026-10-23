import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui";
import { brl } from "@/lib/format";
import type { Rfm } from "@/lib/bi/rfm";
import { GRUPOS_RFM, grupoDaCelula, grupoRfm, POUCAS_CLIENTES } from "@/lib/bi/rfm-regra";
import { hrefDaLista } from "@/lib/bi/listas";
import { degrauDoCalor } from "@/lib/bi/paleta";

/** as notas de recência de cima para baixo (5 = comprou há menos tempo) e de frequência + valor da esquerda para a direita */
const LINHAS = [5, 4, 3, 2, 1];
const COLUNAS = [1, 2, 3, 4, 5];

/**
 * O RFM NA ABA CLIENTES (RN-092): os oito grupos — quantas, quanto valem,
 * de quanto da receita vêm, o LTV médio e o que fazer — e a matriz clássica
 * recência × (frequência + valor). Cada número abre a lista de quem é, com o
 * botão de chamar no WhatsApp e a mensagem do grupo pronta.
 *
 * A cor faz UM trabalho (RN-089): no mapa de calor, quantas clientes há na
 * célula (um matiz, quatro degraus validados nos dois temas, com a tinta do
 * número escolhida por degrau). O grupo da célula é dito por EMOJI e nome,
 * nunca por cor — e todo número está escrito, então ninguém depende da cor.
 */
export function RfmView({ rfm, periodo }: { rfm: Rfm; periodo: { de: string; ate: string } }) {
  const { resumo, matriz } = rfm;
  // o período vai junto só para o "voltar" da lista devolver à mesma tela (o RFM não o usa)
  const volta = { aba: "clientes" as const, de: periodo.de, ate: periodo.ate };
  const maior = Math.max(...matriz.flat(), 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">RFM · os grupos da carteira</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Cada cliente ganha uma nota de 1 a 5 em <strong>R</strong>ecência (há quanto tempo comprou),{" "}
          <strong>F</strong>requência (quantas compras) e <strong>V</strong>alor (quanto gastou), comparando com as
          clientes da própria loja — as 20% melhores levam 5. Frequência e valor contam os <strong>últimos 12 meses</strong>; quem não
          compra há mais de 12 meses é Perdida. É a fotografia de HOJE: não segue o período escolhido acima.
          {resumo.ltvMedio != null && <> LTV médio da loja: <strong>{brl(resumo.ltvMedio)}</strong> por cliente.</>}
        </p>
        {resumo.poucas && (
          <p className="text-xs text-amber-700 mt-1.5">
            Só {resumo.ativas} cliente{resumo.ativas === 1 ? "" : "s"} compraram nos 12 meses: com menos de {POUCAS_CLIENTES}, as notas
            mudam muito a cada venda — leia os grupos como uma pista, não como régua.
          </p>
        )}
      </div>

      {/* OS OITO GRUPOS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {GRUPOS_RFM.map((g) => {
          const r = resumo.porGrupo[g.id];
          const vazio = r.clientes === 0;
          return (
            <Card key={g.id} className={`p-4 flex flex-col min-w-0 ${vazio ? "opacity-60" : ""}`}>
              <p className="text-sm font-semibold">
                <span aria-hidden className="mr-1.5">{g.emoji}</span>
                {g.rotulo}
              </p>
              <p className="text-[11px] text-gray-400 leading-snug mt-0.5">{g.quem}</p>
              <div className="flex items-baseline gap-2 mt-2">
                {vazio ? (
                  <span className="text-2xl font-semibold tabular-nums text-gray-300">0</span>
                ) : (
                  <Link
                    href={hrefDaLista({ tipo: "rfm", grupo: g.id, ...volta })}
                    className="text-2xl font-semibold tabular-nums underline decoration-dotted underline-offset-4 hover:text-brand-700"
                    title={`Ver as ${r.clientes} clientes e chamar`}
                  >
                    {r.clientes}
                  </Link>
                )}
                <span className="text-xs text-gray-400">{r.pctClientes}% das clientes</span>
              </div>
              <p className="text-xs text-gray-600 mt-1.5 tabular-nums">
                {brl(r.valor12)} em 12 meses
                {r.pctReceita != null && <span className="text-gray-400"> · {r.pctReceita}% da receita</span>}
              </p>
              {r.pctReceita != null && (
                <div className="h-1 rounded-full bg-slate-100 overflow-hidden mt-1" aria-hidden>
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${r.pctReceita}%` }} />
                </div>
              )}
              <p className="text-xs text-gray-600 mt-1.5 tabular-nums">
                LTV médio {r.ltvMedio == null ? "—" : brl(r.ltvMedio)}
              </p>
              <p className="text-[11px] text-gray-500 mt-2 pt-2 border-t border-gray-100 flex-1">
                <span className="font-medium text-gray-600">Ação:</span> {g.acao}
              </p>
              {!vazio && (
                <Link
                  href={hrefDaLista({ tipo: "rfm", grupo: g.id, ...volta })}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  Ver e chamar <ArrowRight className="size-3.5" />
                </Link>
              )}
            </Card>
          );
        })}
      </div>

      {/* A MATRIZ */}
      <Card className="p-5 min-w-0">
        <h2 className="font-semibold mb-1">Matriz recência × frequência e valor</h2>
        <p className="text-xs text-gray-400 mb-3">
          Linha: nota de recência (5 = comprou há menos tempo). Coluna: a média das notas de frequência e valor (5 = vale
          mais). Em cada quadrado, quantas clientes há ali — quanto mais forte a cor, mais gente — e o grupo dele. Toque no
          número para ver quem. Só entra quem comprou nos 12 meses ({resumo.ativas}).
        </p>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1 mx-auto" aria-label="Quantas clientes em cada combinação de notas">
            <thead>
              <tr>
                <th className="text-[10px] font-semibold text-gray-400 uppercase pr-1 text-right align-bottom whitespace-nowrap">R \ FV</th>
                {COLUNAS.map((fv) => (
                  <th key={fv} scope="col" className="text-[11px] font-semibold text-gray-500 tabular-nums pb-0.5">
                    {fv}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LINHAS.map((r) => (
                <tr key={r}>
                  <th scope="row" className="text-[11px] font-semibold text-gray-500 tabular-nums pr-1 text-right">
                    {r}
                  </th>
                  {COLUNAS.map((fv) => {
                    const n = matriz[r - 1][fv - 1];
                    const g = grupoRfm(grupoDaCelula(r, fv));
                    const degrau = degrauDoCalor(n, maior);
                    const dica = `R${r} × FV${fv}: ${n} cliente${n === 1 ? "" : "s"} · ${g.rotulo}`;
                    return (
                      <td key={fv} className="p-0">
                        {n === 0 ? (
                          <div
                            className="size-12 sm:size-16 rounded-lg border border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-300"
                            title={dica}
                          >
                            <span className="text-sm">—</span>
                            <span aria-hidden className="text-[11px] opacity-60">{g.emoji}</span>
                          </div>
                        ) : (
                          <Link
                            href={hrefDaLista({ tipo: "rfm", r, fv, ...volta })}
                            className={`rfm-calor-${degrau} size-12 sm:size-16 rounded-lg flex flex-col items-center justify-center transition hover:ring-2 hover:ring-brand-400 focus-visible:ring-2 focus-visible:ring-brand-400 outline-none`}
                            title={dica}
                            aria-label={dica}
                          >
                            <span className="text-base font-semibold tabular-nums leading-none">{n}</span>
                            <span aria-hidden className="text-[11px] mt-1">{g.emoji}</span>
                          </Link>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            menos
            {[1, 2, 3, 4].map((d) => (
              <span key={d} className={`rfm-calor-${d} inline-block size-3 rounded-sm`} aria-hidden />
            ))}
            mais clientes
          </span>
          {GRUPOS_RFM.filter((g) => g.id !== "NOVATAS").map((g) => (
            <span key={g.id}>
              <span aria-hidden>{g.emoji}</span> {g.rotulo}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">
          🌱 As Novatas (primeira compra da vida, recente) moram nos quadrados de cima, junto com as Promissoras e as
          Campeãs — o card delas mostra quantas são.
        </p>
      </Card>
    </div>
  );
}
