import Link from "next/link";
import { Clock, FileDown, Inbox, Repeat, ShoppingBag, Users, Wallet } from "lucide-react";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { StatCard } from "@/components/dash";
import { BarrasVivas, FunilVivo, SerieViva } from "@/components/grafico-vivo";
import { PeriodChips } from "@/components/period-chips";
import { db } from "@/lib/db";
import { originLabel } from "@/lib/format";
import { dataDoDia, diaSP } from "@/lib/dia";
import { porteiraBiTela } from "@/lib/bi/gate";
import { atualizarFatosDoBiSeDevido, ROTULO_DO_BALDE, ultimosDias } from "@/lib/bi/fatos";
import { diasDoPeriodo, montarPainel, montarVendedoras, variacao } from "@/lib/bi/painel";
import { MetasCard } from "./metas-card";
import { Abas } from "./abas";
// lerAba mora na lib PURA: o abas.tsx é do navegador ("use client"), e função
// importada de lá chega ao servidor como referência de cliente — chamá-la
// derrubava a página inteira ("Attempted to call lerAba() from the server")
import { lerAba } from "@/lib/bi/abas";
import { VendedorasView } from "./vendedoras-view";
import { CarteiraView } from "./carteira-view";
import { montarCarteira } from "@/lib/bi/carteira";
import { montarRfm } from "@/lib/bi/rfm";
import { hrefDaLista } from "@/lib/bi/listas";
import { montarTendencia } from "@/lib/bi/tendencia";
import { TendenciaCard } from "./tendencia-card";
import { numerosDeHoje } from "@/lib/bi/hoje";
import { FaixaDeHoje } from "./faixa-de-hoje";
import { montarAnuncios } from "@/lib/bi/anuncios";
import { AnunciosView } from "./anuncios-view";
import type { Origin } from "@prisma/client";

export const dynamic = "force-dynamic";


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
      {/* EXPORTAR PDF (RN-090): o mesmo período, os mesmos motores — o papel não diz número diferente da tela */}
      <div className="mt-2 flex justify-end">
        <a
          href={`/api/bi/relatorio?de=${periodo.de}&ate=${periodo.ate}`}
          download
          className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition"
          title="Baixa o relatório do período em PDF: números, funil, vendedoras e os últimos 12 meses"
        >
          <FileDown className="size-3.5" />
          Baixar PDF do período
        </a>
      </div>
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
    const [dados, rfm] = await Promise.all([montarCarteira(user, periodo), montarRfm(user.companyId)]);
    return (
      <div className="max-w-6xl mx-auto">
        {cabecalho}
        <div className="mt-4">
          <CarteiraView dados={dados} rfm={rfm} dias={diasDoPeriodo(dados.periodo).length} />
        </div>
      </div>
    );
  }

  if (aba === "anuncios") {
    const dados = await montarAnuncios(user.companyId, periodo);
    return (
      <div className="max-w-6xl mx-auto">
        {cabecalho}
        <div className="mt-4">
          <AnunciosView dados={dados} dias={diasDoPeriodo(dados.periodo).length} />
        </div>
      </div>
    );
  }

  const [painel, tendencia, deHoje] = await Promise.all([
    montarPainel(user.companyId, periodo, agora),
    montarTendencia(user.companyId, agora),
    numerosDeHoje(user.companyId, agora),
  ]);
  const { atual, passado, funil, serie } = painel;
  // CLICAR E CAVAR (RN-086): o número leva à lista de quem está por trás dele
  const lista = (tipo: "sem-resposta" | "contatos" | "vendas") => hrefDaLista({ tipo, de: painel.periodo.de, ate: painel.periodo.ate, aba: "painel" });
  const dias = serie.length;
  const rotuloDoMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(agora);
  const totalRespondidas = atual.hist.reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-6xl mx-auto">
      {cabecalho}

      {/* HOJE — a faixa viva (RN-088): calculada na hora e atualizada sozinha */}
      <FaixaDeHoje
        inicial={deHoje}
        prazoMin={company?.intakeSlaMinutes ?? 60}
        hrefEsperando={hrefDaLista({ tipo: "esperando-agora", de: painel.periodo.de, ate: painel.periodo.ate, aba: "painel" })}
        rodape={
          painel.atualizadoEm
            ? `Fatos do período atualizados ${new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(painel.atualizadoEm)}.`
            : undefined
        }
      />

      {/* OS SEIS NÚMEROS DO PERÍODO */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 animate-fade-up">
        <Cavar href={lista("contatos")}>
          <StatCard
            label="Novos contatos"
            value={atual.leads}
            delta={variacao(atual.leads, passado.leads)}
            hint={`${dias} dias · ${Object.keys(atual.origens).length} origens · toque para ver quem`}
            icon={<Users className="size-4" />}
            series={serie.map((s) => s.leads)}
          />
        </Cavar>
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
        <Cavar href={lista("sem-resposta")}>
          <StatCard
            label="Sem resposta"
            value={atual.semResposta}
            tone={atual.semResposta > 0 ? "bad" : "good"}
            hint="clientes que escreveram e ninguém da loja respondeu · toque para ver quem"
            icon={<Inbox className="size-4" />}
          />
        </Cavar>
        <Cavar href={lista("vendas")}>
          <StatCard
            label="Vendido no período"
            value={atual.vendido}
            format="brl"
            delta={variacao(atual.vendido, passado.vendido)}
            hint={`${atual.pedidosPagos} pedidos pagos · toque para ver quais`}
            icon={<Wallet className="size-4" />}
            series={serie.map((s) => s.vendido)}
          />
        </Cavar>
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

      <div className="grid lg:grid-cols-2 gap-4 mt-4 animate-fade-up [animation-delay:80ms]">
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
            <FunilVivo
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

      <div className="grid lg:grid-cols-2 gap-4 mt-4 animate-fade-up [animation-delay:160ms]">
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Novos contatos por dia</h2>
          <p className="text-xs text-gray-400 mb-3">{dias} dias no período.</p>
          <SerieViva titulo="Novos contatos por dia" points={serie.map((s) => s.leads)} labels={serie.map((s) => s.dia.slice(8, 10) + "/" + s.dia.slice(5, 7))} />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Vendido por dia</h2>
          <p className="text-xs text-gray-400 mb-3">Pela data do pagamento, valor vendido sem o frete.</p>
          <SerieViva
            titulo="Vendido por dia"
            points={serie.map((s) => s.vendido)}
            labels={serie.map((s) => s.dia.slice(8, 10) + "/" + s.dia.slice(5, 7))}
            formato="brl"
          />
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4 animate-fade-up [animation-delay:240ms]">
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Quanto a cliente esperou</h2>
          <p className="text-xs text-gray-400 mb-3">
            Distribuição das {totalRespondidas} respostas do período, em minutos com a loja aberta.
          </p>
          {totalRespondidas === 0 ? (
            <EmptyState title="Sem respostas no período" />
          ) : (
            <BarrasVivas
              data={atual.hist.map((n, i) => ({ label: ROTULO_DO_BALDE[i] ?? ROTULO_DO_BALDE[ROTULO_DO_BALDE.length - 1], value: n }))}
              formato={{ pctDe: totalRespondidas }}
            />
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-1">De onde vieram</h2>
          <p className="text-xs text-gray-400 mb-3">Origem dos contatos novos do período. Qual anúncio só aparece para quem chegou por link rastreado.</p>
          {atual.leads === 0 ? (
            <EmptyState title="Nenhum contato novo" />
          ) : (
            <BarrasVivas
              data={Object.entries(atual.origens)
                .map(([k, v]) => ({ label: originLabel[k as Origin] ?? k, value: v }))
                .sort((a, b) => b.value - a.value)}
            />
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Por que não fechou</h2>
          <p className="text-xs text-gray-400 mb-3">Negociações perdidas no período, pelo motivo escolhido no funil.</p>
          {/* motivo de perda é CATEGORIA, não status: uma cor só (o vermelho é do prazo e do sem resposta) */}
          {painel.motivos.length === 0 ? (
            <EmptyState title="Nenhuma negociação perdida 🎉" />
          ) : (
            <BarrasVivas data={painel.motivos} />
          )}
        </Card>
      </div>

      <div className="mt-4">
        <TendenciaCard meses={tendencia} />
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

/** o cartão vira link para a lista por trás do número (RN-086) */
function Cavar({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-2xl ring-brand-300 hover:ring-2 transition" title="Ver a lista">
      {children}
    </Link>
  );
}
