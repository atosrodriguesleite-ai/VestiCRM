import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Landmark,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { brl } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { Donut } from "@/components/charts";
import {
  carregarInadimplencia,
  conferirContaPadrao,
  emAbertoNoPeriodo,
} from "@/lib/financeiro/visao";
import {
  HORIZONTES,
  linhasDaCurva,
  montarCurva,
  pendenciaDoBanco,
  pontoMaisBaixo,
  projecao,
  resumoDoMes,
  saidasPorCategoria,
  type Indicador,
} from "@/lib/financeiro/painel";
import { avaliarSaude, type TomDaSaude } from "@/lib/financeiro/saude";
import { saldosPorConta } from "@/lib/financeiro/extrato";
import { dataDoDia, diaSP } from "@/lib/financeiro/lancamentos";
import { formatarDia } from "@/lib/financeiro/dia";
import { AvisoContaPadrao } from "./aviso-conta-padrao";
import { LinhaDeSaldo, Medidor, Sparkline } from "./graficos";

/**
 * VISÃO GERAL do Financeiro (RN-035) — o painel de dono.
 *
 * Responde, nesta ordem, o que a lojista pergunta de manhã: quanto eu tenho
 * (saldo em caixa, por conta); quanto vou ter (30/60/90 dias, e a curva dia
 * a dia); a loja está saudável? (a nota e as quatro frases); como está o mês
 * (entrou, saiu, resultado, ticket — contra o mesmo trecho do mês passado);
 * o que pede um clique hoje (cobrar, conferir com o banco, o que vence); e
 * para onde foi o dinheiro. Todo número vem SOMADO NO BANCO pelas mesmas
 * réguas das outras telas — o painel não pode discordar do extrato.
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
  const [
    inad,
    contas,
    avisoConta,
    aReceberMes,
    aPagarMes,
    venceHoje,
    pagaHoje,
    resumo,
    saidas,
    banco,
    linhasCurva,
  ] = await Promise.all([
    carregarInadimplencia(companyId, hoje),
    saldosPorConta(companyId, diaDeHoje),
    conferirContaPadrao(companyId),
    emAbertoNoPeriodo(companyId, "RECEITA", inicioDoMes, fimDoMes),
    emAbertoNoPeriodo(companyId, "DESPESA", inicioDoMes, fimDoMes),
    // o que vence hoje e ainda não entrou / não saiu
    emAbertoNoPeriodo(companyId, "RECEITA", diaDeHoje, diaDeHoje),
    emAbertoNoPeriodo(companyId, "DESPESA", diaDeHoje, diaDeHoje),
    resumoDoMes(companyId, hoje),
    saidasPorCategoria(companyId, inicioDoMes, diaDeHoje),
    pendenciaDoBanco(companyId, hoje),
    // a consulta da curva não depende do saldo: vai junto das outras, e a
    // montagem (pura) parte do saldo somado por conta logo abaixo
    linhasDaCurva(companyId, hoje),
  ]);

  // saldo de cada conta, para a lojista bater com o app do banco. A conta
  // ARQUIVADA só aparece se ainda tiver dinheiro — some da lista quando
  // zera, mas nunca some do total: as linhas têm que fechar com o card.
  const saldos = contas.filter((c) => !c.arquivada || c.saldo !== 0);
  // UM CAMINHO SÓ para o "saldo hoje": ele já vem somado por conta aqui, e a
  // curva prevista PARTE deste número — duas fontes para um número só é como
  // o card e a curva passariam a discordar sem ninguém perceber.
  const saldoHoje = Math.round(contas.reduce((s, c) => s + c.saldo, 0) * 100) / 100;

  const curva = montarCurva(linhasCurva, saldoHoje, hojeDia);
  const projecoes = HORIZONTES.map((d) => projecao(curva, d));
  const em30 = projecoes[0];
  const escolhida = projecao(curva, dias);
  const pontos = curva.pontos.slice(0, dias + 1);
  const maisBaixo = pontoMaisBaixo(pontos);

  const saude = avaliarSaude({
    saldoHoje,
    aPagar7: curva.pontos[Math.min(7, curva.pontos.length - 1)].saiAcum,
    aReceber30: em30.aReceber,
    aPagar30: em30.aPagar,
    atrasado: inad.total,
    aReceberEmAberto: projecoes[projecoes.length - 1].aReceber,
    entradasMes: resumo.entradas.atual,
    saidasMes: resumo.saidas.atual,
  });

  const comparacao = `vs. 1 a ${resumo.diaDaComparacao} de ${resumo.mesAnterior}`;
  const CORES_DAS_FATIAS = ["#c4622d", "#2a78d6", "#1baf7a", "#eda100", "#4a3aa7"];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Financeiro"
        subtitle="Quanto a loja tem, quanto vai ter, e o que precisa de atenção hoje."
        action={
          <div className="flex flex-wrap gap-2">
            <BotaoDoTopo href="/financeiro/cadastros">Cadastros</BotaoDoTopo>
            <BotaoDoTopo href="/financeiro/dre">Deu lucro?</BotaoDoTopo>
            <BotaoDoTopo href="/financeiro/dfc">Por onde o dinheiro andou</BotaoDoTopo>
          </div>
        }
      />

      <AvisoContaPadrao aviso={avisoConta} />

      {/* ---- quanto eu tenho, quanto vou ter, e a nota ---- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 md:p-6 lg:col-span-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            Saldo em caixa hoje
          </p>
          <p
            className={`mt-1 text-4xl md:text-5xl font-semibold tracking-tight leading-none ${
              saldoHoje < 0 ? "text-rose-700" : "text-slate-900"
            }`}
          >
            {brl(saldoHoje)}
          </p>
          {saldos.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Nenhuma conta cadastrada.{" "}
              <Link href="/financeiro/cadastros" className="font-medium text-brand-700 hover:underline">
                Cadastrar a primeira conta
              </Link>
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {saldos.map((c) => (
                <li
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs"
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.cor }} />
                  <span className="text-slate-600">
                    {c.nome}
                    {c.arquivada && <span className="ml-1 text-slate-400">(arquivada)</span>}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${c.saldo < 0 ? "text-rose-700" : "text-slate-800"}`}
                  >
                    {brl(c.saldo)}
                  </span>
                </li>
              ))}
              <li>
                <Link
                  href="/financeiro/extrato"
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  Ver o extrato →
                </Link>
              </li>
            </ul>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="text-sm font-semibold text-slate-800">
              Se tudo entrar e sair como está previsto
            </p>
            <p className="text-xs text-slate-500">
              Saldo de hoje + o que falta receber − o que falta pagar. O atrasado entra: é dinheiro
              que a loja vai correr atrás.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {projecoes.map((p) => (
                <div
                  key={p.dias}
                  className={`rounded-xl border p-3 ${
                    p.dias === dias ? "border-brand-300 bg-brand-50/40" : "border-slate-200"
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Em {p.dias} dias · {formatarDia(p.ate).slice(0, 5)}
                  </p>
                  <p
                    className={`mt-1 text-xl font-semibold tracking-tight ${
                      p.saldo < 0 ? "text-rose-700" : "text-slate-900"
                    }`}
                  >
                    {brl(p.saldo)}
                  </p>
                  <p
                    className={`mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${
                      p.diferenca > 0
                        ? "text-emerald-700"
                        : p.diferenca < 0
                          ? "text-rose-700"
                          : "text-slate-500"
                    }`}
                  >
                    {p.diferenca > 0 ? (
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    ) : p.diferenca < 0 ? (
                      <ArrowDownRight className="size-3.5" aria-hidden="true" />
                    ) : null}
                    {p.diferenca >= 0 ? "+" : "−"}
                    {brl(Math.abs(p.diferenca))}
                    <span className="font-normal text-slate-400"> vs. hoje</span>
                  </p>
                  <Cobertura valor={p.cobertura} />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Saúde financeira</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selo(saude.tom)}`}>
              {saude.rotulo}
            </span>
          </div>
          <div className="mt-3">
            <Medidor nota={saude.nota} tom={saude.tom} />
          </div>
          <ul className="mt-4 space-y-2.5">
            {saude.sinais.map((s) => (
              <li key={s.titulo} className="flex gap-2 text-xs">
                <span
                  className={`mt-1 size-2 shrink-0 rounded-full ${bolinha(s.tom)}`}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="font-semibold text-slate-700">{s.titulo}</span>
                  <span className="text-slate-400"> · {s.pontos}/{s.maximo}</span>
                  <br />
                  <span className="text-slate-600">{s.frase}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ---- como está o mês ---- */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TileIndicador
          rotulo={`Entradas em ${resumo.mes}`}
          indicador={resumo.entradas}
          icone={<TrendingUp />}
          comparacao={comparacao}
          subirEhBom
        />
        <TileIndicador
          rotulo={`Saídas em ${resumo.mes}`}
          indicador={resumo.saidas}
          icone={<TrendingDown />}
          comparacao={comparacao}
          subirEhBom={false}
        />
        <TileIndicador
          rotulo="Resultado do mês"
          indicador={resumo.resultado}
          icone={<Wallet />}
          comparacao={comparacao}
          subirEhBom
          dica={
            resumo.resultado.anterior != null
              ? `${resumo.mesAnterior} até o dia ${resumo.diaDaComparacao}: ${brl(resumo.resultado.anterior)}`
              : undefined
          }
          tom={resumo.resultado.atual < 0 ? "ruim" : "bom"}
        />
        <TileIndicador
          rotulo="Ticket médio"
          indicador={resumo.ticket}
          icone={<Receipt />}
          comparacao={comparacao}
          subirEhBom
          dica={`${resumo.ticket.pedidos} pedido${resumo.ticket.pedidos === 1 ? "" : "s"} pago${
            resumo.ticket.pedidos === 1 ? "" : "s"
          } no mês, pelo valor vendido (sem frete)`}
        />
      </div>

      {/* ---- o que pede um clique hoje ---- */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Acao
          href="/financeiro/inadimplencia"
          icone={<AlertTriangle />}
          titulo="Cobrar atrasados"
          tom={inad.total > 0 ? "ruim" : "bom"}
          texto={
            inad.total > 0
              ? `${inad.clientes}${inad.truncado ? "+" : ""} cliente${inad.clientes === 1 ? "" : "s"} · ${brl(inad.total)}`
              : "Nenhuma conta atrasada"
          }
        />
        <Acao
          href="/financeiro/conciliacao"
          icone={<Landmark />}
          titulo="Conferir com o banco"
          tom={banco.semPar > 0 ? "atencao" : banco.contaNome ? "bom" : "neutro"}
          texto={
            banco.semPar > 0
              ? `${banco.semPar} linha${banco.semPar === 1 ? "" : "s"} do extrato sem par`
              : banco.contaNome
                ? "Extrato do banco em dia"
                : "Cadastre a conta do banco"
          }
          // o número é o da tela que abre: a mesma conta e os mesmos 3 meses
          rodape={banco.contaNome ? `${banco.contaNome} · últimos 3 meses` : undefined}
        />
        <Acao
          // leva para o lado que tem dinheiro vencendo (só a pagar → Contas a Pagar)
          href={pagaHoje > venceHoje ? "/financeiro/contas-a-pagar" : "/financeiro/contas-a-receber"}
          icone={<CalendarClock />}
          titulo="Vence hoje"
          tom={venceHoje + pagaHoje > 0 ? "atencao" : "bom"}
          texto={
            venceHoje + pagaHoje > 0
              ? [
                  venceHoje > 0 ? `receber ${brl(venceHoje)}` : null,
                  pagaHoje > 0 ? `pagar ${brl(pagaHoje)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Nada vence hoje"
          }
        />
        <Acao
          href="/financeiro/contas-a-pagar"
          icone={<TrendingDown />}
          titulo="Contas a pagar no mês"
          tom="neutro"
          texto={aPagarMes > 0 ? `${brl(aPagarMes)} ainda a pagar` : "Nada em aberto no mês"}
          rodape={aReceberMes > 0 ? `${brl(aReceberMes)} ainda a receber` : undefined}
        />
      </div>

      {/* ---- a curva e para onde foi o dinheiro ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Fluxo de caixa projetado</h2>
              <p className="text-xs text-slate-500">
                Saldo dia a dia até {formatarDia(escolhida.ate)}: entram {brl(escolhida.aReceber)},
                saem {brl(escolhida.aPagar)}
                {maisBaixo && maisBaixo.saldo < 0 && (
                  <>
                    {" "}
                    · <span className="font-medium text-rose-700">
                      menor saldo {brl(maisBaixo.saldo)} em {formatarDia(maisBaixo.dia).slice(0, 5)}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex gap-1 text-xs">
              {HORIZONTES.map((d) => (
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
          {/* no celular o SVG encolhia até o rótulo virar 5px: rola de lado */}
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <LinhaDeSaldo pontos={pontos} formatValue={brl} />
            </div>
          </div>
          {escolhida.saldo < 0 && (
            <p className="mt-2 text-xs text-rose-700">
              Atenção: com o previsto de hoje, o caixa fica negativo antes de{" "}
              {formatarDia(escolhida.ate)}.
            </p>
          )}
          <Link
            href="/financeiro/fluxo-de-caixa"
            className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline"
          >
            Ver o fluxo de caixa mês a mês →
          </Link>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-800">Para onde foi o dinheiro</h2>
          <p className="mb-3 text-xs text-slate-500">Saídas de {resumo.mes}, por categoria</p>
          {saidas.fatias.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma saída registrada em {resumo.mes} ainda.
            </p>
          ) : (
            <Donut
              data={saidas.fatias.map((f, i) => ({
                label: f.nome,
                value: f.valor,
                // "Outras" é a cauda dobrada: cinza de propósito, não é uma categoria
                color: f.nome === "Outras" ? "#94a3b8" : CORES_DAS_FATIAS[i % CORES_DAS_FATIAS.length],
              }))}
              centerValue={brl(saidas.total)}
              centerLabel="saíram no mês"
              formatValue={brl}
            />
          )}
          <Link
            href="/financeiro/dfc"
            className="mt-4 inline-block text-xs font-medium text-brand-700 hover:underline"
          >
            Ver por onde o dinheiro andou →
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
          { href: "/financeiro/contas-a-receber", nome: "Contas a Receber" },
          { href: "/financeiro/contas-a-pagar", nome: "Contas a Pagar" },
          { href: "/financeiro/extrato", nome: "Extrato" },
          { href: "/financeiro/contas-fixas", nome: "Contas fixas" },
          { href: "/financeiro/fluxo-de-caixa", nome: "Fluxo de caixa" },
          { href: "/financeiro/conciliacao", nome: "Conferir com o banco" },
          { href: "/financeiro/cartoes", nome: "Cartões" },
          { href: "/financeiro/transferencias", nome: "Transferências" },
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

/* ---- peças ---------------------------------------------------------------- */

type Tom = TomDaSaude | "neutro";

function selo(tom: TomDaSaude): string {
  return tom === "bom"
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
    : tom === "atencao"
      ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
      : "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
}

function bolinha(tom: TomDaSaude): string {
  return tom === "bom" ? "bg-emerald-500" : tom === "atencao" ? "bg-amber-500" : "bg-rose-500";
}

function BotaoDoTopo({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

/** O termômetro: o que entra cobre o que sai? (mesma conta da versão anterior do painel) */
function Cobertura({ valor }: { valor: number }) {
  return (
    <div className="mt-2">
      <div className="mb-1 flex justify-between text-[10px] text-slate-400">
        <span>o que entra cobre o que sai?</span>
        <span className="font-semibold text-slate-600 tabular-nums">{valor}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${
            valor >= 100 ? "bg-emerald-500" : valor >= 70 ? "bg-amber-500" : "bg-rose-500"
          }`}
          style={{ width: `${Math.max(3, Math.min(100, valor))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * O card de indicador do mês: valor, selo de variação contra o mesmo trecho
 * do mês anterior e a linha pequena do dia a dia. Em "Saídas" subir é RUIM —
 * o selo sabe a direção. Sem base no mês anterior, o selo não aparece.
 */
function TileIndicador({
  rotulo,
  indicador,
  icone,
  comparacao,
  subirEhBom,
  dica,
  tom,
}: {
  rotulo: string;
  indicador: Indicador;
  icone: React.ReactNode;
  comparacao: string;
  subirEhBom: boolean;
  dica?: string;
  tom?: TomDaSaude;
}) {
  const v = indicador.variacao;
  const temVariacao = v != null && Number.isFinite(v);
  const estavel = temVariacao && Math.abs(v) < 0.05;
  const sobe = temVariacao && v > 0;
  const bom = sobe === subirEhBom;
  // "sem base" é NÃO TER MOVIMENTO no trecho anterior — não é "deu zero" nem
  // "deu prejuízo": o Resultado não tem variação % de propósito e mostra o
  // valor anterior na dica (achado da revisão de 05/09/2026)
  const semBase = !indicador.temBase;
  const corDoValor =
    tom === "ruim" ? "text-rose-700" : tom === "bom" && indicador.atual > 0 ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card md:p-5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-slate-400 md:text-[11px]">
          {rotulo}
        </p>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500 [&>svg]:size-3.5">
          {icone}
        </span>
      </div>
      <p className={`truncate text-lg font-semibold tracking-tight sm:text-2xl ${corDoValor}`}>
        {brl(indicador.atual)}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-[120px] flex-1">
          {temVariacao ? (
            <span
              title={comparacao}
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                estavel
                  ? "bg-slate-100 text-slate-500"
                  : bom
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-rose-50 text-rose-600"
              }`}
            >
              {estavel ? "=" : sobe ? "▲" : "▼"}{" "}
              {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })}%
              <span className="sr-only">
                {estavel ? "igual ao" : sobe ? "acima do" : "abaixo do"} mesmo trecho do mês anterior
              </span>
            </span>
          ) : semBase ? (
            <span className="text-[11px] text-slate-400">sem base no mês anterior</span>
          ) : null}
          <p className="mt-1 text-[11px] leading-snug text-slate-400">{dica ?? comparacao}</p>
        </div>
        {indicador.serie.length > 1 && (
          // em card estreito a linha desce para a própria fileira (flex-wrap)
          <Sparkline
            atual={indicador.serie}
            anterior={indicador.serieAnterior}
            rotulo={rotulo}
            formatValue={brl}
          />
        )}
      </div>
    </div>
  );
}

/** Um botão grande com um número honesto embaixo. */
function Acao({
  href,
  icone,
  titulo,
  texto,
  rodape,
  tom,
}: {
  href: string;
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  rodape?: string;
  tom: Tom;
}) {
  const cor =
    tom === "ruim"
      ? "bg-rose-50 text-rose-600"
      : tom === "atencao"
        ? "bg-amber-50 text-amber-600"
        : tom === "bom"
          ? "bg-emerald-50 text-emerald-600"
          : "bg-slate-100 text-slate-500";
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${cor} [&>svg]:size-4`}>
        {icone}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{titulo}</span>
        <span className="block text-xs text-slate-500">{texto}</span>
        {rodape && <span className="block text-xs text-slate-400">{rodape}</span>}
      </span>
    </Link>
  );
}
