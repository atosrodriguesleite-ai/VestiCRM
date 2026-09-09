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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  History,
  Lock,
  Package,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Alert, EmptyState, Spinner } from "@/components/ui";
import { DICA_DO_DONO, NOME_DO_DONO, type DonoExterno } from "@/lib/estoque/dono-do-estoque";
import { ROTULO_DA_ORIGEM } from "@/lib/estoque/minimos-regra";
import type { FiltroDoInventario, Inventario, LinhaDoInventario } from "@/lib/estoque/inventario";

type Resposta = Inventario & { podeAjustar: boolean; podeSincronizar: boolean };

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
    const res = await fetch(`/api/estoque/inventario?${sp}`, { cache: "no-store" });
    const d = await res.json().catch(() => null);
    if (meu !== sequencia.current) return;
    setCarregando(false);
    if (!res.ok || !d) {
      setErro(d?.error ?? "Não foi possível carregar o inventário.");
      return;
    }
    setDados(d);
  }, [q, categoria, filtro, inativos]);

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
    setSync({ ocupado: true, msg: "Sincronizando com a Nuvemshop…" });
    let total = 0;
    for (let page = 1; page <= 200; page++) {
      const res = await fetch("/api/nuvemshop/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSync({ ocupado: false, msg: d.error ?? "A Nuvemshop não respondeu. Tente de novo em instantes." });
        return;
      }
      total += d.produtos ?? 0;
      setSync({ ocupado: true, msg: `Sincronizando… ${total} produtos conferidos` });
      if (d.fim) break;
    }
    setSync({ ocupado: false, msg: `Sincronizado: ${total} produtos conferidos com a Nuvemshop.` });
    carregar();
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
            rotulo="Zeradas"
            valor={resumo.zeradas}
            hint={`${resumo.baixas} no mínimo (loja: ${dados!.limiteBaixo})`}
            tom={resumo.zeradas > 0 ? "rose" : undefined}
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
            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400"
          />
        </label>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
        >
          <option value="">Todas as categorias</option>
          {dados?.categorias.map((c) => (
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
          {erro}
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
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Produto</th>
                  <th className="text-left px-3 py-2 font-medium">Cor</th>
                  <th className="text-left px-3 py-2 font-medium">Tam.</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">SKU</th>
                  <th className="text-right px-3 py-2 font-medium" title="disponíveis + reservadas">
                    Na loja
                  </th>
                  <th className="text-right px-3 py-2 font-medium" title="em pedido que ainda está aqui (aguardando pagamento ou separação)">
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
                    limiteBaixo={dados.limiteBaixo}
                    podeAjustar={dados.podeAjustar}
                    onAjustado={aplicarNaLinha}
                    onRecarregar={carregar}
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
  limiteBaixo,
  podeAjustar,
  onAjustado,
  onRecarregar,
  onHistorico,
}: {
  l: LinhaDoInventario;
  limiteBaixo: number;
  podeAjustar: boolean;
  onAjustado: (variantId: string, estoque: number) => void;
  onRecarregar: () => void;
  onHistorico: () => void;
}) {
  const editavel = podeAjustar && !l.dono;
  // amarelo = chegou ao mínimo DELA (peça > categoria > loja, RN-051)
  const corDoNumero =
    l.disponivel === 0
      ? "text-rose-600"
      : l.disponivel <= l.minimo
        ? "text-amber-600"
        : "text-slate-900";
  void limiteBaixo;

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/60">
      <td className="px-3 py-2">
        <div className="font-medium text-slate-800 leading-tight">
          {l.produto}
          {!l.ativo && <span className="ml-1.5 text-[10px] text-slate-400">(inativo)</span>}
        </div>
        <div className="text-[11px] text-slate-400">{l.categoria}</div>
      </td>
      <td className="px-3 py-2 text-slate-700">{l.cor}</td>
      <td className="px-3 py-2 text-slate-700">{l.tamanho}</td>
      <td className="px-3 py-2 text-xs text-slate-500 hidden md:table-cell">{l.sku}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{l.emEstoque}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {l.reservado > 0 ? (
          <span className="text-amber-700">{l.reservado}</span>
        ) : (
          <span className="text-slate-300">0</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {editavel ? (
          <EditorDeEstoque linha={l} onAjustado={onAjustado} onRecarregar={onRecarregar} corDoNumero={corDoNumero} />
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
      <td className="px-3 py-2 text-right">
        <EditorDeMinimo linha={l} podeAjustar={podeAjustar} onSalvo={onRecarregar} />
      </td>
      <td className="px-2 py-2 text-right">
        <button
          type="button"
          onClick={onHistorico}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          title="Histórico desta peça"
        >
          <History className="size-4" />
        </button>
      </td>
    </tr>
  );
}

function DonoBadge({ dono }: { dono: DonoExterno }) {
  return (
    <span className="ml-1 rounded-full bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100 px-1.5 py-0.5 text-[10px] font-medium">
      {NOME_DO_DONO[dono]}
    </span>
  );
}

/* ---------------------------------------------------- o editor */

/**
 * Clica → digita → confirma com motivo. Enter abre o motivo; Esc desiste.
 * O número enviado é o que a pessoa VIU (a porta grava condicional a ele):
 * se outra pessoa mexeu no meio, a resposta pede para recarregar.
 */
function EditorDeEstoque({
  linha,
  onAjustado,
  onRecarregar,
  corDoNumero,
}: {
  linha: LinhaDoInventario;
  onAjustado: (variantId: string, estoque: number) => void;
  onRecarregar: () => void;
  corDoNumero: string;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(linha.disponivel));
  const [motivo, setMotivo] = useState("");
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editando) setValor(String(linha.disponivel));
  }, [linha.disponivel, editando]);

  const novo = parseInt(valor, 10);
  const mudou = Number.isInteger(novo) && novo !== linha.disponivel;

  function abrir() {
    setErro("");
    setEditando(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }
  function desistir() {
    setEditando(false);
    setPedindoMotivo(false);
    setMotivo("");
    setErro("");
    setValor(String(linha.disponivel));
  }
  function seguirParaMotivo() {
    if (!mudou) return desistir();
    setPedindoMotivo(true);
  }

  async function salvar(motivoEscolhido: string) {
    if (!mudou) return desistir();
    setSalvando(true);
    setErro("");
    const res = await fetch(`/api/estoque/variacoes/${linha.variantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estoque: novo, visto: linha.disponivel, motivo: motivoEscolhido }),
    });
    const d = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) {
      setErro(d.error ?? "Não foi possível salvar.");
      // o número já mudou no banco (colega, venda): a linha passa a mostrar o atual
      if (res.status === 409 && typeof d.estoqueAtual === "number") onAjustado(linha.variantId, d.estoqueAtual);
      return;
    }
    onAjustado(linha.variantId, d.estoque);
    setEditando(false);
    setPedindoMotivo(false);
    setMotivo("");
    setSalvo(true);
    setTimeout(() => setSalvo(false), 1500);
    onRecarregar();
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={abrir}
        className={`inline-flex items-center justify-end gap-1 rounded-lg border border-transparent px-2 py-0.5 tabular-nums hover:border-slate-200 hover:bg-white ${corDoNumero}`}
        title="Clique para ajustar"
      >
        {salvo && <Check className="size-3.5 text-emerald-600" />}
        {linha.disponivel}
      </button>
    );
  }

  return (
    <div className="relative inline-block text-left">
      <div className="flex items-center justify-end gap-1">
        <input
          ref={inputRef}
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") seguirParaMotivo();
            if (e.key === "Escape") desistir();
          }}
          inputMode="numeric"
          className="w-16 rounded-lg border border-brand-300 bg-white px-2 py-0.5 text-right text-sm tabular-nums outline-none"
          disabled={pedindoMotivo || salvando}
        />
        {!pedindoMotivo && (
          <>
            <button
              type="button"
              onClick={seguirParaMotivo}
              className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50"
              title="Confirmar"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              onClick={desistir}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              title="Cancelar"
            >
              <X className="size-4" />
            </button>
          </>
        )}
      </div>
      {pedindoMotivo && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-left">
          <p className="text-xs font-medium text-slate-700">
            {linha.disponivel} → {novo} · qual o motivo?
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {MOTIVOS_RAPIDOS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={salvando}
                onClick={() => salvar(m)}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] hover:border-brand-300 hover:bg-brand-50"
              >
                {m}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && motivo.trim()) salvar(motivo);
                if (e.key === "Escape") desistir();
              }}
              placeholder="ou escreva o motivo…"
              maxLength={120}
              autoFocus
              className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand-400"
            />
            <button
              type="button"
              disabled={salvando || !motivo.trim()}
              onClick={() => salvar(motivo)}
              className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {salvando ? "…" : "Salvar"}
            </button>
          </div>
          {erro && <p className="mt-2 text-[11px] text-rose-600">{erro}</p>}
          <button
            type="button"
            onClick={desistir}
            className="mt-2 text-[11px] text-slate-400 hover:text-slate-600"
          >
            cancelar
          </button>
        </div>
      )}
      {erro && !pedindoMotivo && <p className="mt-1 text-[11px] text-rose-600">{erro}</p>}
    </div>
  );
}

/* ---------------------------------------------------- histórico */

function Historico({ linha, onFechar }: { linha: LinhaDoInventario; onFechar: () => void }) {
  const [movs, setMovs] = useState<Movimento[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(`/api/estoque/variacoes/${linha.variantId}/movimentos`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !d) setErro(d?.error ?? "Não foi possível carregar o histórico.");
        else setMovs(d.movimentos);
      })
      .catch(() => vivo && setErro("Não foi possível carregar o histórico."));
    return () => {
      vivo = false;
    };
  }, [linha.variantId]);

  const titulo = useMemo(
    () => [linha.produto, linha.cor, linha.tamanho].filter(Boolean).join(" · "),
    [linha]
  );

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onFechar}
    >
      <div
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
          <button type="button" onClick={onFechar} className="p-1 text-slate-400 hover:text-slate-700">
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
  );
}

/* ---------------------------------------------------- o mínimo da peça */

/**
 * O mínimo que vale para esta linha, com a origem (peça / categoria / loja).
 * Gerência clica e define o mínimo DA PEÇA (vale para cada cor × tamanho do
 * modelo); em branco volta a valer o da categoria/loja.
 */
function EditorDeMinimo({
  linha,
  podeAjustar,
  onSalvo,
}: {
  linha: LinhaDoInventario;
  podeAjustar: boolean;
  onSalvo: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(linha.origemDoMinimo === "PECA" ? String(linha.minimo) : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!aberto) setValor(linha.origemDoMinimo === "PECA" ? String(linha.minimo) : "");
  }, [linha.minimo, linha.origemDoMinimo, aberto]);

  async function salvar(limpar = false) {
    setSalvando(true);
    setErro("");
    const r = await fetch(`/api/estoque/produtos/${linha.productId}/minimo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minimo: limpar || valor === "" ? null : parseInt(valor, 10) }),
    });
    setSalvando(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível salvar.");
      return;
    }
    setAberto(false);
    onSalvo();
  }

  const rotulo = (
    <span className="tabular-nums text-slate-600" title={`mínimo ${ROTULO_DA_ORIGEM[linha.origemDoMinimo]}`}>
      {linha.minimo}
      <span className="ml-1 text-[10px] text-slate-400">
        {linha.origemDoMinimo === "PECA" ? "peça" : linha.origemDoMinimo === "CATEGORIA" ? "cat." : "loja"}
      </span>
    </span>
  );
  if (!podeAjustar) return rotulo;

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="rounded-lg border border-transparent px-2 py-0.5 hover:border-slate-200 hover:bg-white"
        title="Definir o mínimo desta peça (vale para cada cor e tamanho do modelo)"
      >
        {rotulo}
      </button>
      {aberto && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-left">
          <p className="text-xs font-medium text-slate-700">Mínimo de {linha.produto}</p>
          <p className="text-[11px] text-slate-400">Vale para cada cor e tamanho. Em branco = usa o da categoria/loja.</p>
          <div className="mt-2 flex gap-1">
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") setAberto(false);
              }}
              inputMode="numeric"
              autoFocus
              placeholder={`${ROTULO_DA_ORIGEM[linha.origemDoMinimo] === "da peça" ? "" : linha.minimo}`}
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-right tabular-nums outline-none focus:border-brand-400"
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
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
                title="Voltar a usar o mínimo da categoria/loja"
              >
                Limpar
              </button>
            )}
          </div>
          {erro && <p className="mt-2 text-[11px] text-rose-600">{erro}</p>}
          <button type="button" onClick={() => setAberto(false)} className="mt-2 text-[11px] text-slate-400 hover:text-slate-600">
            cancelar
          </button>
        </div>
      )}
    </div>
  );
}
