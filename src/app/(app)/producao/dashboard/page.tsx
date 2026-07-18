import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const fmtKg = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
const fmtR$ = (n: number) =>
  `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/**
 * Dashboard da Produção — os números que provam que o motor aprende:
 * produção, eficiência (previsto × real, erro médio caindo), sobras (R$
 * parado + economia do reaproveitamento) e custos por peça/tecido.
 */
export default async function ProducaoDashboard() {
  const user = await requireUser();

  const [cortes, sobras] = await Promise.all([
    db.cutTicket.findMany({
      where: { companyId: user.companyId },
      include: { roll: { include: { fabric: true } } },
      orderBy: { code: "asc" },
    }),
    db.fabricScrap.findMany({ where: { companyId: user.companyId } }),
  ]);

  const fechados = cortes.filter((c) => c.status === "FECHADO");
  const kgCortados = cortes.reduce((a, c) => a + c.usedKg, 0);
  const pecas = fechados.reduce((a, c) => a + (c.piecesTotal ?? 0), 0);

  const sobrasDisp = sobras.filter((s) => s.status === "DISPONIVEL" || s.status === "RESERVADA");
  const kgSobras = sobrasDisp.reduce((a, s) => a + s.weightKg, 0);
  const valorSobras = sobrasDisp.reduce((a, s) => a + s.value, 0);
  const reaproveitadas = sobras.filter((s) => s.status === "CONSUMIDA");
  const economia = reaproveitadas.reduce((a, s) => a + s.value, 0);
  const perdas = sobras.filter((s) => s.status === "PERDA" || s.status === "DESCARTADA");
  const kgPerdas = perdas.reduce((a, s) => a + s.weightKg, 0);

  // precisão do motor: só cortes que tiveram projeção
  const comProjecao = fechados.filter((c) => c.predictedTotal != null && c.errorPieces != null);
  const erroMedio =
    comProjecao.length > 0
      ? comProjecao.reduce((a, c) => a + Math.abs(c.errorPieces!), 0) / comProjecao.length
      : null;
  const acertoPct =
    comProjecao.length > 0
      ? (comProjecao.reduce((a, c) => {
          const prev = c.predictedTotal!;
          return a + (prev > 0 ? Math.max(0, 1 - Math.abs(c.errorPieces!) / prev) : 0);
        }, 0) /
          comProjecao.length) *
        100
      : null;

  // aproveitamento médio (método da balança): kg que viraram peça ÷ kg cortados
  const comPesagem = fechados.filter((c) => c.piecesWeightKg != null && c.usedKg > 0);
  const kgPesados = comPesagem.reduce((a, c) => a + c.usedKg, 0);
  const aproveitamentoMedio =
    kgPesados > 0
      ? (comPesagem.reduce((a, c) => a + (c.piecesWeightKg ?? 0), 0) / kgPesados) * 100
      : null;

  // custo médio por peça (cortes fechados com custo)
  const comCusto = fechados.filter((c) => c.costPerPiece != null && (c.piecesTotal ?? 0) > 0);
  const custoMedio =
    comCusto.length > 0
      ? comCusto.reduce((a, c) => a + c.costPerPiece! * c.piecesTotal!, 0) /
        comCusto.reduce((a, c) => a + c.piecesTotal!, 0)
      : null;

  // rendimento por tecido (peças/kg medidas)
  const porTecido = new Map<string, { kg: number; pecas: number; custo: number; custoPecas: number }>();
  for (const c of fechados) {
    const nome = c.roll?.fabric.name ?? "—";
    const t = porTecido.get(nome) ?? { kg: 0, pecas: 0, custo: 0, custoPecas: 0 };
    t.kg += c.usedKg;
    t.pecas += c.piecesTotal ?? 0;
    if (c.costPerPiece != null && c.piecesTotal) {
      t.custo += c.costPerPiece * c.piecesTotal;
      t.custoPecas += c.piecesTotal;
    }
    porTecido.set(nome, t);
  }
  const tecidos = [...porTecido.entries()].sort((a, b) => b[1].pecas - a[1].pecas);
  const maxRend = Math.max(...tecidos.map(([, t]) => (t.kg > 0 ? t.pecas / t.kg : 0)), 0.001);

  // linha do tempo: últimos 12 fechados, previsto × real
  const timeline = fechados.slice(-12);

  return (
    <div>
      <PageHeader
        title="Dashboard da Produção"
        subtitle="Cada corte fechado alimenta o motor — acompanhe a precisão subindo."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat titulo="Quilos cortados" valor={fmtKg(kgCortados)} sub={`${cortes.length} corte(s)`} />
        <Stat titulo="Peças produzidas" valor={String(pecas)} sub={`${fechados.length} corte(s) fechados`} />
        <Stat
          titulo="Sobras disponíveis"
          valor={fmtKg(kgSobras)}
          sub={`${fmtR$(valorSobras)} parados`}
          tom="amber"
        />
        <Stat
          titulo="Economia por reaproveitamento"
          valor={fmtR$(economia)}
          sub={`${reaproveitadas.length} sobra(s) consumida(s)`}
          tom="emerald"
        />
        <Stat
          titulo="Aproveitamento médio"
          valor={aproveitamentoMedio != null ? `${aproveitamentoMedio.toFixed(1)}%` : "—"}
          sub={
            aproveitamentoMedio != null
              ? "kg que viraram peça (método da balança)"
              : "pese as peças por modelo pra apurar"
          }
          tom="emerald"
        />
        <Stat
          titulo="Custo médio por peça"
          valor={custoMedio != null ? fmtR$(custoMedio) : "—"}
          sub={custoMedio != null ? "tecido + custos extras" : "feche cortes com custos"}
        />
        <Stat
          titulo="Precisão do motor"
          valor={acertoPct != null ? `${acertoPct.toFixed(1)}%` : "—"}
          sub={
            comProjecao.length > 0
              ? `${comProjecao.length} projeção(ões) conferidas`
              : "ainda sem projeções fechadas"
          }
          tom="sky"
        />
        <Stat
          titulo="Erro médio"
          valor={erroMedio != null ? `${erroMedio.toFixed(1)} peça(s)` : "—"}
          sub="quanto menor, mais o motor aprendeu"
          tom="sky"
        />
        <Stat
          titulo="Descartes e perdas"
          valor={fmtKg(kgPerdas)}
          sub={`${perdas.length} registro(s) · aparas + perdas definitivas`}
          tom="rose"
        />
      </div>

      {tecidos.length > 0 && (
        <Card className="p-5 mb-6">
          <h2 className="font-semibold text-sm mb-3">Rendimento por tecido (peças por kg)</h2>
          <div className="space-y-2.5">
            {tecidos.map(([nome, t]) => {
              const rend = t.kg > 0 ? t.pecas / t.kg : 0;
              return (
                <div key={nome}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700 truncate">{nome}</span>
                    <span className="text-gray-500">
                      {rend.toFixed(2).replace(".", ",")} peças/kg · {t.pecas} peças em {fmtKg(t.kg)}
                      {t.custoPecas > 0 && ` · ${fmtR$(t.custo / t.custoPecas)}/peça`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.max(4, (rend / maxRend) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {timeline.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold text-sm mb-3">Linha do tempo — previsto × real</h2>
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="py-1.5 pr-3">Corte</th>
                  <th className="py-1.5 pr-3">Tecido</th>
                  <th className="py-1.5 pr-3">Peso</th>
                  <th className="py-1.5 pr-3">Previsto</th>
                  <th className="py-1.5 pr-3">Real</th>
                  <th className="py-1.5">Erro</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((c) => (
                  <tr key={c.id} className="border-t border-gray-50">
                    <td className="py-2 pr-3 font-mono text-xs">#{String(c.code).padStart(6, "0")}</td>
                    <td className="py-2 pr-3 text-gray-600 truncate max-w-[160px]">
                      {c.roll?.fabric.name ?? "—"} · {c.roll?.color ?? ""}
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{fmtKg(c.usedKg)}</td>
                    <td className="py-2 pr-3">
                      {c.predictedTotal != null ? Math.round(c.predictedTotal) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{c.piecesTotal ?? "—"}</td>
                    <td className="py-2">
                      {c.errorPieces != null ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            Math.abs(c.errorPieces) <= 2
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {c.errorPieces > 0 ? "+" : ""}
                          {Math.round(c.errorPieces)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({
  titulo,
  valor,
  sub,
  tom = "brand",
}: {
  titulo: string;
  valor: string;
  sub?: string;
  tom?: "brand" | "amber" | "emerald" | "sky" | "rose";
}) {
  const cor = {
    brand: "text-brand-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
    sky: "text-sky-700",
    rose: "text-rose-600",
  }[tom];
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{titulo}</p>
      <p className={`text-xl font-bold mt-0.5 ${cor}`}>{valor}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </Card>
  );
}
