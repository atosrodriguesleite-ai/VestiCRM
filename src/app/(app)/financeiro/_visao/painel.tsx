import Link from "next/link";
import { brl } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { StatTile } from "@/components/charts";
import {
  carregarInadimplencia,
  conferirContaPadrao,
  emAbertoNoPeriodo,
  preverSaldo,
} from "@/lib/financeiro/visao";
import { saldosPorConta } from "@/lib/financeiro/extrato";
import { dataDoDia, diaSP } from "@/lib/financeiro/lancamentos";
import { formatarDia } from "@/lib/financeiro/dia";
import { AvisoContaPadrao } from "./aviso-conta-padrao";

/**
 * VISÃO GERAL do Financeiro (RN-035) — o painel que responde as três
 * perguntas do dono em dez segundos: quanto eu tenho, quanto entra e sai
 * até o fim do mês, e o que está atrasado.
 */
export async function PainelFinanceiro({
  companyId,
  dias,
}: {
  companyId: string;
  dias: number;
}) {
  const hoje = new Date();
  const hojeDia = diaSP(hoje);
  const [ano, mes] = hojeDia.split("-").map(Number);
  const fimDoMes = dataDoDia(
    `${hojeDia.slice(0, 7)}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}`
  )!;

  const inicioDoMes = dataDoDia(`${hojeDia.slice(0, 7)}-01`)!;
  const diaDeHoje = dataDoDia(hojeDia)!;

  // OS CARDS DO MÊS SÃO SOMADOS NO BANCO. Trazer as parcelas para a memória
  // exigia um teto, e teto sem ordem definida faz o Postgres devolver um
  // subconjunto ARBITRÁRIO: "a receber no mês" mudava de valor entre dois F5
  // (auditoria completa do módulo, 03/09/2026).
  const [previsao, inad, contas, avisoConta, aReceberMes, aPagarMes, venceHoje] =
    await Promise.all([
      preverSaldo(companyId, dias, hoje),
      carregarInadimplencia(companyId, hoje),
      saldosPorConta(companyId, diaDeHoje),
      conferirContaPadrao(companyId),
      emAbertoNoPeriodo(companyId, "RECEITA", inicioDoMes, fimDoMes),
      emAbertoNoPeriodo(companyId, "DESPESA", inicioDoMes, fimDoMes),
      // a dica do card de RECEBER: o que vence hoje e ainda não entrou
      emAbertoNoPeriodo(companyId, "RECEITA", diaDeHoje, diaDeHoje),
    ]);

  // saldo de cada conta, para a lojista bater com o app do banco. A conta
  // ARQUIVADA só aparece se ainda tiver dinheiro — some da lista quando
  // zera, mas nunca some do total: as linhas têm que fechar com o card.
  const saldos = contas.filter((c) => !c.arquivada || c.saldo !== 0);
  // UM CAMINHO SÓ para o "saldo hoje": ele já vem somado por conta aqui, e
  // `previsao.saldoHoje` é o MESMO número por outro caminho (mais 5
  // agregações). Duas fontes para um número só é como o card e a frase logo
  // abaixo passariam a discordar sem ninguém perceber.
  const saldoHoje = Math.round(contas.reduce((s, c) => s + c.saldo, 0) * 100) / 100;

  // termômetro: o que entra cobre o que sai até a data prevista?
  const cobertura =
    previsao.aPagar > 0
      ? Math.min(200, Math.round(((previsao.saldoHoje + previsao.aReceber) / previsao.aPagar) * 100))
      : 100;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Financeiro"
        subtitle="Quanto a loja tem, quanto entra e sai, e o que precisa de atenção hoje."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/financeiro/cadastros"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cadastros
            </Link>
            <Link
              href="/financeiro/dre"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Deu lucro?
            </Link>
            <Link
              href="/financeiro/dfc"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Por onde o dinheiro andou
            </Link>
          </div>
        }
      />

      <AvisoContaPadrao aviso={avisoConta} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Saldo hoje"
          value={brl(saldoHoje)}
          hint="somando todas as contas"
          tone={saldoHoje < 0 ? "bad" : "good"}
        />
        <StatTile
          label="A receber no mês"
          value={brl(aReceberMes)}
          hint={venceHoje > 0 ? `${brl(venceHoje)} vence hoje` : "nada vence hoje"}
        />
        <StatTile label="A pagar no mês" value={brl(aPagarMes)} />
        <StatTile
          label="Atrasado"
          value={brl(inad.total)}
          hint={`${inad.clientes}${inad.truncado ? "+" : ""} cliente(s)`}
          tone={inad.total > 0 ? "bad" : "good"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">
              Se tudo entrar e sair como está previsto
            </h2>
            <div className="flex gap-1 text-xs">
              {[7, 15, 30].map((d) => (
                <Link
                  key={d}
                  href={`/financeiro?dias=${d}`}
                  className={`rounded-lg px-2.5 py-1 font-medium ${
                    d === dias
                      ? "bg-brand-600 text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {d} dias
                </Link>
              ))}
            </div>
          </div>

          <p className="text-sm text-slate-500">
            No dia <b className="text-slate-700">{formatarDia(previsao.ate)}</b> a
            loja deve ter
          </p>
          <p
            className={`text-3xl font-semibold tabular-nums ${
              previsao.saldoPrevisto < 0 ? "text-rose-700" : "text-emerald-700"
            }`}
          >
            {brl(previsao.saldoPrevisto)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {brl(previsao.saldoHoje)} de hoje + {brl(previsao.aReceber)} a receber −{" "}
            {brl(previsao.aPagar)} a pagar
          </p>

          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>O que entra cobre o que sai?</span>
              <span className="font-semibold text-slate-700">{cobertura}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${
                  cobertura >= 100
                    ? "bg-emerald-500"
                    : cobertura >= 70
                      ? "bg-amber-500"
                      : "bg-rose-500"
                }`}
                style={{ width: `${Math.max(3, Math.min(100, cobertura))}%` }}
              />
            </div>
            {previsao.saldoPrevisto < 0 && (
              <p className="mt-2 text-xs text-rose-700">
                Atenção: com o previsto de hoje, o caixa fica negativo antes de{" "}
                {formatarDia(previsao.ate)}.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Saldo por conta
          </h2>
          {saldos.length === 0 && (
            <p className="text-sm text-slate-500">
              Nenhuma conta cadastrada.{" "}
              <Link href="/financeiro/cadastros" className="text-brand-700 hover:underline">
                Cadastrar
              </Link>
            </p>
          )}
          <ul className="space-y-2.5">
            {saldos.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.cor }}
                />
                <span className="flex-1 truncate text-slate-700">
                  {c.nome}
                  {c.arquivada && (
                    <span className="ml-1.5 text-[11px] text-slate-400">arquivada</span>
                  )}
                </span>
                <span
                  className={`tabular-nums font-medium ${
                    c.saldo < 0 ? "text-rose-700" : "text-slate-800"
                  }`}
                >
                  {brl(c.saldo)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/financeiro/extrato"
            className="mt-4 block text-xs font-medium text-brand-700 hover:underline"
          >
            Ver o extrato →
          </Link>
        </Card>
      </div>

      {inad.linhas.length > 0 && (
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">
              Precisa de atenção — contas atrasadas
            </h2>
            <Link
              href="/financeiro/inadimplencia"
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Ver todas e cobrar →
            </Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {inad.linhas.slice(0, 5).map((l) => (
              <li key={l.parcelaId} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                  {l.diasAtraso}d
                </span>
                <span className="font-medium text-slate-800">{l.clienteNome}</span>
                <span className="truncate text-slate-500">{l.descricao}</span>
                <span className="ml-auto tabular-nums font-semibold">{brl(l.falta)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/financeiro/contas-a-receber", nome: "Contas a Receber", cor: "emerald" },
          { href: "/financeiro/contas-a-pagar", nome: "Contas a Pagar", cor: "rose" },
          { href: "/financeiro/extrato", nome: "Extrato", cor: "sky" },
          { href: "/financeiro/contas-fixas", nome: "Contas fixas", cor: "violet" },
          { href: "/financeiro/fluxo-de-caixa", nome: "Fluxo de caixa", cor: "sky" },
          { href: "/financeiro/conciliacao", nome: "Conferir com o banco", cor: "amber" },
          { href: "/financeiro/cartoes", nome: "Cartões", cor: "slate" },
        ].map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {a.nome} →
          </Link>
        ))}
      </div>
    </div>
  );
}
