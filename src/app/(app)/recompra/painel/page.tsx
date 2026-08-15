import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Repeat,
  Crown,
  Bot,
  AlarmClock,
  Wallet,
  Users,
  ShoppingCart,
  ArrowLeft,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { brl } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { StatTile, BarList } from "@/components/charts";
import { FAIXAS } from "@/lib/recompra";
import { painelDeRecompra } from "@/lib/recompra-painel";

export const dynamic = "force-dynamic";

/**
 * PAINEL DE RECOMPRA — visão de dono. Todos os números derivam das MESMAS
 * funções das outras telas (aba Recompra, tela Recuperação, régua do
 * Dashboard): se aparece aqui e lá, é o mesmo número.
 */
export default async function PainelDeRecompraPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/recompra");
  const p = await painelDeRecompra(user);

  const nivelCor = {
    ALERTA: "border-rose-200 bg-rose-50 text-rose-800",
    ATENCAO: "border-amber-200 bg-amber-50 text-amber-800",
    BOA: "border-emerald-200 bg-emerald-50 text-emerald-800",
  } as const;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Painel de Recompra"
        subtitle="O controle da segunda venda em diante — mesmos números da aba Recompra, da Recuperação e do Dashboard."
        action={
          <Link
            href="/recompra"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:border-brand-300 transition"
          >
            <ArrowLeft className="size-3.5" /> Ir para a esteira
          </Link>
        }
      />

      {/* MONITOR IA — lê os números do painel e escreve a conclusão.
          Determinístico: cada frase é rastreável até a conta que a gerou. */}
      <Card className="p-4 mb-6 border-brand-100 bg-brand-50/40">
        <p className="flex items-center gap-1.5 mb-2 text-xs font-bold uppercase tracking-wide text-brand-700">
          <Bot className="size-4" /> Monitor IA de recompra
        </p>
        <ul className="space-y-1.5">
          {p.insights.map((i, ix) => (
            <li
              key={ix}
              className={`rounded-lg border px-3 py-2 text-sm leading-snug ${nivelCor[i.nivel]}`}
            >
              {i.emoji} {i.texto}
            </li>
          ))}
        </ul>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatTile
          label="Passaram do ponto"
          value={String(p.passouDoPonto)}
          hint={`${brl(p.valorEmRisco)} de compra média em jogo`}
          icon={<AlarmClock />}
          tone={p.passouDoPonto > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Taxa de recompra"
          value={`${Math.round(p.taxaRecompra)}%`}
          hint={`${p.recorrentes} de ${p.compradoras} clientes voltaram`}
          icon={<Repeat />}
        />
        <StatTile
          label="Receita de recompra (mês)"
          value={brl(p.mesRecompra)}
          hint={
            p.mesFaturamento > 0
              ? `${Math.round((p.mesRecompra / p.mesFaturamento) * 100)}% do faturamento do mês`
              : "sem vendas no mês ainda"
          }
          icon={<Wallet />}
          tone="good"
        />
        <StatTile
          label="Ciclo médio da loja"
          value={p.cicloMedioDaLoja ? `${p.cicloMedioDaLoja} dias` : "—"}
          hint="intervalo típico entre reposições"
          icon={<Users />}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
        {/* estágios — mesmos números dos chips da aba Recompra */}
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Clientes por estágio</h2>
          <p className="text-[11px] text-gray-400 mb-3">
            Os mesmos filtros da aba Recompra — toque para trabalhar a lista.
          </p>
          <BarList
            data={FAIXAS.map((f) => ({
              label: f.rotulo,
              value: p.porFaixa[f.id],
            }))}
            formatValue={(v) => `${v}`}
          />
          <Link
            href="/recompra"
            className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            Abrir a esteira →
          </Link>
        </Card>

        {/* mês: recompra vs primeira compra */}
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Faturamento do mês</h2>
          <p className="text-[11px] text-gray-400 mb-3">
            Recompra = pedido pago de quem JÁ tinha comprado antes.
          </p>
          <BarList
            color="#059669"
            data={[
              { label: "Recompra", value: p.mesRecompra },
              { label: "1ª compra", value: p.mesPrimeiraCompra },
            ]}
            formatValue={brl}
          />
          <p className="mt-3 text-[11px] text-gray-400">
            Mês anterior (recompra): {brl(p.mesAnteriorRecompra)}
          </p>
        </Card>

        {/* recuperação — mesmo placar da tela Recuperação */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-1">
            <ShoppingCart className="size-4 text-brand-600" />
            Carrinhos recuperados (mês)
          </h2>
          <p className="text-[11px] text-gray-400 mb-3">
            O mesmo placar da tela Recuperação.
          </p>
          <p className="text-2xl font-semibold text-emerald-700 tabular-nums">
            {brl(p.recuperadoMes)}
          </p>
          <p className="text-xs text-gray-400">
            {p.recuperadoVendas} venda{p.recuperadoVendas === 1 ? "" : "s"} fechada
            {p.recuperadoVendas === 1 ? "" : "s"} depois do abandono
          </p>
          <Link
            href="/recuperacao"
            className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            Abrir a Recuperação →
          </Link>
        </Card>

        {/* VIPs — o mesmo Top 20 da aba (e a régua do Dashboard) */}
        <Card className="p-5 lg:col-span-3">
          <h2 className="font-semibold flex items-center gap-2 mb-1">
            <Crown className="size-4 text-amber-500" />
            VIPs — concentração do faturamento
          </h2>
          <p className="text-[11px] text-gray-400 mb-3">
            O mesmo Top {p.vips.length} da aba Recompra (valor comprado, sem
            frete — a régua do Dashboard). Juntas, respondem por{" "}
            {Math.round(p.concentracaoVip)}% de tudo que a loja já vendeu.
          </p>
          {p.vips.length === 0 ? (
            <EmptyState title="Ainda sem compradoras" />
          ) : (
            <BarList
              color="#d97706"
              data={p.vips.slice(0, 10).map((c) => ({
                label: `${c.vip}º ${c.name}`,
                value: c.total,
                sub: `${c.compras} compra${c.compras === 1 ? "" : "s"} · última há ${c.diasDesde} dia${c.diasDesde === 1 ? "" : "s"}`,
              }))}
              formatValue={brl}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
