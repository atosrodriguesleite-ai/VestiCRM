import Link from "next/link";
import { Clock, Inbox, MessageSquareWarning, Repeat, ShoppingBag, Users, Wallet } from "lucide-react";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { StatCard } from "@/components/dash";
import { AreaChart, BarList, FunnelBars } from "@/components/charts";
import { PeriodChips } from "@/components/period-chips";
import { db } from "@/lib/db";
import { brl, originLabel } from "@/lib/format";
import { dataDoDia, diaSP } from "@/lib/dia";
import { porteiraBiTela } from "@/lib/bi/gate";
import { atualizarFatosDoBiSeDevido, BALDES_MIN, ultimosDias } from "@/lib/bi/fatos";
import { diasDoPeriodo, montarPainel, montarVendedoras, variacao } from "@/lib/bi/painel";
import { MetasCard } from "./metas-card";
import { Abas, lerAba } from "./abas";
import { VendedorasView } from "./vendedoras-view";
import { CarteiraView } from "./carteira-view";
import { montarCarteira } from "@/lib/bi/carteira";
import type { Origin } from "@prisma/client";

export const dynamic = "force-dynamic";

const ROTULO_DO_BALDE = ["até 5 min", "até 15 min", "até 30 min", "até 1 h", "até 2 h", "até 4 h", "mais de 4 h"];

/**
 * BI DE VENDAS — o painel do dono (RN-082, ADR-019). Lê fatos diários
 * prontos; o período é o da URL (os mesmos atalhos do Dashboard). Só
 * gerência, só com a chave do módulo (porteira). Antes de ler, dá a carona
 * da rodada de fatos — assim quem abre o painel vê o dia de hoje fresco.
 */
export default async function BiPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; aba?: string }>;
}) {
  const user = await porteiraBiTela();
  const { de, ate, aba: abaPedida } = await searchParams;
  const aba = lerAba(abaPedida);
  const agora = new Date();
  const hoje = diaSP(agora);
  // dia que existe no calendário (a régua de lib/dia: "2026-02-30" é recusado, não vira 2 de março)
  const ehDia = (d?: string): d is string => !!d && dataDoDia(d) !== null;
  const periodo = {
    de: ehDia(de) ? de : ultimosDias(hoje, 30)[0],
    ate: ehDia(ate) ? ate : hoje,
  };
  if (periodo.de > periodo.ate) periodo.de = periodo.ate;

  // os dias VIVOS antes de ler (trava de 30 min: barata quando já rodou);
  // o histórico entra de carona no sync da inbox, nunca segurando a tela
  await atualizarFatosDoBiSeDevido(user.companyId, { soVivos: true });
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { intakeSlaMinutes: true, horarioComercial: true },
  });
  const semHorario = !company?.horarioComercial;
  const cabecalho = (
    <>
      <PageHeader
        title="BI de Vendas"
        subtitle="Leads, resposta no prazo, funil por fatos, vendas e metas — os números do processo comercial, prontos para a reunião."
      />
      <Abas ativa={aba} de={ehDia(de) ? de : undefined} ate={ehDia(ate) ? ate : undefined} />
      <PeriodChips pathname="/bi" de={de} ate={ate} extra={aba === "painel" ? undefined : { aba }} />
      {semHorario && (
        <p className="mt-3 text-xs rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
          Sem horário de atendimento cadastrado: o tempo de resposta está contando o dia inteiro, madrugada
          inclusa.{" "}
          <Link href="/configuracoes" className="underline font-medium">
            Cadastre em Configurações
          </Link>
          .
        </p>
      )}
    </>
  );

  if (aba === "vendedoras") {
    const dados = await montarVendedoras(user.companyId, periodo);
    const nDias = diasDoPeriodo(dados.periodo).length;
    return (
      <div className="max-w-6xl mx-auto">
        {cabecalho}
        <div className="mt-4">
          <VendedorasView dados={dados} dias={nDias} />
        </div>
      </div>
    );
  }

  if (aba === "clientes") {
    const dados = await montarCarteira(user, periodo);
    return (
      <div className="max-w-6xl mx-auto">
        {cabecalho}
        <div className="mt-4">
          <CarteiraView dados={dados} dias={diasDoPeriodo(dados.periodo).length} />
        </div>
      </div>
    );
  }

  const painel = await montarPainel(user.companyId, periodo, agora);
  const { atual, passado, hoje: h, funil, serie } = painel;
  const dias = serie.length;
  const rotuloDoMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(agora);
  const totalRespondidas = atual.hist.reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-6xl mx-auto">
      {cabecalho}

      {/* HOJE — a faixa viva */}
      <Card className="mt-4 p-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <p className="text-xs uppercase tracking-wide text-slate-300 mb-3">Hoje · {hoje.split("-").reverse().join("/")}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Vivo rotulo="Novos contatos" valor={String(h.leads)} icone={<Users className="size-4" />} />
          <Vivo
            rotulo="Esperando resposta agora"
            valor={String(h.esperandoAgora)}
            icone={<MessageSquareWarning className="size-4" />}
            tom={h.esperandoAgora > 0 ? "warn" : "ok"}
          />
          <Vivo rotulo="Pedidos pagos" valor={String(h.pedidosPagos)} icone={<ShoppingBag className="size-4" />} />
          <Vivo rotulo="Vendido" valor={brl(h.vendido)} icone={<Wallet className="size-4" />} />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          Prazo de resposta da loja: {company?.intakeSlaMinutes ?? 60} min com a loja aberta. Quem está esperando
          aparece na aba Fila da Central.
          {painel.atualizadoEm && (
            <> Fatos atualizados {new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(painel.atualizadoEm)}.</>
          )}
        </p>
      </Card>

      {/* OS SEIS NÚMEROS DO PERÍODO */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        <StatCard
          label="Novos contatos"
          value={atual.leads}
          delta={variacao(atual.leads, passado.leads)}
          hint={`${dias} dias · ${Object.keys(atual.origens).length} origens`}
          icon={<Users className="size-4" />}
          series={serie.map((s) => s.leads)}
        />
        <StatCard
          label="Respondidos no prazo"
          value={atual.pctNoPrazo}
          format="pct"
          tone={atual.pctNoPrazo == null ? "default" : atual.pctNoPrazo >= 80 ? "good" : atual.pctNoPrazo >= 50 ? "warn" : "bad"}
          delta={atual.pctNoPrazo != null && passado.pctNoPrazo != null ? atual.pctNoPrazo - passado.pctNoPrazo : null}
          deltaHint="pontos vs. período anterior"
          hint={
            atual.esperas
              ? `${atual.respondidas} respondidas · ${atual.semResposta} sem resposta · metade em até ${
                  atual.medianaAproxMin == null ? "—" : atual.medianaAproxMin === Infinity ? "mais de 4 h" : `${atual.medianaAproxMin} min`
                }`
              : "nenhuma espera no período"
          }
          info="Esperas da cliente que começaram no período e foram respondidas por uma pessoa da loja dentro do prazo, em minutos com a loja aberta. Mensagem automática não conta."
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Sem resposta"
          value={atual.semResposta}
          tone={atual.semResposta > 0 ? "bad" : "good"}
          hint="clientes que escreveram e ninguém da loja respondeu"
          icon={<Inbox className="size-4" />}
        />
        <StatCard
          label="Vendido no período"
          value={atual.vendido}
          format="brl"
          delta={variacao(atual.vendido, passado.vendido)}
          hint={`${atual.pedidosPagos} pedidos pagos`}
          icon={<Wallet className="size-4" />}
          series={serie.map((s) => s.vendido)}
        />
        <StatCard
          label="Ticket médio"
          value={atual.ticket}
          format="brl"
          delta={atual.ticket != null && passado.ticket != null ? variacao(atual.ticket, passado.ticket) : null}
          hint="valor vendido ÷ pedidos pagos"
          icon={<ShoppingBag className="size-4" />}
        />
        <StatCard
          label="Taxa de recompra"
          value={painel.recompraPct}
          format="pct"
          hint="clientes com 2+ compras pagas, entre quem já comprou (histórico)"
          icon={<Repeat className="size-4" />}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <MetasCard mes={painel.mes} rotuloDoMes={rotuloDoMes} metas={painel.metas} realizado={painel.realizado} />

        <Card className="p-5">
          <h2 className="font-semibold mb-1">Funil por fatos</h2>
          <p className="text-xs text-gray-400 mb-4">
            Dos contatos novos do período: quantos receberam resposta de uma pessoa, quantos fizeram pedido e quantos
            pagaram, contados até 7 dias depois do cadastro. Nada aqui depende de etapa arrastada à mão.
          </p>
          {funil.leads === 0 ? (
            <EmptyState title="Nenhum contato novo no período" />
          ) : (
            <FunnelBars
              data={[
                { label: "Contatos novos", value: funil.leads },
                { label: "Respondidos por uma pessoa", value: funil.respondidos },
                { label: "Fizeram pedido", value: funil.comPedido },
                { label: "Pagaram", value: funil.pagaram },
              ]}
            />
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Novos contatos por dia</h2>
          <p className="text-xs text-gray-400 mb-3">{dias} dias no período.</p>
          <AreaChart points={serie.map((s) => s.leads)} labels={serie.map((s) => s.dia.slice(8, 10) + "/" + s.dia.slice(5, 7))} />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Vendido por dia</h2>
          <p className="text-xs text-gray-400 mb-3">Pela data do pagamento, valor vendido sem o frete.</p>
          <AreaChart
            points={serie.map((s) => s.vendido)}
            labels={serie.map((s) => s.dia.slice(8, 10) + "/" + s.dia.slice(5, 7))}
            formatValue={(v) => brl(v)}
          />
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Quanto a cliente esperou</h2>
          <p className="text-xs text-gray-400 mb-3">
            Distribuição das {totalRespondidas} respostas do período, em minutos com a loja aberta.
          </p>
          {totalRespondidas === 0 ? (
            <EmptyState title="Sem respostas no período" />
          ) : (
            <BarList
              data={atual.hist.map((n, i) => ({ label: ROTULO_DO_BALDE[i] ?? `> ${BALDES_MIN[BALDES_MIN.length - 1]} min`, value: n }))}
              color="#0f766e"
              formatValue={(v) => `${v} (${Math.round((v / totalRespondidas) * 100)}%)`}
            />
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-1">De onde vieram</h2>
          <p className="text-xs text-gray-400 mb-3">Origem dos contatos novos do período. Qual anúncio só aparece para quem chegou por link rastreado.</p>
          {atual.leads === 0 ? (
            <EmptyState title="Nenhum contato novo" />
          ) : (
            <BarList
              data={Object.entries(atual.origens)
                .map(([k, v]) => ({ label: originLabel[k as Origin] ?? k, value: v }))
                .sort((a, b) => b.value - a.value)}
            />
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Por que não fechou</h2>
          <p className="text-xs text-gray-400 mb-3">Negociações perdidas no período, pelo motivo escolhido no funil.</p>
          {painel.motivos.length === 0 ? (
            <EmptyState title="Nenhuma negociação perdida 🎉" />
          ) : (
            <BarList data={painel.motivos} color="#e34948" formatValue={(v) => `${v}`} />
          )}
        </Card>
      </div>

      {painel.diasSemFato > 0 && (
        <p className="mt-4 text-xs text-gray-400">
          {painel.diasSemFato} dia(s) do período ainda sem fatos gravados — o histórico está sendo preenchido aos
          poucos a cada abertura.
        </p>
      )}
    </div>
  );
}

function Vivo({
  rotulo,
  valor,
  icone,
  tom = "neutro",
}: {
  rotulo: string;
  valor: string;
  icone: React.ReactNode;
  tom?: "neutro" | "warn" | "ok";
}) {
  const cor = tom === "warn" ? "text-amber-300" : tom === "ok" ? "text-emerald-300" : "text-white";
  return (
    <div>
      <p className="text-xs text-slate-300 flex items-center gap-1.5">
        {icone}
        {rotulo}
      </p>
      <p className={`text-3xl font-semibold tabular-nums mt-1 ${cor}`}>{valor}</p>
    </div>
  );
}
