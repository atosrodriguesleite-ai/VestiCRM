"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { BALAO, useSelecao } from "@/components/grafico-vivo";
import { COR_DA_SERIE, geometriaDaSerie, indiceMaisPerto, posicaoDoBalao } from "@/lib/bi/paleta";
import { brl } from "@/lib/format";
// SÓ a parte pura: o motor com Prisma não pode chegar ao navegador
import {
  ROTULO_DA_COMPARACAO,
  TIPOS_DE_COMPARACAO,
  avisoDaFalha,
  diaDaSemana,
  enderecoDaPorta,
  fraseDaComparacao,
  lerParametros,
  montarGrafico,
  periodoDeComparacao,
  resumoDoFaturamento,
  rotuloDoDia,
  rotuloDoDiaComAno,
  textoDaVariacao,
  type DadosDoFaturamento,
  type ModoDoGrafico,
  type ParametrosDoFaturamento,
  type Resumo as ResumoDoFaturamento,
  type TipoDeComparacao,
} from "@/lib/dashboard/faturamento-regra";
import { diaSP } from "@/lib/dia";

/**
 * O GRÁFICO DE FATURAMENTO DO DASHBOARD, VIVO (RN-108).
 *
 * O estado inicial vem do servidor (a página já desenha o período anterior,
 * legível antes do JavaScript). Daí a pessoa: (1) passa o dedo ou o mouse e
 * lê o valor EXATO do dia nos dois períodos, com a diferença; (2) troca a
 * COMPARAÇÃO — período anterior, mesmo período do ano passado ou uma data
 * que ela escolhe — sem recarregar a página (a porta devolve as duas séries
 * pela mesma régua); (3) troca para o ACUMULADO, que é a pergunta "até o
 * dia 15 estou na frente ou atrás?". A escolha fica no aparelho (preferência
 * de leitura), e a última comparação que deu certo fica na tela quando a
 * busca falha — nunca pisca vazio.
 */

const COR_DO_COMPARADO = "#dbba8b";
const CHAVE_DA_PREFERENCIA = "dashboard:faturamento";

type Preferencia = { tipo: TipoDeComparacao; cmpDe: string; modo: ModoDoGrafico };

function lerPreferencia(): Partial<Preferencia> {
  try {
    const cru = localStorage.getItem(CHAVE_DA_PREFERENCIA);
    if (!cru) return {};
    const p = JSON.parse(cru) as Partial<Preferencia>;
    return {
      tipo: TIPOS_DE_COMPARACAO.includes(p.tipo as TipoDeComparacao) ? p.tipo : undefined,
      cmpDe: typeof p.cmpDe === "string" ? p.cmpDe : undefined,
      modo: p.modo === "acumulado" || p.modo === "dia" ? p.modo : undefined,
    };
  } catch {
    return {};
  }
}

function guardarPreferencia(p: Preferencia) {
  try {
    localStorage.setItem(CHAVE_DA_PREFERENCIA, JSON.stringify(p));
  } catch {
    /* sem armazenamento (aba privada): a escolha vale só nesta abertura */
  }
}

/**
 * O nome do ponto: "qua 04/11" (um dia), "04/11 a 10/11" (uma semana) ou
 * "até 04/11" (acumulado) — a mesma escada para o dia atual e o comparado,
 * que leva o ano (é outro período, a pessoa precisa saber qual).
 */
function nomeDoPonto(de: string, ate: string, opcoes: { porSemana: boolean; acumulado: boolean; comAno: boolean }): string {
  const fim = opcoes.comAno ? rotuloDoDiaComAno : rotuloDoDia;
  if (opcoes.acumulado) return `até ${fim(ate)}`;
  if (opcoes.porSemana) return `${rotuloDoDia(de)} a ${fim(ate)}`;
  return `${diaDaSemana(de)} ${fim(de)}`;
}

function pedidosTexto(n: number): string {
  return n === 1 ? "1 pedido" : `${n} pedidos`;
}

export function FaturamentoVivo({ inicial }: { inicial: DadosDoFaturamento }) {
  const [dados, setDados] = useState(inicial);
  const [tipo, setTipo] = useState<TipoDeComparacao>(inicial.comparacao.tipo);
  const [cmpDe, setCmpDe] = useState("");
  const [modo, setModo] = useState<ModoDoGrafico>("dia");
  /** nulo = a última busca deu certo; número = o status que falhou (0 = rede) */
  const [falha, setFalha] = useState<number | null>(null);
  const [buscando, setBuscando] = useState(false);
  /** o que a tela quer ver agora (nulo = o que o servidor mandou serve) */
  const [pedido, setPedido] = useState<ParametrosDoFaturamento | null>(null);

  // A PÁGINA TROCOU DE PERÍODO (os atalhos De/Até): o pacote novo do
  // servidor é o período anterior; se a pessoa estava noutra comparação,
  // pedimos a dela de novo para o período novo.
  const [periodoNaTela, setPeriodoNaTela] = useState(inicial.periodo);
  if (periodoNaTela.de !== inicial.periodo.de || periodoNaTela.ate !== inicial.periodo.ate) {
    setPeriodoNaTela(inicial.periodo);
    setDados(inicial);
    setFalha(null);
    setPedido(tipo === "anterior" ? null : lerParametros({ ...inicial.periodo, tipo, cmpDe }));
  }

  // a preferência guardada no aparelho (só a leitura: o servidor não a conhece)
  useEffect(() => {
    const p = lerPreferencia();
    if (p.modo) setModo(p.modo);
    if (p.cmpDe) setCmpDe(p.cmpDe);
    if (p.tipo && p.tipo !== "anterior") {
      setTipo(p.tipo);
      setPedido(lerParametros({ ...inicial.periodo, tipo: p.tipo, cmpDe: p.cmpDe ?? null }));
    }
    // só na montagem: o período de partida é o da página
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a busca da comparação pedida: a resposta velha não passa por cima da nova
  useEffect(() => {
    // sem pedido, nada está sendo buscado — inclusive a busca que o cleanup
    // acabou de abortar (senão o "Atualizando…" ficava preso, achado da revisão)
    if (!pedido) {
      setBuscando(false);
      return;
    }
    const controle = new AbortController();
    setBuscando(true);
    fetch(enderecoDaPorta(pedido), { signal: controle.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          setFalha(r.status);
          return;
        }
        const corpo = (await r.json()) as DadosDoFaturamento;
        setDados(corpo);
        setFalha(null);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") return;
        setFalha(0);
      })
      .finally(() => {
        if (!controle.signal.aborted) setBuscando(false);
      });
    return () => controle.abort();
  }, [pedido]);

  const escolher = (novoTipo: TipoDeComparacao, novoCmpDe = cmpDe) => {
    setTipo(novoTipo);
    setCmpDe(novoCmpDe);
    guardarPreferencia({ tipo: novoTipo, cmpDe: novoCmpDe, modo });
    // o período anterior do período da tela a página já mandou: não se busca de novo
    if (
      novoTipo === "anterior" &&
      inicial.comparacao.tipo === "anterior" &&
      inicial.periodo.de === dados.periodo.de &&
      inicial.periodo.ate === dados.periodo.ate
    ) {
      setDados(inicial);
      setFalha(null);
      setPedido(null);
      return;
    }
    const p = lerParametros({ ...dados.periodo, tipo: novoTipo, cmpDe: novoCmpDe });
    // "outra data" ainda sem data válida: espera a pessoa escolher
    if (p) setPedido(p);
  };
  const escolherModo = (m: ModoDoGrafico) => {
    setModo(m);
    guardarPreferencia({ tipo, cmpDe, modo: m });
  };

  const grafico = useMemo(() => montarGrafico(dados, modo), [dados, modo]);
  const resumo = useMemo(() => resumoDoFaturamento(dados, diaSP(new Date())), [dados]);
  const previa = tipo === "personalizado" ? periodoDeComparacao("personalizado", dados.periodo, cmpDe) : null;

  return (
    <div className={buscando ? "opacity-70 transition-opacity" : "transition-opacity"} data-testid="faturamento-vivo">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <TrendingUp className="size-4 text-brand-600" />
          Faturamento no período
          {grafico.porSemana && <span className="text-[11px] font-normal text-slate-400">· por semana</span>}
          <InfoTip
            text={
              grafico.porSemana
                ? "Período longo agrupa por SEMANA: cada ponto soma os 7 dias a partir da data mostrada. A linha tracejada é o período comparado, de mesma duração — semana 1 alinha com semana 1. Passe o dedo ou o mouse para ver o valor exato."
                : "Valor dos pedidos PAGOS por dia (pela data do pagamento). A linha tracejada é o período comparado, de mesma duração — dia 1 alinha com dia 1. Passe o dedo ou o mouse para ver o valor exato de cada dia nos dois períodos."
            }
          />
          {dados.cortado && (
            <span className="text-[11px] font-normal text-amber-600">· mostrando os primeiros 4 anos do período</span>
          )}
        </h2>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          {buscando && (
            <span className="inline-flex items-center gap-1 text-brand-700 font-medium">
              <Loader2 className="size-3 animate-spin" /> Atualizando…
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-brand-600 rounded" />
            período atual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed rounded" style={{ borderColor: COR_DO_COMPARADO }} />
            comparado
          </span>
        </div>
      </div>

      {/* os controles: com o que comparar, e por dia ou acumulado */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Comparar com">
          <span className="text-[11px] font-semibold text-gray-500 mr-0.5">Comparar com:</span>
          {TIPOS_DE_COMPARACAO.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => escolher(t)}
              aria-pressed={tipo === t}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
                tipo === t
                  ? "bg-brand-600 border-brand-600 text-white shadow-sm"
                  : "bg-white border-gray-200 text-gray-500 hover:border-brand-300 hover:text-brand-700"
              }`}
            >
              {ROTULO_DA_COMPARACAO[t]}
            </button>
          ))}
          {tipo === "personalizado" && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              a partir de
              <input
                type="date"
                value={cmpDe}
                aria-label="Começo do período comparado"
                onChange={(e) => escolher("personalizado", e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white text-gray-700"
              />
              {previa && (
                <span className="text-slate-400">
                  até {rotuloDoDiaComAno(previa.ate)} <span className="hidden sm:inline">· mesma duração do período da tela</span>
                </span>
              )}
            </label>
          )}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Modo do gráfico">
          {(["dia", "acumulado"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => escolherModo(m)}
              aria-pressed={modo === m}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
                modo === m
                  ? "bg-gray-900 border-gray-900 text-white"
                  : "bg-white border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700"
              }`}
            >
              {m === "dia" ? "Por dia" : "Acumulado"}
            </button>
          ))}
        </div>
      </div>

      {/* a comparação em uma frase, e a falha quando houver */}
      <p className="text-[11px] text-slate-500 mb-3">
        Comparando com <span className="font-medium text-slate-600">{fraseDaComparacao(dados.comparacao)}</span>
        {tipo === "personalizado" && !previa && (
          <span className="text-amber-600"> · escolha a data de começo</span>
        )}
        {falha != null && (
          <span role="alert" className="text-amber-600">
            {" "}
            · {avisoDaFalha(falha)}
          </span>
        )}
      </p>

      <Resumo resumo={resumo} comparacao={dados.comparacao} />

      <Linhas grafico={grafico} modo={modo} />
    </div>
  );
}

function Resumo({ resumo, comparacao }: { resumo: ResumoDoFaturamento; comparacao: DadosDoFaturamento["comparacao"] }) {
  const temComparacao = resumo.totalComparado != null;
  const sobe = (resumo.diferenca ?? 0) > 0;
  const desce = (resumo.diferenca ?? 0) < 0;
  const corDaVariacao = sobe ? "text-emerald-700 bg-emerald-50" : desce ? "text-red-700 bg-red-50" : "text-slate-600 bg-slate-100";
  return (
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4 text-xs" data-testid="faturamento-resumo">
      <div className="rounded-xl bg-gray-50 px-3 py-2">
        <dt className="text-[11px] text-gray-500">Vendido no período</dt>
        <dd className="font-semibold text-base text-gray-900 tabular-nums">{brl(resumo.total)}</dd>
        <dd className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
          {temComparacao && (
            <span className={`rounded-full px-1.5 py-0.5 font-semibold tabular-nums ${corDaVariacao}`}>
              {resumo.variacao == null ? "sem base" : `${sobe ? "▲" : desce ? "▼" : "="} ${textoDaVariacao(resumo.variacao)}`}
            </span>
          )}
          <span>{pedidosTexto(resumo.pedidos)}</span>
          {resumo.ticket != null && <span>· ticket {brl(resumo.ticket)}</span>}
        </dd>
      </div>
      <div className="rounded-xl bg-gray-50 px-3 py-2">
        <dt className="text-[11px] text-gray-500">{comparacao.tipo === "anterior" ? "Período anterior" : comparacao.tipo === "ano-passado" ? "Ano passado" : "Período escolhido"}</dt>
        <dd className="font-semibold text-base text-gray-700 tabular-nums">{temComparacao ? brl(resumo.totalComparado!) : "—"}</dd>
        <dd className="text-[11px] text-gray-500">
          {temComparacao ? (
            <>
              {pedidosTexto(resumo.pedidosComparados ?? 0)}
              {resumo.diferenca != null && (
                <span> · {sobe ? "+" : desce ? "−" : ""}{brl(Math.abs(resumo.diferenca))} de diferença</span>
              )}
            </>
          ) : (
            "sem período para comparar"
          )}
        </dd>
      </div>
      <div className="rounded-xl bg-gray-50 px-3 py-2">
        <dt className="text-[11px] text-gray-500">Média por dia</dt>
        <dd className="font-semibold text-base text-gray-900 tabular-nums">{brl(resumo.mediaPorDia)}</dd>
        <dd className="text-[11px] text-gray-500">
          {resumo.mediaSemHoje ? `${resumo.diasDaMedia} dias fechados, sem hoje` : `${resumo.diasDaMedia} ${resumo.diasDaMedia === 1 ? "dia" : "dias"}`}
          {resumo.mediaPorDiaComparada != null && ` · comparado: ${brl(resumo.mediaPorDiaComparada)}`}
        </dd>
      </div>
      <div className="rounded-xl bg-gray-50 px-3 py-2">
        <dt className="text-[11px] text-gray-500">Melhor dia</dt>
        <dd className="font-semibold text-base text-gray-900 tabular-nums">{resumo.melhorDia ? brl(resumo.melhorDia.valor) : "—"}</dd>
        <dd className="text-[11px] text-gray-500">
          {resumo.melhorDia ? `${diaDaSemana(resumo.melhorDia.dia)} ${rotuloDoDiaComAno(resumo.melhorDia.dia)}` : "nenhuma venda paga"}
        </dd>
      </div>
    </dl>
  );
}

/**
 * A medida do desenho: no celular o SVG de 600 pontos de largura é
 * encolhido para ~350 px e a letra de 10 vira 6 — ilegível. Lá o viewBox é
 * estreito e mais alto (a letra sai no tamanho em que foi desenhada e a
 * curva ganha altura); o estado inicial é o do computador (vem do servidor)
 * e o celular ajusta ao montar.
 */
function useMedidaDoGrafico(): { w: number; h: number } {
  const [estreito, setEstreito] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const ler = () => setEstreito(mq.matches);
    ler();
    mq.addEventListener("change", ler);
    return () => mq.removeEventListener("change", ler);
  }, []);
  return estreito ? { w: 360, h: 240 } : { w: 600, h: 200 };
}

/** as duas linhas no mesmo eixo, com a mira, o balão e o teclado (a régua da RN-089) */
function Linhas({ grafico, modo }: { grafico: ReturnType<typeof montarGrafico>; modo: ModoDoGrafico }) {
  const { w: width, h: height } = useMedidaDoGrafico();
  const atual = useMemo(() => grafico.pontos.map((p) => p.atual), [grafico]);
  const comparado = useMemo(() => grafico.pontos.map((p) => p.comparado ?? 0), [grafico]);
  const temComparacao = grafico.pontos.some((p) => p.comparado != null);
  // o teto do eixo é o maior das DUAS séries: cada uma em seu eixo mentiria a comparação
  const max = Math.max(...atual, ...(temComparacao ? comparado : [0]), 1);
  const gA = useMemo(
    () => geometriaDaSerie(atual, { w: width, h: height, max, larguraDoRotulo: (i) => brl(atual[i]).length * 6.5 + 8 }),
    [atual, width, height, max]
  );
  const gC = useMemo(() => geometriaDaSerie(comparado, { w: width, h: height, max }), [comparado, width, height, max]);
  const { w, h, pad, n, iw, ih, xy, maxIdx } = gA;
  const gid = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const { ativo, setAtivo, sair, marcarToque } = useSelecao(caixa);
  if (n === 0) return <p className="text-xs text-gray-400">Sem dados no período.</p>;

  const mover = (clientX: number) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const fracao = (clientX - r.left - (pad.left / w) * r.width) / ((iw / w) * r.width);
    setAtivo(indiceMaisPerto(fracao, n));
  };
  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setAtivo((x) => Math.min(n - 1, (x ?? -1) + 1));
    else if (e.key === "ArrowLeft") setAtivo((x) => Math.max(0, (x ?? n) - 1));
    else if (e.key === "Escape") setAtivo(null);
    else return;
    e.preventDefault();
  };
  const rotulado = new Map(gA.rotulos.map((r) => [r.i, r]));
  // a seleção sobrevive à troca de comparação ou de modo: fora da série, não vale
  const a = ativo != null && ativo < n ? ativo : null;
  const ponto = a == null ? null : grafico.pontos[a];
  const ancora = a == null ? "centro" : posicaoDoBalao(xy[a][0] / w);
  // o balão tem quatro linhas: fica ABAIXO do ponto quando ele está na metade
  // de cima e ACIMA quando está na de baixo — preso ao topo ele saía pelo pé
  // do cartão no celular, onde o gráfico é baixo (prova no navegador)
  const yDoPonto = a == null ? 0 : Math.min(xy[a][1], gC.xy[a]?.[1] ?? xy[a][1]) / h;
  const estiloDoBalao: React.CSSProperties | undefined =
    a == null
      ? undefined
      : {
          ...(yDoPonto > 0.5 ? { bottom: `${(1 - yDoPonto) * 100 + 4}%` } : { top: `${yDoPonto * 100 + 4}%` }),
          ...(ancora === "direita" ? { right: `${100 - (xy[a][0] / w) * 100}%` } : { left: `${(xy[a][0] / w) * 100}%` }),
          ...(ancora === "centro" ? { transform: "translateX(-50%)" } : {}),
        };
  const acumulado = modo === "acumulado";
  const diferenca = ponto && ponto.comparado != null ? ponto.atual - ponto.comparado : null;

  return (
    <div
      ref={caixa}
      className="relative outline-none focus-visible:ring-2 ring-brand-300 rounded-lg touch-pan-y select-none"
      tabIndex={0}
      role="group"
      aria-roledescription="gráfico"
      aria-label={`Faturamento ${acumulado ? "acumulado" : "por dia"}: ${n} pontos, pico ${brl(atual[maxIdx])} em ${grafico.rotulos[maxIdx] ?? ""}. Use as setas para percorrer.`}
      onPointerDown={(e) => {
        marcarToque(e);
        mover(e.clientX);
      }}
      onPointerMove={(e) => mover(e.clientX)}
      onPointerLeave={sair}
      onFocus={() => setAtivo((x) => x ?? n - 1)}
      onBlur={() => setAtivo(null)}
      onKeyDown={tecla}
      data-testid="faturamento-grafico"
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COR_DA_SERIE} stopOpacity="0.18" />
            <stop offset="100%" stopColor={COR_DA_SERIE} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.left} x2={w - pad.right} y1={pad.top + ih * f} y2={pad.top + ih * f} className="stroke-slate-100" strokeWidth="1" />
        ))}
        {temComparacao && n > 1 && (
          <path d={gC.linha} fill="none" stroke={COR_DO_COMPARADO} strokeWidth="1.75" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
        )}
        <path d={gA.area} fill={`url(#${gid})`} className="gv-area" />
        <path d={gA.linha} fill="none" stroke={COR_DA_SERIE} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {a != null && <line x1={xy[a][0]} x2={xy[a][0]} y1={pad.top} y2={pad.top + ih} className="stroke-slate-300" strokeWidth="1" />}
        {xy.map(([x, y], i) => {
          const vivo = i === a;
          const rotulo = rotulado.get(i);
          if (!vivo && !rotulo) return null;
          return (
            <g key={i}>
              {vivo && temComparacao && (
                <circle cx={gC.xy[i][0]} cy={gC.xy[i][1]} r={4} fill={COR_DO_COMPARADO} className="stroke-white" strokeWidth="2" />
              )}
              <circle cx={x} cy={y} r={vivo ? 5 : 4} fill={COR_DA_SERIE} className="stroke-white" strokeWidth="2" />
              {rotulo && atual[i] > 0 && !vivo && (
                <text x={rotulo.x} y={rotulo.y} textAnchor="middle" className="fill-slate-600" fontSize="11" fontWeight="600">
                  {brl(atual[i])}
                </text>
              )}
            </g>
          );
        })}
        {gA.eixo.map((i) => (
          <text key={i} x={xy[i][0]} y={h - 6} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="10" className="fill-slate-400">
            {grafico.rotulos[i]}
          </text>
        ))}
      </svg>
      {/* o balão: os dois períodos no mesmo dia, e a diferença (o leitor de tela anuncia, fora do SVG) */}
      <div role="status" aria-live="polite" className={ponto == null ? "sr-only" : `${BALAO} min-w-[13rem]`} style={estiloDoBalao}>
        {ponto && (
          <>
            <div className="gv-balao-sub">{nomeDoPonto(ponto.de, ponto.ate, { porSemana: grafico.porSemana, acumulado, comAno: false })}</div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full shrink-0" style={{ background: COR_DA_SERIE }} />
              <span className="font-semibold tabular-nums">{brl(ponto.atual)}</span>
              <span className="gv-balao-sub">· {pedidosTexto(ponto.pedidos)}</span>
            </div>
            {ponto.comparado != null && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full shrink-0" style={{ background: COR_DO_COMPARADO }} />
                <span className="tabular-nums">{brl(ponto.comparado)}</span>
                <span className="gv-balao-sub">
                  · {pedidosTexto(ponto.pedidosComparados ?? 0)} ·{" "}
                  {ponto.cmpDe && ponto.cmpAte ? nomeDoPonto(ponto.cmpDe, ponto.cmpAte, { porSemana: grafico.porSemana, acumulado, comAno: true }) : ""}
                </span>
              </div>
            )}
            {diferenca != null && (
              <div className="tabular-nums font-medium">
                {diferenca > 0 ? "▲ +" : diferenca < 0 ? "▼ −" : "= "}
                {brl(Math.abs(diferenca))}
                {ponto.comparado ? ` (${textoDaVariacao(((ponto.atual - ponto.comparado) / ponto.comparado) * 100)})` : ""}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
