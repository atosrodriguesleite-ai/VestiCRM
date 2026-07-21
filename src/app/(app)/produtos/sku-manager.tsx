"use client";

/**
 * Tabela de SKUs: um lugar só pra preencher o SKU de TODOS os produtos e de
 * cada variação (cor × tamanho). É a chave universal de vínculo com a loja
 * online (Nuvemshop) — SKU igual dos dois lados = casamento garantido.
 */

import { useEffect, useMemo, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { Barcode, CheckCircle2, Loader2, Search, X } from "lucide-react";

type Row = {
  id: string;
  name: string;
  sku: string;
  category: string;
  variants: { id: string; color: string; size: string; sku: string | null }[];
};

export function SkuManager() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");
  // edições pendentes (só o que mudou vai pro servidor)
  const [prodEdits, setProdEdits] = useState<Record<string, string>>({});
  const [varEdits, setVarEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || rows) return;
    fetch("/api/products/skus")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.products))
      .catch(() => setMsg("Não foi possível carregar os produtos."));
  }, [open, rows]);

  const filtrados = useMemo(() => {
    if (!rows) return [];
    const q = busca.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase().includes(q) ||
        r.variants.some((v) => (v.sku ?? "").toLowerCase().includes(q))
    );
  }, [rows, busca]);

  const totalMudancas = Object.keys(prodEdits).length + Object.keys(varEdits).length;

  async function salvar() {
    if (!rows || totalMudancas === 0) return;
    setSalvando(true);
    setMsg("");
    const res = await fetch("/api/products/skus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        products: Object.entries(prodEdits).map(([id, sku]) => ({ id, sku })),
        variants: Object.entries(varEdits).map(([id, sku]) => ({
          id,
          sku: sku.trim() || null,
        })),
      }),
    });
    setSalvando(false);
    if (res.ok) {
      const d = await res.json().catch(() => ({ salvos: totalMudancas }));
      // reflete o salvo na tabela local e limpa as edições pendentes
      setRows(
        rows.map((r) => ({
          ...r,
          sku: prodEdits[r.id] !== undefined ? prodEdits[r.id].trim() : r.sku,
          variants: r.variants.map((v) => ({
            ...v,
            sku: varEdits[v.id] !== undefined ? varEdits[v.id].trim() || null : v.sku,
          })),
        }))
      );
      setProdEdits({});
      setVarEdits({});
      setMsg(`✅ ${d.salvos} SKU(s) salvos.`);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "Não foi possível salvar. Tente de novo.");
    }
  }

  function fechar() {
    if (totalMudancas > 0 && !window.confirm("Sair sem salvar as alterações?")) return;
    setOpen(false);
    setProdEdits({});
    setVarEdits({});
    setMsg("");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Preencher o SKU de todos os produtos e variações (vínculo com a loja online)"
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-3.5 py-2.5 transition"
      >
        <Barcode className="size-4" />
        <span className="hidden sm:inline">SKUs</span>
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={fechar} />
          <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-3xl animate-fade-up max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] md:max-h-[85dvh] flex flex-col">
            <div className="p-5 pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Barcode className="size-5 text-brand-600" />
                  Tabela de SKUs
                </h3>
                <button onClick={fechar} className="text-gray-400 p-1">
                  <X className="size-5" />
                </button>
              </div>
              <p className="text-xs text-gray-500 leading-snug">
                Preencha o SKU de cada produto e de cada variação (cor ·
                tamanho). O SKU da variação é a chave que casa a peça com a
                loja online — use o MESMO código dos dois lados.
              </p>
              <div className="relative mt-3">
                <Search className="size-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar produto, categoria ou SKU..."
                  className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto thin-scroll p-5 pt-3">
              {!rows ? (
                <p className="text-sm text-gray-400 flex items-center gap-2 py-6 justify-center">
                  <Loader2 className="size-4 animate-spin" /> Carregando produtos...
                </p>
              ) : filtrados.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  Nenhum produto encontrado.
                </p>
              ) : (
                <div className="space-y-4">
                  {filtrados.map((r) => (
                    <div key={r.id} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">
                            {r.name}
                          </p>
                          <p className="text-[11px] text-gray-400">{r.category}</p>
                        </div>
                        <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                          SKU do produto
                          <input
                            value={prodEdits[r.id] ?? r.sku ?? ""}
                            onChange={(e) =>
                              setProdEdits((s) => ({ ...s, [r.id]: e.target.value }))
                            }
                            maxLength={60}
                            className={`w-32 rounded-lg border px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                              prodEdits[r.id] !== undefined
                                ? "border-brand-300 bg-brand-50/50"
                                : "border-gray-200"
                            }`}
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {r.variants.map((v) => (
                          <label
                            key={v.id}
                            className="flex items-center justify-between gap-2 text-xs text-gray-600"
                          >
                            <span className="truncate">
                              {v.color} · <b>{v.size}</b>
                            </span>
                            <input
                              value={varEdits[v.id] ?? v.sku ?? ""}
                              onChange={(e) =>
                                setVarEdits((s) => ({ ...s, [v.id]: e.target.value }))
                              }
                              maxLength={60}
                              placeholder="SKU"
                              className={`w-36 rounded-lg border px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                                varEdits[v.id] !== undefined
                                  ? "border-brand-300 bg-brand-50/50"
                                  : "border-gray-200"
                              }`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500 min-w-0 truncate">
                {msg ||
                  (totalMudancas > 0
                    ? `${totalMudancas} alteração(ões) sem salvar`
                    : "Nenhuma alteração pendente")}
              </p>
              <button
                onClick={salvar}
                disabled={salvando || totalMudancas === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-50 shrink-0"
              >
                {salvando ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Salvar SKUs
              </button>
            </div>
          </div>
        </div></Portal>
      )}
    </>
  );
}
