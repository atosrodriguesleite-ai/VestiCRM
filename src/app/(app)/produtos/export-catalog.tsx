"use client";

/**
 * Botão "Exportar": baixa o backup completo do catálogo (.json) — produtos,
 * preços, estoque real por cor/tamanho, fotos e identidade. Busca em fatias
 * (fotos pesam) e monta UM arquivo, no formato aceito pela importação — o
 * lojista guarda e, se precisar, restaura pelo próprio importador seguro.
 */

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

type Slice = {
  total: number;
  proximo: number | null;
  cabecalho?: { slug?: string } & Record<string, unknown>;
  products: Record<string, unknown>[];
};

export function ExportCatalog() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      let desde: number | null = 0;
      let header: Slice["cabecalho"] | undefined;
      const products: Record<string, unknown>[] = [];
      let total = 0;
      while (desde !== null) {
        const res = await fetch(`/api/catalog/export?desde=${desde}`);
        if (!res.ok) throw new Error(String(res.status));
        const d: Slice = await res.json();
        if (desde === 0) header = d.cabecalho;
        products.push(...d.products);
        total = d.total;
        desde = d.proximo;
        setProgress(`Preparando backup… ${Math.min(products.length, total)} de ${total} peças`);
      }
      const { slug, ...head } = header ?? {};
      const file = { ...head, products };
      const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `backup-catalogo-${slug ?? "loja"}-${date}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setProgress("");
    } catch {
      setError("Não foi possível exportar. Tente de novo.");
      setProgress("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        title="Baixa o backup completo do catálogo (produtos, preços, estoque e fotos)"
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-3.5 py-2.5 transition disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        <span className="hidden sm:inline">{busy ? "Exportando…" : "Exportar"}</span>
      </button>
      {progress && <span className="text-xs text-gray-400">{progress}</span>}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
