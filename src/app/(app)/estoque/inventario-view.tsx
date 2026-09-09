"use client";

/**
 * INVENTÁRIO (RN-050) — a tela de contar e acertar estoque.
 *
 * O gesto é o da Nuvemshop, que a lojista já conhece: clica no número,
 * digita o novo, confirma. O que é NOSSO por cima disso: o MOTIVO (vai para
 * o histórico com quem e quando), o RESERVADO ao lado (peça em pedido que
 * ainda está na loja) e a trava do dono externo — peça da Nuvemshop/Jueri
 * mostra cadeado e o caminho para sincronizar, nunca um campo que "aceita e
 * depois volta".
 *
 * O número que se edita é o DISPONÍVEL para vender (é o `stock` da peça —
 * o mesmo que a tela Produtos e o catálogo usam). A reserva do pedido já
 * está descontada dele, então "em estoque" = disponível + reservado.
 *
 * DESENHO PARA O CELULAR (achados da revisão de telas, 09/09/2026): o
 * motivo e o mínimo abrem como LINHA extra debaixo da peça — popover
 * absoluto dentro da tabela com rolagem era cortado na última linha e
 * sumia atrás do teclado; o histórico vai para o <Portal> (senão fica
 * atrás da barra de baixo); só UM editor fica aberto por vez; e a tabela
 * tem largura mínima para ROLAR de lado em vez de espremer o nome da peça.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  History,
  Lock,
  Package,
  Pencil,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Alert, EmptyState, Spinner } from "@/components/ui";
import { Portal } from "@/components/portal";
import { DICA_DO_DONO, NOME_DO_DONO, type DonoExterno } from "@/lib/estoque/dono-do-estoque";
import { ROTULO_DA_ORIGEM } from "@/lib/estoque/minimos-regra";
import type { FiltroDoInventario, Inventario, LinhaDoInventario } from "@/lib/estoque/inventario";

type Resposta = Omit<Inventario, "resumo" | "categorias"> & {
  resumo: Inventario["resumo"] | null;
  categorias: string[] | null;
  podeAjustar: boolean;
  podeSincronizar: boolean;
};

type Movimento = {
  id: string;
  tipo: "ENTRADA" | "SAIDA" | "AJUSTE";
  quantidade: number;
  motivo: string;
  quando: string;
  pedido: { id: string; numero: number | null } | null;
};

const FILTROS: { id: FiltroDoInventario; rotulo: string }[] = [
  { id: "todos", rotulo: "Todas" },
  { id: "baixo", rotulo: "No mínimo" },
  { id: "zerado", rotulo: "Zeradas" },
  { id: "reservado", rotulo: "Com reserva" },
  { id: "externo", rotulo: "Controladas por integração" },
];

/** Motivos de um toque — o de sempre da contagem. Texto livre também vale. */
const MOTIVOS_RAPIDOS = ["Contagem", "Avaria", "Devolução", "Entrada de mercadoria", "Brinde", "Perda"];

const SEM_CONEXAO = "Sem conexão com o servidor. Confira a internet e tente de novo.";

/**
 * Uma chamada à API que NUNCA lança: rede caindo (o 4G da loja) virava
 * spinner eterno e botão travado em "…" — achado da revisão.
 */
async function chamar<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; dados: T & { error?: string } }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const dados = ((await res.json().catch(() => ({}))) ?? {}) as T & { error?: string };
    return { ok: res.ok, status: res.status, dados };
  } catch {
    return { ok: false, status: 0, dados: { error: SEM_CONEXAO } as T & { error?: string } };
  }
}

/** Qual editor está aberto (um só por vez — dois abertos se tampavam). */
type EditorAberto = { variantId: string; tipo: "estoque" | "minimo" } | null;

export function InventarioView({ filtroInicial = "todos" }: { filtroInicial?: FiltroDoInventario }) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState("");
  // o sino manda para cá com ?filtro=baixo (RN-051)
  const [filtro, setFiltro] = useState<FiltroDoInventario>(filtroInicial);
  const [inativos, setInativos] = useState(false);
  const [historicoDe, setHistoricoDe] = useState<LinhaDoInventario | null>(null);
  const [sync, setSync] = useState<{ ocupado: boolean; msg: string }>({ ocupado: false, msg: "" });
  const [aberto, setAberto] = useState<EditorAberto>(null);

  // resposta antiga não atropela a nova: cada pedido leva um número e só o
  // último vale (digitou "vestido", apagou; a busca lenta chegava depois e a
  // lista ficava filtrada com a caixa vazia — achado da revisão)
  const sequencia = useRef(0);
  const carregar = useCallback(async () => {
    const meu = ++sequencia.current;
    setCarregando(true);
    setErro("");
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (categoria) sp.set("categoria", categoria);
    if (filtro !== "todos") sp.set("filtro", filtro);
    if (inativos) sp.set("inativos", "1");
    // depois da primeira carga só a lista viaja: o resumo é da loja inteira
    // e não muda com a busca — e é a parte cara (achado da revisão)
    const temResumo = Boolean(dadosRef.current?.resumo) && !recarregarResumo.current;
    if (temResumo) sp.set("so", "lista");
    const r = await chamar<Resposta>(`/api/estoque/inventario?${sp}`);
    if (meu !== sequencia.current) return;
    setCarregando(false);
    if (!r.ok) {
      setErro(r.dados.error ?? "Não foi possível carregar o inventário.");
      return;
    }
    recarregarResumo.current = false;
    setDados((antes) => ({
      ...r.dados,
      resumo: r.dados.resumo ?? antes?.resumo ?? null,
      categorias: r.dados.categorias ?? antes?.categorias ?? null,
    }));
  }, [q, categoria, filtro, inativos]);
  const dadosRef = useRef<Resposta | null>(null);
  dadosRef.current = dados;
  /** ajuste/mínimo salvo: o resumo mudou — a próxima carga pede ele de novo */
  const recarregarResumo = useRef(false);
  const recarregarTudo = useCallback(() => {
    recarregarResumo.current = true;
    return carregar();
  }, [carregar]);

  // a busca espera a pessoa parar de digitar (300ms) — cada tecla batendo no
  // servidor numa loja com milhares de variações seria lento e inútil
  useEffect(() => {
    const t = setTimeout(carregar, 300);
    return () => clearTimeout(t);
  }, [carregar]);

  /**
   * A linha ajustada mostra o número novo na hora; em seguida a lista
   * recarrega, porque os cards de resumo e o filtro ("Zeradas") são da loja
   * inteira e ficariam mentindo (achado da revisão).
   */
  function aplicarNaLinha(variantId: string, estoque: number) {
    setDados((d) => {
      if (!d) return d;
      const linhas = d.linhas.map((l) =>
        l.variantId === variantId
          ? { ...l, disponivel: estoque, emEstoque: estoque + l.reservado }
          : l
      );
      return { ...d, linhas };
    });
  }

  /** Sincroniza com a Nuvemshop pela MESMA porta em etapas da tela Configurações. */
  async function sincronizar() {
    if (sync.ocupado) return;
    setSync({ ocupado: true, msg: "Sincronizando com a Nuvemshop…" });
    let total = 0;
    for (let page = 1; page <= 200; page++) {
      const r = await chamar<{ produtos?: number; fim?: boolean }>("/api/nuvemshop/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page }),
      });
      if (!r.ok) {
        setSync({ ocupado: false, msg: r.dados.error ?? "A Nuvemshop não respondeu. Tente de novo em instantes." });
        return;
      }
      total += r.dados.produtos ?? 0;
      setSync({ ocupado: true, msg: `Sincronizando… ${total} produtos conferidos` });
      if (r.dados.fim) break;
    }
    setSync({ ocupado: false, msg: `Sincronizado: ${total} produtos conferidos com a Nuvemshop.` });
    recarregarTudo();
  }

  const resumo = dados?.resumo;
  const cortada = dados ? dados.total > dados.linhas.length : false;

  return (
    <div className="space-y-4">
      {/* resumo da loja inteira — não muda com o filtro */}
      {resumo && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <Numero rotulo="Peças na loja" valor={resumo.pecas} hint="disponíveis + reservadas" />
          <Numero rotulo="Disponíveis" valor={resumo.disponiveis} hint="para vender agora" tom="emerald" />
          <Numero rotulo="Reservadas" valor={resumo.reservadas} hint="em pedido, ainda aqui" tom="amber" />
          <Numero rotulo="Variações" valor={resumo.variacoes} hint="cor × tamanho" />
          <Numero
            rotulo="No mínimo"
            valor={resumo.baixas}
            hint={`${resumo.zeradas} zeradas`}
            tom={resumo.baixas > 0 ? "amber" : undefined}
          />
          <Numero rotulo="Por integração" valor={resumo.externas} hint="Nuvemshop / Jueri" />
        </div>
      )}

      {/* barra de busca e filtros */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, código, SKU ou tag…"
            aria-label="Buscar peça"
            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400"
          />
        </label>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          aria-label="Categoria"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
        >
          <option value="">Todas as categorias</option>
          {(dados?.categorias ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 select-none">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} />
          incluir produtos inativos
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filtro === f.id
                ? "border-brand-300 bg-brand-50 text-brand-800"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
        {/* só a Nuvemshop tem sync sob demanda; o Jueri roda sozinho (cron) */}
        {dados?.podeSincronizar && (resumo?.nuvemshop ?? 0) > 0 && (
          <button
            type="button"
            onClick={sincronizar}
            disabled={sync.ocupado}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50"
            title="Busca na Nuvemshop o estoque das peças que ela controla"
          >
            <RefreshCw className={`size-3.5 ${sync.ocupado ? "animate-spin" : ""}`} />
            Sincronizar com a Nuvemshop
          </button>
        )}
      </div>
      {sync.msg && <p className="text-xs text-slate-500">{sync.msg}</p>}

      {erro && (
        <Alert tone="danger" icon={<AlertTriangle />}>
          {erro}{" "}
          <button type="button" onClick={carregar} className="underline">
            tentar de novo
          </button>
        </Alert>
      )}

      {dados && !dados.podeAjustar && (
        <p className="text-xs text-slate-400">
          Você vê o estoque; quem ajusta é gerente ou admin.
        </p>
      )}

      {cortada && (
        <Alert tone="warning" icon={<AlertTriangle />}>
          Mostrando {dados!.linhas.length} de {dados!.total} variações. Refine a busca ou o filtro
          para ver o resto.
        </Alert>
      )}

      {/* a lista */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {carregando && !dados ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Spinner />
          </div>
        ) : dados && dados.linhas.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title="Nenhuma variação aqui"
            hint={
              q || categoria || filtro !== "todos"
                ? "Nada casa com a busca ou o filtro escolhido."
                : "Cadastre produtos com grade (cor × tamanho) na tela Produtos e elas aparecem aqui."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Produto</th>
                  <th className="text-left px-3 py-2 font-medium">Cor</th>
                  <th className="text-left px-3 py-2 font-medium">Tam.</th>
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-right px-3 py-2 font-medium" title="disponíveis + reservadas">
                    Na loja
                  </th>
                  <th className="text-right px-3 py-2 font-medium" title="em pedido que ainda não saiu da loja (orçamento, aguardando pagamento, pago, em produção ou separação)">
                    Reservado
                  </th>
                  <th className="text-right px-3 py-2 font-medium">Disponível</th>
                  <th className="text-right px-3 py-2 font-medium" title="mínimo que vale para esta peça: da peça, da categoria ou da loja (RN-051)">
                    Mín.
                  </th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className={carregando ? "opacity-60" : ""}>
                {dados?.linhas.map((l) => (
                  <Linha
                    key={l.variantId}
                    l={l}
                    podeAjustar={dados.podeAjustar}
                    aberto={aberto?.variantId === l.variantId ? aberto.tipo : null}
                    onAbrir={(tipo) => setAberto(tipo ? { variantId: l.variantId, tipo } : null)}
                    onAjustado={aplicarNaLinha}
                    onRecarregar={recarregarTudo}
                    onHistorico={() => setHistoricoDe(l)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historicoDe && <Historico linha={historicoDe} onFechar={() => setHistoricoDe(null)} />}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  hint,
  tom,
}: {
  rotulo: string;
  valor: number;
  hint?: string;
  tom?: "emerald" | "amber" | "rose";
}) {
  const cor =
    tom === "emerald"
      ? "text-emerald-700"
      : tom === "amber"
        ? "text-amber-700"
        : tom === "rose"
          ? "text-rose-700"
          : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`text-lg font-semibold tabular-nums ${cor}`}>{valor.toLocaleString("pt-BR")}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------- uma linha */

function Linha({
  l,
  podeAjustar,
  aberto,
  onAbrir,
  onAjustado,
  onRecarregar,
  onHistorico,
}: {
  l: LinhaDoInventario;
  podeAjustar: boolean;
  aberto: "estoque" | "minimo" | null;
  onAbrir: (tipo: "estoque" | "minimo" | null) => void;
  onAjustado: (variantId: string, estoque: number) => void;
  onRecarregar: () => void;
  onHistorico: () => void;
}) {
  const editavel = podeAjustar && !l.dono;
  const noMinimo = l.disponivel <= l.minimo;
  // amarelo = chegou ao mínimo DELA (peça > categoria > loja, RN-051); o
  // "⚠" ao lado é a pista para quem não distingue a cor
  const corDoNumero =
    l.disponivel === 0 ? "text-rose-600" : noMinimo ? "text-amber-600" : "text-slate-900";
  const rotuloDaPeca = [l.produto, l.cor, l.tamanho].filter(Boolean).join(" · ");

  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50/60">
        <td className="px-3 py-2 min-w-[180px]">
          <div className="font-medium text-slate-800 leading-tight">
            {l.produto}
            {!l.ativo && <span className="ml-1.5 text-[10px] text-slate-400">(inativo)</span>}
          </div>
          <div className="text-[11px] text-slate-400">{l.categoria}</div>
        </td>
        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{l.cor}</td>
        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{l.tamanho}</td>
        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{l.sku}</td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{l.emEstoque}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {l.reservado > 0 ? (
            <span className="text-amber-700">{l.reservado}</span>
          ) : (
            <span className="text-slate-300">0</span>
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {noMinimo && <span className="mr-1 text-[10px] text-amber-600" title="chegou ao mínimo">⚠</span>}
          {editavel ? (
            <button
              type="button"
              onClick={() => onAbrir(aberto === "estoque" ? null : "estoque")}
              aria-label={`Ajustar estoque de ${rotuloDaPeca}`}
              title="Ajustar o disponível desta peça"
              className={`inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-0.5 tabular-nums hover:border-brand-400 hover:bg-white ${corDoNumero} ${
                aberto === "estoque" ? "border-brand-400 bg-brand-50" : ""
              }`}
            >
              {l.disponivel}
              <Pencil className="size-3 text-slate-400" />
            </button>
          ) : l.dono ? (
            <span
              className="inline-flex items-center justify-end gap-1 tabular-nums text-slate-700"
              title={DICA_DO_DONO[l.dono]}
            >
              <Lock className="size-3 text-slate-400" />
              <span className={corDoNumero}>{l.disponivel}</span>
              <DonoBadge dono={l.dono} />
            </span>
          ) : (
            <span className={`tabular-nums ${corDoNumero}`}>{l.disponivel}</span>
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <RotuloDoMinimo
            linha={l}
            editavel={podeAjustar}
            aberto={aberto === "minimo"}
            onAbrir={() => onAbrir(aberto === "minimo" ? null : "minimo")}
          />
        </td>
        <td className="px-2 py-2 text-right">
          <button
            type="button"
            onClick={onHistorico}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            title="Histórico desta peça"
            aria-label={`Histórico de ${rotuloDaPeca}`}
          >
            <History className="size-4" />
          </button>
        </td>
      </tr>
      {aberto === "estoque" && editavel && (
        <LinhaDeAjuste
          linha={l}
          rotulo={rotuloDaPeca}
          onFechar={() => onAbrir(null)}
          onAjustado={(estoque) => {
            onAjustado(l.variantId, estoque);
            onAbrir(null);
            onRecarregar();
          }}
        />
      )}
      {aberto === "minimo" && podeAjustar && (
        <LinhaDeMinimo
          linha={l}
          onFechar={() => onAbrir(null)}
          onSalvo={() => {
            onAbrir(null);
            onRecarregar();
          }}
        />
      )}
    </>
  );
}

function DonoBadge({ dono }: { dono: DonoExterno }) {
  return (
    <span className="ml-1 rounded-full bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100 px-1.5 py-0.5 text-[10px] font-medium">
      {NOME_DO_DONO[dono]}
    </span>
  );
}

/* ---------------------------------------------------- o ajuste (linha extra) */

/**
 * Digita → escolhe o motivo → salva. Abre como LINHA debaixo da peça: nunca
 * é cortada pela rolagem da tabela e cabe em 360px. O número enviado é o
 * que a pessoa VIU (a porta grava condicional a ele): se outra pessoa mexeu
 * no meio, a resposta pede para conferir e a linha já mostra o atual.
 */
function LinhaDeAjuste({
  linha,
  rotulo,
  onFechar,
  onAjustado,
}: {
  linha: LinhaDoInventario;
  rotulo: string;
  onFechar: () => void;
  onAjustado: (estoque: number) => void;
}) {
  const [valor, setValor] = useState(String(linha.disponivel));
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [visto, setVisto] = useState(linha.disponivel);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // o clique da pessoa abriu a linha: o foco no número é o gesto esperado
    inputRef.current?.select();
  }, []);

  const novo = valor === "" ? NaN : parseInt(valor, 10);
  const valido = Number.isInteger(novo) && novo >= 0;
  const mudou = valido && novo !== visto;

  async function salvar(motivoEscolhido: string) {
    if (salvando) return;
    if (!valido) {
      setErro("Digite um número (0 se zerou).");
      return;
    }
    if (!mudou) return onFechar();
    setSalvando(true);
    setErro("");
    const r = await chamar<{ estoque: number; estoqueAtual?: number }>(
      `/api/estoque/variacoes/${linha.variantId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estoque: novo, visto, motivo: motivoEscolhido }),
      }
    );
    setSalvando(false);
    if (!r.ok) {
      setErro(r.dados.error ?? "Não foi possível salvar.");
      // o número já mudou no banco (colega, venda): a linha passa a mostrar o atual
      if (r.status === 409 && typeof r.dados.estoqueAtual === "number") setVisto(r.dados.estoqueAtual);
      return;
    }
    onAjustado(r.dados.estoque);
  }

  return (
    <tr className="bg-brand-50/40 border-t border-brand-100">
      <td colSpan={9} className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium text-slate-700">{rotulo}</span>
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            {visto} →
            <input
              ref={inputRef}
              value={valor}
              onChange={(e) => {
                setValor(e.target.value.replace(/\D/g, ""));
                setErro("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") onFechar();
              }}
              inputMode="numeric"
              aria-label="Novo disponível"
              className="w-16 rounded-lg border border-brand-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums outline-none"
              disabled={salvando}
            />
          </span>
          <span className="text-xs text-slate-500">motivo:</span>
          <div className="flex flex-wrap gap-1">
            {MOTIVOS_RAPIDOS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={salvando || !mudou}
                onClick={() => salvar(m)}
                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && motivo.trim()) salvar(motivo);
                if (e.key === "Escape") onFechar();
              }}
              placeholder="ou escreva o motivo…"
              maxLength={120}
              aria-label="Motivo do ajuste"
              className="w-44 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand-400"
              disabled={salvando}
            />
            <button
              type="button"
              disabled={salvando || !motivo.trim() || !mudou}
              onClick={() => salvar(motivo)}
              className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {salvando ? "…" : "Salvar"}
            </button>
            <button
              type="button"
              onClick={onFechar}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Cancelar"
              title="Cancelar"
            >
              <X className="size-4" />
            </button>
          </div>
          {!mudou && valido && (
            <span className="text-[11px] text-slate-400">digite um número diferente de {visto}</span>
          )}
          {erro && <span className="text-[11px] text-rose-600">{erro}</span>}
        </div>
      </td>
    </tr>
  );
}

/* ---------------------------------------------------- o mínimo da peça */

function RotuloDoMinimo({
  linha,
  editavel,
  aberto,
  onAbrir,
}: {
  linha: LinhaDoInventario;
  editavel: boolean;
  aberto: boolean;
  onAbrir: () => void;
}) {
  const rotulo = (
    <span className="tabular-nums text-slate-600" title={`mínimo ${ROTULO_DA_ORIGEM[linha.origemDoMinimo]}`}>
      {linha.minimo}
      <span className="ml-1 text-[10px] text-slate-400">
        {linha.origemDoMinimo === "PECA" ? "peça" : linha.origemDoMinimo === "CATEGORIA" ? "cat." : "loja"}
      </span>
    </span>
  );
  if (!editavel) return rotulo;
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`Definir o mínimo de ${linha.produto}`}
      className={`inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-0.5 hover:border-brand-400 hover:bg-white ${
        aberto ? "border-brand-400 bg-brand-50" : ""
      }`}
      title="Definir o mínimo desta peça (vale para cada cor e tamanho do modelo)"
    >
      {rotulo}
      <Pencil className="size-3 text-slate-400" />
    </button>
  );
}

/**
 * O mínimo DA PEÇA (vale para cada cor × tamanho do modelo); em branco volta
 * a valer o da categoria/loja. Também como linha extra, pelo mesmo motivo.
 */
function LinhaDeMinimo({
  linha,
  onFechar,
  onSalvo,
}: {
  linha: LinhaDoInventario;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [valor, setValor] = useState(linha.origemDoMinimo === "PECA" ? String(linha.minimo) : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(limpar = false) {
    if (salvando) return;
    setSalvando(true);
    setErro("");
    const r = await chamar(`/api/estoque/produtos/${linha.productId}/minimo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minimo: limpar || valor === "" ? null : parseInt(valor, 10) }),
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.dados.error ?? "Não foi possível salvar.");
      return;
    }
    onSalvo();
  }

  return (
    <tr className="bg-slate-50/70 border-t border-slate-100">
      <td colSpan={9} className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium text-slate-700">Mínimo de {linha.produto}</span>
          <span className="text-[11px] text-slate-400">
            vale para cada cor e tamanho · em branco = usa o {ROTULO_DA_ORIGEM[linha.origemDoMinimo === "PECA" ? "CATEGORIA" : linha.origemDoMinimo]}
          </span>
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvar();
              if (e.key === "Escape") onFechar();
            }}
            inputMode="numeric"
            aria-label="Mínimo da peça"
            placeholder={linha.origemDoMinimo === "PECA" ? "" : String(linha.minimo)}
            className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-right tabular-nums outline-none focus:border-brand-400"
            disabled={salvando}
          />
          <button
            type="button"
            disabled={salvando}
            onClick={() => salvar()}
            className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {salvando ? "…" : "Salvar"}
          </button>
          {linha.origemDoMinimo === "PECA" && (
            <button
              type="button"
              disabled={salvando}
              onClick={() => salvar(true)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
              title="Voltar a usar o mínimo da categoria/loja"
            >
              Limpar
            </button>
          )}
          <button
            type="button"
            onClick={onFechar}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Cancelar"
            title="Cancelar"
          >
            <X className="size-4" />
          </button>
          {erro && <span className="text-[11px] text-rose-600">{erro}</span>}
        </div>
      </td>
    </tr>
  );
}

/* ---------------------------------------------------- histórico */

function Historico({ linha, onFechar }: { linha: LinhaDoInventario; onFechar: () => void }) {
  const [movs, setMovs] = useState<Movimento[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    chamar<{ movimentos: Movimento[] }>(`/api/estoque/variacoes/${linha.variantId}/movimentos`).then((r) => {
      if (!vivo) return;
      if (!r.ok) setErro(r.dados.error ?? "Não foi possível carregar o histórico.");
      else setMovs(r.dados.movimentos);
    });
    return () => {
      vivo = false;
    };
  }, [linha.variantId]);

  // Esc fecha — e o foco não fica preso atrás da janela
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onFechar]);

  const titulo = useMemo(
    () => [linha.produto, linha.cor, linha.tamanho].filter(Boolean).join(" · "),
    [linha]
  );

  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onFechar}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Histórico de ${titulo}`}
          className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
            <div>
              <p className="text-sm font-semibold text-slate-800">{titulo}</p>
              <p className="text-xs text-slate-500">
                Disponível agora: <b className="tabular-nums">{linha.disponivel}</b> · reservado:{" "}
                <b className="tabular-nums">{linha.reservado}</b>
                {linha.dono && (
                  <>
                    {" "}
                    · <DonoBadge dono={linha.dono} />
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onFechar}
              className="p-1 text-slate-400 hover:text-slate-700"
              aria-label="Fechar"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="px-4 py-3">
            {erro && <p className="text-xs text-rose-600">{erro}</p>}
            {!movs && !erro && (
              <div className="flex justify-center py-6 text-slate-400">
                <Spinner />
              </div>
            )}
            {movs && movs.length === 0 && (
              <p className="text-xs text-slate-400 py-4 text-center">Nenhum movimento registrado ainda.</p>
            )}
            {movs && movs.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {movs.map((m) => (
                  <li key={m.id} className="py-2 flex items-start gap-2 text-xs">
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${
                        m.tipo === "ENTRADA"
                          ? "bg-emerald-50 text-emerald-700"
                          : m.tipo === "SAIDA"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {m.tipo === "ENTRADA" ? "+" : m.tipo === "SAIDA" ? "−" : "±"}
                      {m.quantidade}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-700 break-words">{m.motivo || "—"}</p>
                      <p className="text-[11px] text-slate-400">
                        {new Date(m.quando).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.pedido && (
                          <>
                            {" · "}
                            <Link href={`/pedidos/${m.pedido.id}`} className="text-brand-700 hover:underline">
                              pedido {m.pedido.numero ? `#${m.pedido.numero}` : ""}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
