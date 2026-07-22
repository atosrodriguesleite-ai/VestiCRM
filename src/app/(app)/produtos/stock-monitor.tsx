"use client";

/**
 * Monitor de estoque baixo: lista as variações (cor/tamanho) de produtos
 * ativos que chegaram ao limite definido pela loja. O dono ajusta o limite
 * aqui mesmo — a lista recalcula AO VIVO enquanto ele digita (sem recarregar
 * a página) e o novo limite é salvo em segundo plano (reflete no Dashboard).
 */

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, PackagePlus, ShoppingBag } from "lucide-react";

export type LowStockRow = {
  product: string;
  color: string;
  size: string;
  stock: number;
};

export function StockMonitor({
  variations,
  threshold: initialThreshold,
  canManage,
  hideOutOfStock,
}: {
  variations: LowStockRow[];
  threshold: number;
  canManage: boolean;
  hideOutOfStock: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(String(initialThreshold));
  const savedRef = useRef(initialThreshold);
  // chavinha: esconder do catálogo público os produtos sem estoque
  const [hideOOS, setHideOOS] = useState(hideOutOfStock);
  function saveHideOOS(next: boolean) {
    setHideOOS(next);
    fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogHideOutOfStock: next }),
    }).catch(() => {});
  }

  const threshold = Math.max(0, parseInt(raw) || 0);

  // filtro ao vivo: recalcula na hora que o número muda
  const rows = useMemo(
    () =>
      variations
        .filter((v) => v.stock <= threshold)
        .sort((a, b) => a.stock - b.stock),
    [variations, threshold]
  );

  // prioridades de reposição: soma quantas peças FALTAM (limite − estoque)
  // por COR (direção de compra de tecido) e por MODELO (direção de corte).
  // Quem tem mais peça faltando vem primeiro; empate decide por nº de variações.
  //
  // MODELO agrupa as cores do mesmo corte: em lojas onde cada cor é um
  // produto ("Baby Look — Branco", "Baby Look — Preto"), o sufixo da cor é
  // removido e tudo soma no modelo base ("Baby Look") — quem corta, corta
  // várias cores juntas; a cor importa na compra do tecido, não no corte.
  const modelName = (r: LowStockRow) => {
    const esc = r.color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return r.product.replace(new RegExp(`\\s*[—–-]\\s*${esc}\\s*$`, "i"), "").trim() || r.product;
  };

  const rank = useMemo(() => {
    const somar = (key: (r: LowStockRow) => string) => {
      const map = new Map<string, { gap: number; vars: number; zerado: number }>();
      for (const r of rows) {
        const k = key(r);
        const cur = map.get(k) ?? { gap: 0, vars: 0, zerado: 0 };
        cur.gap += Math.max(0, threshold - r.stock);
        cur.vars += 1;
        if (r.stock === 0) cur.zerado += 1;
        map.set(k, cur);
      }
      return [...map.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.gap - a.gap || b.vars - a.vars);
    };
    return { cores: somar((r) => r.color), modelos: somar(modelName) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, threshold]);

  // persiste o limite em segundo plano (sem travar a digitação)
  function persist(value: number) {
    if (value === savedRef.current) return;
    savedRef.current = value;
    fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lowStockThreshold: value }),
    }).catch(() => {});
  }

  return (
    <div
      className={`rounded-2xl border mb-5 ${
        rows.length > 0
          ? "border-amber-200 bg-amber-50/70"
          : "border-emerald-100 bg-emerald-50/50"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <AlertTriangle
          className={`size-4 shrink-0 ${rows.length > 0 ? "text-amber-500" : "text-emerald-500"}`}
        />
        <button
          onClick={() => rows.length > 0 && setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium flex-1 min-w-0 text-left"
        >
          {rows.length > 0 ? (
            <>
              <span className="text-amber-800">
                {rows.length} variaç{rows.length === 1 ? "ão" : "ões"} com
                estoque baixo
              </span>
              <ChevronDown
                className={`size-4 text-amber-500 transition ${open ? "rotate-180" : ""}`}
              />
            </>
          ) : (
            <span className="text-emerald-700">
              Estoque saudável — nenhuma variação no limite
            </span>
          )}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
          Avisar quando restar
          {canManage ? (
            <input
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={() => persist(threshold)}
              inputMode="numeric"
              className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-xs text-center bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
          ) : (
            <b>{threshold}</b>
          )}
          peça{threshold === 1 ? "" : "s"} ou menos
        </label>
      </div>

      {/* chavinha: esconder do catálogo os produtos sem estoque (indisponíveis) */}
      <div className="flex items-center justify-between gap-3 border-t border-white/60 px-4 py-2.5">
        <span className="text-xs text-gray-600 min-w-0">
          Esconder do catálogo os produtos <b>sem estoque</b>
          <span className="text-gray-400"> — voltam sozinhos quando o estoque é reposto.</span>
        </span>
        {canManage ? (
          <button
            type="button"
            onClick={() => saveHideOOS(!hideOOS)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${hideOOS ? "bg-emerald-500" : "bg-gray-300"}`}
            title={hideOOS ? "Escondendo os sem estoque" : "Mostrando todos no catálogo"}
          >
            <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${hideOOS ? "left-[1.375rem]" : "left-0.5"}`} />
          </button>
        ) : (
          <span className="text-xs font-medium text-gray-500 shrink-0">{hideOOS ? "Ligado" : "Desligado"}</span>
        )}
      </div>

      {open && rows.length > 0 && (
        <div className="px-4 pb-3">
          {/* Direção de reposição: o que comprar (cor) e o que cortar (modelo) */}
          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <PriorityList
              icon={<ShoppingBag className="size-3.5" />}
              title="Prioridade de compra — cores"
              hint="compras: comece pela cor que mais falta"
              items={rank.cores}
            />
            <PriorityList
              icon={<PackagePlus className="size-3.5" />}
              title="Prioridade de reposição — modelos"
              hint="comece pelo modelo que mais falta no estoque"
              items={rank.modelos}
            />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg bg-white border border-amber-100 px-3 py-1.5 text-xs"
              >
                <span className="truncate">
                  <b>{r.product}</b> · {r.color} {r.size}
                </span>
                <span
                  className={`font-semibold tabular-nums shrink-0 ${r.stock === 0 ? "text-rose-600" : "text-amber-600"}`}
                >
                  {r.stock === 0 ? "esgotado" : `${r.stock} un.`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Lista numerada de prioridades (1º = onde mais falta peça). */
function PriorityList({
  icon,
  title,
  hint,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  items: { name: string; gap: number; vars: number; zerado: number }[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 5);
  return (
    <div className="rounded-xl bg-white border border-amber-100 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800 uppercase tracking-wide">
        {icon}
        {title}
      </p>
      <p className="text-[10px] text-gray-400 mb-2">{hint}</p>
      <ol className="space-y-1">
        {visible.map((it, i) => (
          <li key={it.name} className="flex items-center gap-2 text-xs">
            <span
              className={`size-5 shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center ${
                i === 0
                  ? "bg-rose-600 text-white"
                  : i === 1
                    ? "bg-amber-500 text-white"
                    : "bg-amber-100 text-amber-800"
              }`}
            >
              {i + 1}
            </span>
            <span className="font-semibold truncate flex-1">{it.name}</span>
            <span className="text-gray-500 tabular-nums shrink-0">
              {it.gap > 0 ? (
                <>
                  faltam <b className="text-gray-800">{it.gap}</b> pç
                </>
              ) : (
                <>
                  <b className="text-gray-800">{it.vars}</b> no limite
                </>
              )}
              {it.zerado > 0 && (
                <span className="text-rose-600"> · {it.zerado} esgotada{it.zerado === 1 ? "" : "s"}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {items.length > 5 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-[11px] font-medium text-amber-700 hover:text-amber-900 mt-2 transition"
        >
          {showAll ? "Mostrar menos" : `Ver todas (${items.length})`}
        </button>
      )}
    </div>
  );
}
