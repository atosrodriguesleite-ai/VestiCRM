"use client";

import { useRef, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { FileUp, X, Check, FileJson, AlertTriangle } from "lucide-react";

/**
 * Botão + modal "Importar catálogo": sobe um arquivo .json montado
 * previamente (fotos + infos) e cria os produtos como registros reais e
 * editáveis. Estoque já vem definido no arquivo — sem edição peça por peça.
 */

type Summary = {
  productsCreated: number;
  productsUpdated: number;
  variants: number;
  images: number;
  colorsAdded: number;
  sizesAdded: number;
  storeUpdated: boolean;
};

type Preview = {
  fileName: string;
  products: number;
  variants: number;
  images: number;
  totalStock: number;
  hasStore: boolean;
  raw: unknown;
};

type RawProduct = {
  colors?: string[];
  sizes?: string[];
  images?: string[];
  stock?: number;
  stockByVariant?: Record<string, number>;
};
type RawCatalog = {
  products?: RawProduct[];
  store?: unknown;
  defaults?: { sizes?: string[]; stock?: number };
};

function buildPreview(fileName: string, raw: RawCatalog): Preview | null {
  if (!raw || !Array.isArray(raw.products)) return null;
  let variants = 0;
  let images = 0;
  let totalStock = 0;
  const defSizes: string[] = raw.defaults?.sizes ?? [];
  const defStock: number = raw.defaults?.stock ?? 0;
  for (const p of raw.products) {
    const colors: string[] = p.colors?.length ? p.colors : ["Único"];
    const sizes: string[] = p.sizes?.length ? p.sizes : defSizes.length ? defSizes : ["Único"];
    images += p.images?.length ?? 0;
    for (const c of colors)
      for (const s of sizes) {
        variants++;
        totalStock += p.stockByVariant?.[`${c}/${s}`] ?? p.stock ?? defStock;
      }
  }
  return {
    fileName,
    products: raw.products.length,
    variants,
    images,
    totalStock,
    hasStore: Boolean(raw.store),
    raw,
  };
}

export function ImportCatalog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  // modo seguro: só completa fotos que faltam (não cria produto, não altera
  // preço nem estoque) — ideal para reimportar um arquivo antigo
  const [photosOnly, setPhotosOnly] = useState(false);

  function reset() {
    setPreview(null);
    setError(null);
    setResult(null);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 200);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const p = buildPreview(file.name, raw);
      if (!p) {
        setError('Arquivo inválido: esperado um objeto com a lista "products".');
        setPreview(null);
        return;
      }
      setPreview(p);
    } catch {
      setError("Não consegui ler o arquivo. Confira se é um .json válido.");
      setPreview(null);
    }
  }

  async function doImport() {
    if (!preview || importing) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/catalog/import${photosOnly ? "?modo=fotos" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preview.raw),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao importar o catálogo.");
        return;
      }
      setResult(data.summary);
      router.refresh();
    } catch {
      setError("Falha de conexão durante a importação.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 transition"
      >
        <FileUp className="size-4" />
        <span className="hidden sm:inline">Importar catálogo</span>
        <span className="sm:hidden">Importar</span>
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 pb-[var(--kb,0px)]">
          <button
            aria-label="Fechar"
            onClick={close}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          />
          <div className="relative w-full sm:max-w-lg max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll rounded-t-3xl sm:rounded-3xl bg-white shadow-pop animate-scale-in">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white/90 backdrop-blur px-5 sm:px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                  <FileJson className="size-5" />
                </span>
                <div className="leading-tight">
                  <p className="text-[15px] font-semibold text-slate-900">
                    Importar catálogo
                  </p>
                  <p className="text-xs text-slate-500">
                    Suba um arquivo .json com os produtos prontos.
                  </p>
                </div>
              </div>
              <button
                onClick={close}
                aria-label="Fechar"
                className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-5 sm:px-6 py-5 space-y-4">
              {result ? (
                <div className="text-center py-4">
                  <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                    <Check className="size-7" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Catálogo importado!
                  </h3>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-left">
                    <Stat label="Produtos criados" value={result.productsCreated} />
                    <Stat label="Produtos atualizados" value={result.productsUpdated} />
                    <Stat label="Variações" value={result.variants} />
                    <Stat label="Fotos" value={result.images} />
                    <Stat label="Cores novas" value={result.colorsAdded} />
                    <Stat label="Tamanhos novos" value={result.sizesAdded} />
                  </div>
                  {result.storeUpdated && (
                    <p className="mt-3 text-xs text-slate-500">
                      Identidade visual da loja também foi atualizada.
                    </p>
                  )}
                  <button
                    onClick={close}
                    className="mt-6 w-full rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Concluir
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <FileUp className="size-7 text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">
                      {preview ? preview.fileName : "Escolher arquivo .json"}
                    </span>
                    <span className="text-xs text-slate-400">
                      Toque para selecionar o catálogo
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={onFile}
                    className="hidden"
                  />

                  {preview && (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Prévia
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Stat label="Produtos" value={preview.products} />
                        <Stat label="Variações" value={preview.variants} />
                        <Stat label="Fotos" value={preview.images} />
                        <Stat label="Estoque total" value={preview.totalStock} />
                      </div>
                      {preview.hasStore && (
                        <p className="mt-2 text-xs text-brand-600">
                          Inclui identidade visual da loja (logo/cores).
                        </p>
                      )}
                      {preview.totalStock === 0 && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600">
                          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                          Estoque total zero: os produtos aparecerão como
                          indisponíveis até o estoque ser ajustado.
                        </p>
                      )}
                    </div>
                  )}

                  {/* modo seguro para reimportar arquivo antigo */}
                  <label className="flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={photosOnly}
                      onChange={(e) => setPhotosOnly(e.target.checked)}
                      className="mt-0.5 accent-emerald-600"
                    />
                    <span className="text-xs text-emerald-900">
                      <b>Só completar fotos que faltam</b> — não cria produto,
                      não altera preço, estoque nem variações. Use para
                      restaurar fotos a partir de um arquivo antigo, sem
                      nenhum risco para o que a loja já organizou.
                    </span>
                  </label>

                  {error && (
                    <p className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5 text-sm text-rose-700">
                      {error}
                    </p>
                  )}

                  <button
                    onClick={doImport}
                    disabled={!preview || importing}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {importing && (
                      <span className="size-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    )}
                    {importing
                      ? "Enviando… não feche esta janela"
                      : photosOnly
                        ? "Completar fotos"
                        : "Importar produtos"}
                  </button>
                  {importing && (
                    <p className="text-center text-[11px] text-slate-400">
                      Arquivos com muitas fotos levam até 1 minuto.
                    </p>
                  )}
                  {!preview && (
                    <p className="text-center text-[11px] text-amber-600">
                      Escolha o arquivo .json acima para liberar o botão.
                    </p>
                  )}
                  <p className="text-center text-[11px] text-slate-400">
                    Os produtos entram editáveis: a loja controla estoque, inativa
                    esgotados e adiciona novos normalmente.
                  </p>
                </>
              )}
            </div>
          </div>
        </div></Portal>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
      <p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
