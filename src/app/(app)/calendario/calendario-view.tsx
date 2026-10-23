"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Portal } from "@/components/portal";
import { Button, Card, EmptyState, Field, inputCls } from "@/components/ui";
import { avisoDaRecusa } from "@/lib/sessao";
import {
  LIMITES,
  antecedenciaDe,
  diasEntre,
  intervaloDaTela,
  inicioDe,
  situacaoDe,
  type Ocorrencia,
  type SituacaoDaData,
  type TipoDaData,
} from "@/lib/calendario/datas";

/**
 * A TELA DO CALENDÁRIO COMERCIAL (RN-092). Toda a conta de datas vem da
 * regra pura (`lib/calendario/datas.ts`) — a mesma que o servidor usa para o
 * lembrete; aqui é só desenho e as idas às portas de sempre.
 */

const NOME_DO_TIPO: Record<TipoDaData, string> = {
  COMERCIAL: "Comercial",
  OPORTUNIDADE: "Oportunidade",
  LANCAMENTO: "Lançamento",
};
const COR_DO_TIPO: Record<TipoDaData, string> = {
  COMERCIAL: "bg-amber-50 text-amber-800 border-amber-200",
  OPORTUNIDADE: "bg-violet-50 text-violet-700 border-violet-200",
  LANCAMENTO: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const SEMANA_CURTA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const partes = (dia: string) => dia.split("-").map(Number) as [number, number, number];
const diaDaSemana = (dia: string) => {
  const [a, m, d] = partes(dia);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
};
const curto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const longo = (dia: string) => {
  const [a, m, d] = partes(dia);
  return `${SEMANA[diaDaSemana(dia)]}, ${d} de ${MESES[m - 1]} de ${a}`;
};
const faltam = (hoje: string, dia: string) => {
  const n = diasEntre(hoje, dia);
  return n === 1 ? "falta 1 dia" : `faltam ${n} dias`;
};

type Filtro = "TODAS" | TipoDaData;

type Props = {
  hoje: string;
  antecedenciaDias: number;
  segmentosDaLoja: string[];
  ocultas: { chave: string; titulo: string }[];
  ocorrencias: Ocorrencia[];
  segmentos: { chave: string; nome: string; datas: string[] }[];
};

/** Ida às portas do calendário, com a recusa já em português. */
async function chamar(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<{ ok: true; data: { id?: string } } | { ok: false; erro: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, erro: avisoDaRecusa(res.status, data, "Não deu certo. Tente de novo.") };
    return { ok: true, data };
  } catch {
    return { ok: false, erro: "Sem conexão. Confira a internet e tente de novo." };
  }
}

export function CalendarioView(props: Props) {
  const { hoje, antecedenciaDias, ocorrencias } = props;
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("TODAS");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [prefsAbertas, setPrefsAbertas] = useState(props.segmentosDaLoja.length === 0);

  const aberta = abertaId ? ocorrencias.find((o) => o.id === abertaId) ?? null : null;
  // a data sumiu da lista (apagada, escondida, movida para fora dos 12
  // meses): a ficha fecha em vez de ficar presa a uma data que não existe
  useEffect(() => {
    if (abertaId && !aberta) setAbertaId(null);
  }, [abertaId, aberta]);

  const visiveis = useMemo(
    () => (filtro === "TODAS" ? ocorrencias : ocorrencias.filter((o) => o.tipo === filtro)),
    [ocorrencias, filtro]
  );
  // a janela de trabalho: já passou do dia de começar e a data não chegou
  const agora = useMemo(
    () =>
      visiveis.filter((o) => {
        const s = situacaoDe(o, antecedenciaDias, hoje);
        return s === "agora" || s === "hoje";
      }),
    [visiveis, antecedenciaDias, hoje]
  );
  const porMes = useMemo(() => {
    const grupos = new Map<string, Ocorrencia[]>();
    for (const o of visiveis) {
      const mes = o.dia.slice(0, 7);
      grupos.set(mes, [...(grupos.get(mes) ?? []), o]);
    }
    return [...grupos.entries()];
  }, [visiveis]);

  const contagem = (t: TipoDaData) => ocorrencias.filter((o) => o.tipo === t).length;
  const chips: { valor: Filtro; rotulo: string; n: number }[] = [
    { valor: "TODAS", rotulo: "Todas", n: ocorrencias.length },
    { valor: "COMERCIAL", rotulo: "Comerciais", n: contagem("COMERCIAL") },
    { valor: "OPORTUNIDADE", rotulo: "Oportunidades", n: contagem("OPORTUNIDADE") },
    { valor: "LANCAMENTO", rotulo: "Lançamentos", n: contagem("LANCAMENTO") },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.valor}
              type="button"
              onClick={() => setFiltro(c.valor)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filtro === c.valor
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {c.rotulo} <span className="opacity-70">{c.n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPrefsAbertas((v) => !v)}>
            <Settings2 className="size-3.5" />
            Preferências
          </Button>
          <Button size="sm" onClick={() => setNovaAberta(true)}>
            <CalendarPlus className="size-3.5" />
            Nova data
          </Button>
        </div>
      </div>

      {prefsAbertas && (
        <Preferencias
          antecedenciaDias={antecedenciaDias}
          segmentosDaLoja={props.segmentosDaLoja}
          segmentos={props.segmentos}
          ocultas={props.ocultas}
          onMudou={() => router.refresh()}
          onFechar={() => setPrefsAbertas(false)}
        />
      )}

      {agora.length > 0 && (
        <Card className="p-4 md:p-5 border-amber-200 bg-amber-50/40">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Sparkles className="size-4" />
            É hora de começar
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80">
            Estas datas já entraram na sua antecedência — o que ainda falta fazer?
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {agora.map((o) => {
              const feitas = o.tarefas.filter((t) => t.feita).length;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setAbertaId(o.id)}
                  className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-left transition hover:border-amber-300 hover:shadow-card"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{o.titulo}</span>
                    <span className="shrink-0 text-xs font-medium text-amber-700">
                      {o.dia === hoje ? "é hoje" : faltam(hoje, o.dia)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {curto(o.dia)} ·{" "}
                    {o.tarefas.length
                      ? `${feitas} de ${o.tarefas.length} tarefas feitas`
                      : "nenhuma tarefa ainda"}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {porMes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays />}
            title="Nenhuma data neste filtro"
            hint={
              filtro === "LANCAMENTO"
                ? "Cadastre o lançamento da próxima coleção em \"Nova data\"."
                : "Escolha outro filtro, ou crie uma data em \"Nova data\"."
            }
          />
        </Card>
      ) : (
        porMes.map(([mes, lista]) => {
          const [a, m] = mes.split("-").map(Number);
          return (
            <section key={mes}>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">
                {MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1)} de {a}
              </h2>
              <Card className="divide-y divide-slate-100 overflow-hidden">
                {lista.map((o) => (
                  <LinhaDaData
                    key={o.id}
                    o={o}
                    hoje={hoje}
                    antecedenciaDias={antecedenciaDias}
                    onAbrir={() => setAbertaId(o.id)}
                  />
                ))}
              </Card>
            </section>
          );
        })
      )}

      <p className="text-xs text-slate-400">
        Mostrando do começo deste mês até 12 meses à frente. As datas do sistema
        são calculadas todo ano (Páscoa, Carnaval, Mães, Pais e Black Friday mudam de dia sozinhas). O
        lembrete chega no sino e no celular da gerência quando a data entra na antecedência.
      </p>

      {aberta && (
        <FichaDaData
          o={aberta}
          hoje={hoje}
          antecedenciaDias={antecedenciaDias}
          onFechar={() => setAbertaId(null)}
          onMudou={() => router.refresh()}
        />
      )}
      {novaAberta && (
        <NovaData
          hoje={hoje}
          antecedenciaDias={antecedenciaDias}
          onFechar={() => setNovaAberta(false)}
          onCriou={() => {
            setNovaAberta(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SeloDoTipo({ tipo }: { tipo: TipoDaData }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${COR_DO_TIPO[tipo]}`}>
      {NOME_DO_TIPO[tipo]}
    </span>
  );
}

function textoDaSituacao(s: SituacaoDaData, o: Ocorrencia, hoje: string, daLoja: number) {
  if (s === "passou") return { texto: "já passou", cls: "text-slate-400" };
  if (s === "hoje") return { texto: "é hoje", cls: "text-rose-600 font-semibold" };
  if (s === "agora") return { texto: `hora de começar · ${faltam(hoje, o.dia)}`, cls: "text-amber-700 font-semibold" };
  return { texto: `começar em ${curto(inicioDe(o, daLoja))} · ${faltam(hoje, o.dia)}`, cls: "text-slate-500" };
}

function LinhaDaData({
  o,
  hoje,
  antecedenciaDias,
  onAbrir,
}: {
  o: Ocorrencia;
  hoje: string;
  antecedenciaDias: number;
  onAbrir: () => void;
}) {
  const s = situacaoDe(o, antecedenciaDias, hoje);
  const sit = textoDaSituacao(s, o, hoje, antecedenciaDias);
  const feitas = o.tarefas.filter((t) => t.feita).length;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
        s === "passou" ? "opacity-60" : ""
      }`}
    >
      <span className="grid w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white py-1 leading-tight">
        <span className="text-base font-semibold tabular-nums text-slate-800">{o.dia.slice(8, 10)}</span>
        <span className="text-[10px] uppercase text-slate-400">{SEMANA_CURTA[diaDaSemana(o.dia)]}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-800">{o.titulo}</span>
          <SeloDoTipo tipo={o.tipo} />
        </span>
        <span className={`mt-0.5 block text-xs ${sit.cls}`}>{sit.texto}</span>
        {o.segmentos.length > 0 && (
          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{o.segmentos.join(" · ")}</span>
        )}
      </span>
      {o.tarefas.length > 0 && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            feitas === o.tarefas.length ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {feitas}/{o.tarefas.length}
        </span>
      )}
    </button>
  );
}

/** A casca das janelas do calendário (par --kb/--kbtop: varredura do build). */
function Janela({
  titulo,
  onFechar,
  children,
}: {
  titulo: React.ReactNode;
  onFechar: () => void;
  children: React.ReactNode;
}) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center pb-[var(--kb,0px)] translate-y-[var(--kbtop,0px)]">
        <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onFechar} />
        <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-lg max-h-[85dvh] overflow-y-auto thin-scroll p-5 animate-fade-up">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">{titulo}</div>
            <button type="button" onClick={onFechar} className="text-slate-400 hover:text-slate-600" title="Fechar">
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </Portal>
  );
}

function FichaDaData({
  o,
  hoje,
  antecedenciaDias,
  onFechar,
  onMudou,
}: {
  o: Ocorrencia;
  hoje: string;
  antecedenciaDias: number;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [notas, setNotas] = useState(o.notas);
  const [antecedencia, setAntecedencia] = useState(
    o.antecedenciaPropria === null ? "" : String(o.antecedenciaPropria)
  );
  const [novaTarefa, setNovaTarefa] = useState("");
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(o.titulo);
  const [dia, setDia] = useState(o.dia);
  const [tipo, setTipo] = useState<TipoDaData>(o.tipo);
  const doSistema = o.chaveSistema !== null;
  const s = situacaoDe(o, antecedenciaDias, hoje);
  const sit = textoDaSituacao(s, o, hoje, antecedenciaDias);

  /** A data do sistema só ganha linha no banco quando alguém anota. */
  async function garantirEvento(): Promise<string | null> {
    if (o.eventoId) return o.eventoId;
    const r = await chamar("/api/calendario/eventos", "POST", { chaveSistema: o.chaveSistema, ano: o.ano });
    if (!r.ok) {
      setErro(r.erro);
      return null;
    }
    return r.data.id ?? null;
  }

  async function executar(fn: () => Promise<boolean>) {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      if (await fn()) onMudou();
    } finally {
      setOcupado(false);
    }
  }

  const salvarEvento = (body: Record<string, unknown>) =>
    executar(async () => {
      const id = await garantirEvento();
      if (!id) return false;
      const r = await chamar(`/api/calendario/eventos/${id}`, "PATCH", body);
      if (!r.ok) setErro(r.erro);
      return r.ok;
    });

  function salvarAntecedencia(usarDaLoja: boolean) {
    if (usarDaLoja) {
      setAntecedencia("");
      return salvarEvento({ antecedenciaDias: null });
    }
    const n = Number(antecedencia);
    if (antecedencia.trim() === "" || !Number.isInteger(n) || n < 0 || n > LIMITES.antecedenciaMax) {
      setErro(`Antecedência em dias inteiros, de 0 a ${LIMITES.antecedenciaMax}.`);
      return;
    }
    return salvarEvento({ antecedenciaDias: n });
  }

  const adicionarTarefa = () =>
    executar(async () => {
      const texto = novaTarefa.trim();
      if (!texto) return false;
      const id = await garantirEvento();
      if (!id) return false;
      const r = await chamar(`/api/calendario/eventos/${id}/tarefas`, "POST", { texto });
      if (!r.ok) {
        setErro(r.erro);
        return false;
      }
      setNovaTarefa("");
      return true;
    });

  const marcar = (tarefaId: string, feita: boolean) =>
    executar(async () => {
      const r = await chamar(`/api/calendario/tarefas/${tarefaId}`, "PATCH", { feita });
      if (!r.ok) setErro(r.erro);
      return r.ok;
    });

  const apagarTarefa = (tarefaId: string) =>
    executar(async () => {
      const r = await chamar(`/api/calendario/tarefas/${tarefaId}`, "DELETE");
      if (!r.ok) setErro(r.erro);
      return r.ok;
    });

  const salvarEdicao = () =>
    executar(async () => {
      const r = await chamar(`/api/calendario/eventos/${o.eventoId}`, "PATCH", { titulo, dia, tipo });
      if (!r.ok) {
        setErro(r.erro);
        return false;
      }
      setEditando(false);
      return true;
    });

  const apagar = () =>
    executar(async () => {
      if (!window.confirm(`Apagar "${o.titulo}" do calendário? As notas e tarefas dela vão junto.`)) return false;
      const r = await chamar(`/api/calendario/eventos/${o.eventoId}`, "DELETE");
      if (!r.ok) {
        setErro(r.erro);
        return false;
      }
      onFechar();
      return true;
    });

  const esconder = () =>
    executar(async () => {
      if (
        !window.confirm(
          `Esconder "${o.titulo}" do calendário? Ela some de todos os anos — dá para mostrar de novo em Preferências.`
        )
      )
        return false;
      const r = await chamar("/api/calendario/config", "PATCH", { ocultar: o.chaveSistema });
      if (!r.ok) {
        setErro(r.erro);
        return false;
      }
      onFechar();
      return true;
    });

  const ant = antecedenciaDe(o, antecedenciaDias);
  const notasMudaram = notas.trim() !== o.notas.trim();

  return (
    <Janela
      onFechar={onFechar}
      titulo={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{o.titulo}</h3>
            <SeloDoTipo tipo={o.tipo} />
          </div>
          <p className="mt-0.5 text-sm text-slate-500">{longo(o.dia)}</p>
          <p className={`mt-0.5 text-xs ${sit.cls}`}>{sit.texto}</p>
        </>
      }
    >
      <div className="space-y-5">
        {o.dica && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{o.dica}</p>}
        {o.segmentos.length > 0 && (
          <p className="text-xs text-slate-500">Entrou pelos segmentos: {o.segmentos.join(", ")}</p>
        )}

        {editando && !doSistema && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-3">
            <Field label="Nome">
              <input className={inputCls} value={titulo} maxLength={LIMITES.titulo} onChange={(e) => setTitulo(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data">
                <input
                  type="date"
                  className={inputCls}
                  min={intervaloDaTela(hoje).de}
                  max={intervaloDaTela(hoje).ate}
                  value={dia}
                  onChange={(e) => setDia(e.target.value)}
                />
              </Field>
              <Field label="Tipo">
                <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoDaData)}>
                  <option value="LANCAMENTO">Lançamento</option>
                  <option value="COMERCIAL">Comercial</option>
                  <option value="OPORTUNIDADE">Oportunidade</option>
                </select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={salvarEdicao} disabled={ocupado}>
                Salvar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Antecedência</p>
          <p className="mb-2 text-xs text-slate-500">
            Começar {ant === 0 ? "no próprio dia" : `${ant} dias antes`} — em {curto(inicioDe(o, antecedenciaDias))}.{" "}
            {o.antecedenciaPropria === null
              ? `É a antecedência da loja (${antecedenciaDias} dias).`
              : "Esta data tem antecedência própria."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={LIMITES.antecedenciaMax}
              className={`${inputCls} max-w-[7rem]`}
              placeholder={String(antecedenciaDias)}
              value={antecedencia}
              onChange={(e) => setAntecedencia(e.target.value)}
            />
            <span className="text-sm text-slate-500">dias antes</span>
            <Button size="sm" variant="secondary" onClick={() => salvarAntecedencia(false)} disabled={ocupado}>
              Salvar
            </Button>
            {o.antecedenciaPropria !== null && (
              <Button size="sm" variant="ghost" onClick={() => salvarAntecedencia(true)} disabled={ocupado}>
                Usar a da loja
              </Button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Anotações</p>
          <textarea
            className={`${inputCls} min-h-[88px]`}
            maxLength={LIMITES.notas}
            placeholder="Ideias, peças que vão entrar, o combinado com a produção…"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
          {notasMudaram && (
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={() => salvarEvento({ notas })} disabled={ocupado}>
                Salvar anotações
              </Button>
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Tarefas para a data acontecer</p>
          {o.tarefas.length === 0 && (
            <p className="mb-2 text-xs text-slate-400">Ex.: “Fechar as peças com a produção”, “Fotos da coleção”, “Mandar o catálogo para as clientes”.</p>
          )}
          <ul className="mb-2 space-y-1.5">
            {o.tarefas.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => marcar(t.id, !t.feita)}
                  disabled={ocupado}
                  aria-label={t.feita ? "Desmarcar tarefa" : "Marcar como feita"}
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition ${
                    t.feita ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {t.feita && <Check className="size-3.5" />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${t.feita ? "text-slate-400 line-through" : "text-slate-700"}`}>
                    {t.texto}
                  </span>
                  {t.feita && t.feitaPorNome && (
                    <span className="block text-[11px] text-slate-400">feita por {t.feitaPorNome}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => apagarTarefa(t.id)}
                  disabled={ocupado}
                  aria-label="Apagar tarefa"
                  className="text-slate-300 hover:text-rose-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void adicionarTarefa();
            }}
          >
            <input
              className={inputCls}
              maxLength={LIMITES.tarefa}
              placeholder="Nova tarefa"
              value={novaTarefa}
              onChange={(e) => setNovaTarefa(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={ocupado || !novaTarefa.trim()}>
              <Plus className="size-3.5" />
              Adicionar
            </Button>
          </form>
        </div>

        {erro && <p className="text-xs font-medium text-rose-600">{erro}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {ocupado && <Loader2 className="size-4 animate-spin text-slate-400" />}
          {doSistema ? (
            <Button size="sm" variant="ghost" onClick={esconder} disabled={ocupado}>
              <EyeOff className="size-3.5" />
              Esconder esta data
            </Button>
          ) : (
            <>
              {!editando && (
                <Button size="sm" variant="secondary" onClick={() => setEditando(true)}>
                  Editar nome e data
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={apagar} disabled={ocupado} className="text-rose-600">
                <Trash2 className="size-3.5" />
                Apagar
              </Button>
            </>
          )}
        </div>
      </div>
    </Janela>
  );
}

function NovaData({
  hoje,
  antecedenciaDias,
  onFechar,
  onCriou,
}: {
  hoje: string;
  antecedenciaDias: number;
  onFechar: () => void;
  onCriou: () => void;
}) {
  const [tipo, setTipo] = useState<TipoDaData>("LANCAMENTO");
  const [titulo, setTitulo] = useState("");
  const [dia, setDia] = useState("");
  const [antecedencia, setAntecedencia] = useState("");
  const [notas, setNotas] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function criar() {
    if (salvando) return;
    if (!titulo.trim()) return setErro("Dê um nome para a data (ex.: \"Lançamento coleção Verão 2027\").");
    if (!dia) return setErro("Escolha o dia.");
    let ant: number | null = null;
    if (antecedencia.trim() !== "") {
      const n = Number(antecedencia);
      if (!Number.isInteger(n) || n < 0 || n > LIMITES.antecedenciaMax) {
        return setErro(`Antecedência em dias inteiros, de 0 a ${LIMITES.antecedenciaMax}.`);
      }
      ant = n;
    }
    setSalvando(true);
    setErro("");
    const r = await chamar("/api/calendario/eventos", "POST", {
      tipo,
      titulo: titulo.trim(),
      dia,
      antecedenciaDias: ant,
      notas,
    });
    setSalvando(false);
    if (!r.ok) return setErro(r.erro);
    onCriou();
  }

  return (
    <Janela
      onFechar={onFechar}
      titulo={
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <CalendarPlus className="size-4 text-brand-600" />
          Nova data
        </h3>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
      >
        <Field label="Tipo">
          <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoDaData)}>
            <option value="LANCAMENTO">Lançamento (coleção ou modelo novo)</option>
            <option value="COMERCIAL">Data comercial da loja</option>
            <option value="OPORTUNIDADE">Oportunidade (evento, feira, data local)</option>
          </select>
        </Field>
        <Field label="Nome">
          <input
            className={inputCls}
            maxLength={LIMITES.titulo}
            placeholder={tipo === "LANCAMENTO" ? "Lançamento coleção Verão 2027" : "Aniversário da loja"}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia">
            <input
              type="date"
              className={inputCls}
              min={intervaloDaTela(hoje).de}
              max={intervaloDaTela(hoje).ate}
              value={dia}
              onChange={(e) => setDia(e.target.value)}
            />
          </Field>
          <Field label="Antecedência (dias)" hint={`Vazio = a da loja (${antecedenciaDias})`}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={LIMITES.antecedenciaMax}
              className={inputCls}
              placeholder={String(antecedenciaDias)}
              value={antecedencia}
              onChange={(e) => setAntecedencia(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Anotações (opcional)">
          <textarea
            className={`${inputCls} min-h-[72px]`}
            maxLength={LIMITES.notas}
            placeholder="Peças, fornecedores, ideias de divulgação…"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </Field>
        <p className="text-xs text-slate-400">As tarefas você cria depois, abrindo a data no calendário.</p>
        {erro && <p className="text-xs font-medium text-rose-600">{erro}</p>}
        <Button type="submit" className="w-full" disabled={salvando}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
          Criar data
        </Button>
      </form>
    </Janela>
  );
}

function Preferencias({
  antecedenciaDias,
  segmentosDaLoja,
  segmentos,
  ocultas,
  onMudou,
  onFechar,
}: {
  antecedenciaDias: number;
  segmentosDaLoja: string[];
  segmentos: Props["segmentos"];
  ocultas: Props["ocultas"];
  onMudou: () => void;
  onFechar: () => void;
}) {
  const [antecedencia, setAntecedencia] = useState(String(antecedenciaDias));
  const [escolhidos, setEscolhidos] = useState<string[]>(segmentosDaLoja);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [verDatas, setVerDatas] = useState<string | null>(null);

  async function salvar(body: Record<string, unknown>, mensagem: string) {
    setOcupado(true);
    setErro("");
    setOk("");
    const r = await chamar("/api/calendario/config", "PATCH", body);
    setOcupado(false);
    if (!r.ok) {
      setErro(r.erro);
      return false;
    }
    setOk(mensagem);
    onMudou();
    return true;
  }

  async function alternarSegmento(chave: string) {
    if (ocupado) return;
    const antes = escolhidos;
    const depois = antes.includes(chave) ? antes.filter((c) => c !== chave) : [...antes, chave];
    setEscolhidos(depois);
    if (!(await salvar({ segmentos: depois }, "Segmentos salvos."))) setEscolhidos(antes);
  }

  function salvarAntecedencia() {
    const n = Number(antecedencia);
    if (antecedencia.trim() === "" || !Number.isInteger(n) || n < 0 || n > LIMITES.antecedenciaMax) {
      setErro(`Antecedência em dias inteiros, de 0 a ${LIMITES.antecedenciaMax}.`);
      return;
    }
    void salvar({ antecedenciaDias: n }, "Antecedência salva.");
  }

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Preferências do calendário</p>
        <button type="button" onClick={onFechar} className="text-slate-400 hover:text-slate-600" title="Fechar">
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-slate-700">Antecedência da loja</p>
        <p className="mb-2 text-xs text-slate-500">
          Quantos dias antes de cada data você quer começar a se preparar (produzir, fotografar, oferecer). No
          atacado costuma ser 45 a 60 dias; no varejo, menos. Cada data também pode ter a sua.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={LIMITES.antecedenciaMax}
            className={`${inputCls} max-w-[7rem]`}
            value={antecedencia}
            onChange={(e) => setAntecedencia(e.target.value)}
          />
          <span className="text-sm text-slate-500">dias antes</span>
          <Button size="sm" variant="secondary" onClick={salvarAntecedencia} disabled={ocupado}>
            Salvar
          </Button>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-sm font-medium text-slate-700">Segmentos da loja</p>
        <p className="mb-2 text-xs text-slate-500">
          Marque o que a loja vende: cada segmento traz as datas de oportunidade daquele público.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {segmentos.map((s) => {
            const marcado = escolhidos.includes(s.chave);
            return (
              <span key={s.chave} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => alternarSegmento(s.chave)}
                  disabled={ocupado}
                  aria-pressed={marcado}
                  className={`rounded-l-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                    marcado
                      ? "border-violet-500 bg-violet-500 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {marcado && <Check className="mr-1 inline size-3" />}
                  {s.nome}
                </button>
                <button
                  type="button"
                  onClick={() => setVerDatas(verDatas === s.chave ? null : s.chave)}
                  aria-label={`Ver as datas de ${s.nome}`}
                  className={`rounded-r-full border border-l-0 px-1.5 py-1.5 text-xs transition ${
                    marcado ? "border-violet-500 bg-violet-500 text-white/80" : "border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  <ChevronDown className={`size-3 transition ${verDatas === s.chave ? "rotate-180" : ""}`} />
                </button>
              </span>
            );
          })}
        </div>
        {verDatas && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {segmentos.find((s) => s.chave === verDatas)?.nome}: {segmentos.find((s) => s.chave === verDatas)?.datas.join(", ")}
          </p>
        )}
      </div>

      {ocultas.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-medium text-slate-700">Datas escondidas</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ocultas.map((o) => (
              <button
                key={o.chave}
                type="button"
                onClick={() => void salvar({ mostrar: o.chave }, `"${o.titulo}" voltou ao calendário.`)}
                disabled={ocupado}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300"
              >
                <Eye className="size-3" />
                Mostrar {o.titulo}
              </button>
            ))}
          </div>
        </div>
      )}

      {(erro || ok) && (
        <p className={`mt-3 text-xs font-medium ${erro ? "text-rose-600" : "text-emerald-600"}`}>{erro || ok}</p>
      )}
    </Card>
  );
}
