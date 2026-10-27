import Link from "next/link";
import { TrendingDown, TrendingUp, Sparkles } from "lucide-react";
import { Card } from "@/components/ui";
import { GRUPOS_RFM } from "@/lib/bi/rfm-regra";
import { nomeDoMes, rotuloDaOrigem, type RetratoDoMes } from "@/lib/bi/rfm-movimento-regra";
import { hrefDaLista, type FiltroDaLista } from "@/lib/bi/listas";

/** quantos caminhos o cartão mostra (os outros estão nas listas por movimento) */
const CAMINHOS_NA_TELA = 8;

/**
 * O RETRATO DO MÊS (RN-101): quem caiu, quem subiu e quem chegou no RFM, do
 * dia 1º ao fim do mês (ou a hoje). Os caminhos mais comuns aparecem com o
 * "de → para", e cada número abre a lista de quem é, com o Chamar. A cor faz
 * um trabalho só (RN-089): o sentido — queda em âmbar, subida em verde — e a
 * seta e a palavra dizem a mesma coisa, então ninguém depende da cor.
 */
export function RetratoView({
  retrato,
  meses,
  periodo,
}: {
  retrato: RetratoDoMes;
  meses: string[];
  periodo: { de: string; ate: string };
}) {
  const volta = { aba: "clientes" as const, de: periodo.de, ate: periodo.ate, mes: retrato.mes };
  const lista = (extra: Partial<FiltroDaLista>) => hrefDaLista({ tipo: "rfm-mov", ...volta, ...extra });
  const linkDoMes = (m: string) => `/bi?aba=clientes&de=${periodo.de}&ate=${periodo.ate}&mesRfm=${m}#retrato`;
  const caminhos = retrato.caminhos.slice(0, CAMINHOS_NA_TELA);
  const { contagem } = retrato;
  const mudaram = contagem.caiu + contagem.subiu + contagem.chegou;

  return (
    <div id="retrato" className="scroll-mt-4 min-w-0">
    <Card className="p-5 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-semibold">O mês no RFM · {nomeDoMes(retrato.mes)}</h2>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Escolher o mês">
          {meses.map((m) => (
            <Link
              key={m}
              href={linkDoMes(m)}
              scroll={false}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium transition ${
                m === retrato.mes ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
              aria-current={m === retrato.mes ? "true" : undefined}
            >
              {nomeDoMes(m).replace(/ de \d{4}$/, "").slice(0, 3)}
            </Link>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Quem mudou de grupo do dia 1º {retrato.emCurso ? "até hoje (o mês ainda corre)" : "ao fim do mês"}. Recalculado pelos
        pedidos pagos, com a mesma conta dos grupos acima — venda cancelada depois sai também daqui. Como as notas são da
        própria loja, uma cliente pode cair só porque as outras compraram mais.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Numero
          icone={<TrendingDown className="size-4" />}
          rotulo="caíram"
          n={contagem.caiu}
          href={lista({ mov: "caiu" })}
          classe="text-amber-700"
        />
        <Numero
          icone={<TrendingUp className="size-4" />}
          rotulo="subiram"
          n={contagem.subiu}
          href={lista({ mov: "subiu" })}
          classe="text-emerald-700"
        />
        <Numero
          icone={<Sparkles className="size-4" />}
          rotulo="primeira compra"
          n={contagem.chegou}
          href={lista({ mov: "chegou" })}
          classe="text-brand-700"
        />
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        {contagem.ficou} ficaram no mesmo grupo
        {retrato.semVendaAgora > 0 && (
          <> · {retrato.semVendaAgora} não têm mais compra paga hoje (venda cancelada ou devolvida, ou contato unificado)</>
        )}.
      </p>

      {mudaram > 0 && (
        <>
          <h3 className="text-sm font-semibold mt-5 mb-2">Os caminhos mais comuns</h3>
          <ul className="divide-y divide-gray-100">
            {caminhos.map((c) => (
              <li key={`${c.antes}>${c.depois}`}>
                <Link
                  href={lista({ mov: c.movimento, antes: c.antes, depois: c.depois })}
                  className="flex items-center gap-2 py-2 text-sm hover:bg-gray-50 rounded-lg px-1"
                >
                  <span
                    aria-hidden
                    className={c.movimento === "caiu" ? "text-amber-700" : c.movimento === "subiu" ? "text-emerald-700" : "text-brand-700"}
                  >
                    {c.movimento === "caiu" ? "▼" : c.movimento === "subiu" ? "▲" : "●"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {rotuloDaOrigem(c.antes)} → {rotuloDaOrigem(c.depois)}
                    <span className="sr-only"> ({c.movimento === "caiu" ? "caíram" : c.movimento === "subiu" ? "subiram" : "primeira compra"})</span>
                  </span>
                  <span className="tabular-nums font-semibold shrink-0">{c.clientes}</span>
                </Link>
              </li>
            ))}
          </ul>
          {retrato.caminhos.length > CAMINHOS_NA_TELA && (
            <p className="text-[11px] text-gray-400 mt-1">
              e mais {retrato.caminhos.length - CAMINHOS_NA_TELA} caminhos — toque em “caíram” ou “subiram” para ver todas.
            </p>
          )}
        </>
      )}

      <h3 className="text-sm font-semibold mt-5 mb-2">Cada grupo, do dia 1º {retrato.emCurso ? "a hoje" : "ao fim do mês"}</h3>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase">
              <th className="text-left font-semibold px-1 pb-1">Grupo</th>
              <th className="text-right font-semibold px-1 pb-1">Dia 1º</th>
              <th className="text-right font-semibold px-1 pb-1">{retrato.emCurso ? "Hoje" : "Fim"}</th>
              <th className="text-right font-semibold px-1 pb-1">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {GRUPOS_RFM.map((g) => {
              const r = retrato.porGrupo[g.id];
              const saldo = r.fim - r.comeco;
              return (
                <tr key={g.id} className="border-t border-gray-100">
                  <td className="px-1 py-1.5 whitespace-nowrap">
                    <span aria-hidden className="mr-1">{g.emoji}</span>
                    {g.rotulo}
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-gray-500">{r.comeco}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums font-medium">{r.fim}</td>
                  <td className="px-1 py-1.5 text-right tabular-nums text-gray-600">
                    {saldo === 0 ? "—" : saldo > 0 ? `+${saldo}` : `−${-saldo}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
    </div>
  );
}

function Numero({ icone, rotulo, n, href, classe }: { icone: React.ReactNode; rotulo: string; n: number; href: string; classe: string }) {
  const corpo = (
    <>
      <span className={`flex items-center gap-1 ${classe}`}>
        {icone}
        <span className="text-xl sm:text-2xl font-semibold tabular-nums">{n}</span>
      </span>
      <span className="text-[11px] text-gray-500 leading-tight">{rotulo}</span>
    </>
  );
  return n === 0 ? (
    <div className="rounded-xl bg-gray-50 px-2.5 py-2.5 flex flex-col gap-0.5 opacity-70">{corpo}</div>
  ) : (
    <Link href={href} className="rounded-xl bg-gray-50 hover:bg-gray-100 px-2.5 py-2.5 flex flex-col gap-0.5 transition" title={`Ver quem ${rotulo}`}>
      {corpo}
    </Link>
  );
}
