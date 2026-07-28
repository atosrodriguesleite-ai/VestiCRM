"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { History, Images, Loader2, Package, Palette, Plus, Search, Star, Trash2, Upload, X } from "lucide-react";
import { brl } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { fileToDataUrl } from "@/lib/upload";
import { ImportCatalog } from "./import-catalog";
import { casaTexto } from "@/lib/busca";

type LibraryColor = { name: string; hex: string };

type StockMov = {
  id: string;
  variacao: string;
  type: "ENTRADA" | "SAIDA" | "AJUSTE";
  quantity: number;
  reason: string;
  createdAt: string;
};

export type ProductItem = {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand: string | null;
  collection: string | null;
  description: string | null;
  costPrice: number;
  wholesalePrice: number;
  retailPrice: number;
  minQuantity: number;
  weightGrams: number | null; // peso da peça (g) para cotar frete
  active: boolean;
  tags: string | null;
  // fotos em ordem — a primeira é a CAPA (aparece na grade e no catálogo)
  images: { id: string; url: string }[];
  variants: { id: string; color: string; size: string; stock: number; sku: string | null }[];
};

export function totalStock(p: ProductItem) {
  return p.variants.reduce((s, v) => s + v.stock, 0);
}

/** Produto "sem SKU": o código do produto está vazio OU alguma variação sem SKU. */
export function missingSku(p: ProductItem) {
  if (!p.sku?.trim()) return true;
  return p.variants.some((v) => !v.sku?.trim());
}

export function ProductsView({
  initial,
  categories,
  collections,
  brands,
  colors,
  sizes,
  libraryColors,
  librarySizes,
  mediaLibrary = false,
}: {
  initial: ProductItem[];
  categories: string[];
  collections: string[];
  brands: string[];
  colors: string[];
  sizes: string[];
  libraryColors: LibraryColor[];
  librarySizes: string[];
  mediaLibrary?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [collection, setCollection] = useState("");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [onlyNoPhoto, setOnlyNoPhoto] = useState(false);
  const [onlyNoSku, setOnlyNoSku] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<ProductItem | null>(null);

  const filtered = useMemo(
    () =>
      initial.filter((p) => {
        if (
          q &&
          !casaTexto(p.name, q) &&
          !casaTexto(p.sku, q)
        )
          return false;
        if (category && p.category !== category) return false;
        if (collection && p.collection !== collection) return false;
        if (brand && p.brand !== brand) return false;
        if (color && !p.variants.some((v) => v.color === color)) return false;
        if (size && !p.variants.some((v) => v.size === size)) return false;
        if (maxPrice && p.retailPrice > Number(maxPrice)) return false;
        if (onlyStock && totalStock(p) === 0) return false;
        if (onlyNoPhoto && p.images.length > 0) return false;
        if (onlyNoSku && !missingSku(p)) return false;
        return true;
      }),
    [initial, q, category, collection, brand, color, size, maxPrice, onlyStock, onlyNoPhoto, onlyNoSku]
  );

  // quantos itens estão sem foto (ajuda a priorizar depois da importação)
  const noPhotoCount = useMemo(() => initial.filter((p) => p.images.length === 0).length, [initial]);
  // sem SKU: o produto OU alguma variação sem código (essencial p/ casar integrações)
  const noSkuCount = useMemo(() => initial.filter(missingSku).length, [initial]);

  const select =
    "rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-brand-400 transition";

  return (
    <>
      {/* filtros */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1 min-w-44">
          <Search className="size-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome ou SKU..."
            className="w-full rounded-xl bg-white border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400 transition"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={select}>
          <option value="">Categoria</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={color} onChange={(e) => setColor(e.target.value)} className={select}>
          <option value="">Cor</option>
          {colors.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={size} onChange={(e) => setSize(e.target.value)} className={select}>
          <option value="">Tamanho</option>
          {sizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={collection} onChange={(e) => setCollection(e.target.value)} className={select}>
          <option value="">Coleção</option>
          {collections.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={select}>
          <option value="">Marca</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <input
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ""))}
          placeholder="Preço até"
          inputMode="numeric"
          className={`${select} w-24`}
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyStock}
            onChange={(e) => setOnlyStock(e.target.checked)}
            className="size-3.5 accent-brand-600"
          />
          Com estoque
        </label>
        {noPhotoCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title="Mostrar só os produtos que ainda não têm foto">
            <input
              type="checkbox"
              checked={onlyNoPhoto}
              onChange={(e) => setOnlyNoPhoto(e.target.checked)}
              className="size-3.5 accent-brand-600"
            />
            Sem foto
            <span className="rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5">{noPhotoCount}</span>
          </label>
        )}
        {noSkuCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title="Produtos em que o próprio produto ou alguma variação está sem SKU (código)">
            <input
              type="checkbox"
              checked={onlyNoSku}
              onChange={(e) => setOnlyNoSku(e.target.checked)}
              className="size-3.5 accent-brand-600"
            />
            Sem SKU
            <span className="rounded-full bg-rose-100 text-rose-700 text-[10px] font-semibold px-1.5 py-0.5">{noSkuCount}</span>
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ImportCatalog />
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">Novo produto</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package />}
            title="Nenhum produto encontrado"
            hint="Cadastre o primeiro produto ou ajuste os filtros."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((p) => {
            const stock = totalStock(p);
            return (
              <button
                key={p.id}
                onClick={() => setDetail(p)}
                className="text-left bg-white rounded-2xl border border-gray-100 shadow-card hover:shadow-pop transition overflow-hidden group"
              >
                <div className="aspect-square bg-gray-50 relative overflow-hidden">
                  {p.images[0] ? (
                    <img
                      src={p.images[0].url}
                      alt={p.name}
                      // corte ancorado no TOPO: nunca corta a cabeça da modelo
                      className="w-full h-full object-cover object-top group-hover:scale-[1.03] transition"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-200">
                      <Package className="size-10" />
                    </div>
                  )}
                  {!p.active && (
                    <span className="absolute top-2 left-2 bg-gray-800/80 text-white text-[10px] font-medium rounded-full px-2 py-0.5">
                      Inativo
                    </span>
                  )}
                  {/* sem foto: fica OCULTO no catálogo público até ganhar imagem */}
                  {p.active && p.images.length === 0 && (
                    <span className="absolute top-2 left-2 bg-amber-500/90 text-white text-[10px] font-medium rounded-full px-2 py-0.5">
                      Sem foto · oculto
                    </span>
                  )}
                  {stock === 0 && p.active && p.images.length > 0 && (
                    <span className="absolute top-2 left-2 bg-rose-600/90 text-white text-[10px] font-medium rounded-full px-2 py-0.5">
                      Sem estoque
                    </span>
                  )}
                  {p.images.length > 1 && (
                    <span className="absolute bottom-2 right-2 bg-black/55 text-white text-[10px] font-medium rounded-full px-2 py-0.5">
                      {p.images.length} fotos
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold leading-tight line-clamp-2">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {p.sku} · {p.category}
                  </p>
                  <div className="flex items-baseline justify-between mt-2">
                    <span className="text-sm font-semibold text-brand-700">
                      {brl(p.retailPrice)}
                    </span>
                    <span className="text-[11px] text-gray-400 tabular-nums">
                      {stock} un.
                    </span>
                  </div>
                  {p.wholesalePrice > 0 && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Atacado {brl(p.wholesalePrice)} (mín. {p.minQuantity})
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detail && (
        <ProductDetailModal
          product={detail}
          libraryColors={libraryColors}
          librarySizes={librarySizes}
          categories={categories}
          collections={collections}
          brands={brands}
          mediaLibrary={mediaLibrary}
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null);
            router.refresh();
          }}
        />
      )}
      {showNew && (
        <NewProductModal
          libraryColors={libraryColors}
          librarySizes={librarySizes}
          categories={categories}
          collections={collections}
          brands={brands}
          mediaLibrary={mediaLibrary}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** Editor completo do produto: foto (upload), textos, preços, grade e estoque. */
function ProductDetailModal({
  product,
  libraryColors,
  librarySizes,
  categories,
  collections,
  brands,
  mediaLibrary = false,
  onClose,
  onChanged,
}: {
  product: ProductItem;
  libraryColors: LibraryColor[];
  librarySizes: string[];
  categories: string[];
  collections: string[];
  brands: string[];
  mediaLibrary?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [newVariant, setNewVariant] = useState({
    color: libraryColors[0]?.name ?? "",
    size: librarySizes[0] ?? "",
    stock: "5",
  });
  const [pendingAdds, setPendingAdds] = useState<
    { color: string; size: string; stock: number }[]
  >([]);
  const [form, setForm] = useState({
    name: product.name,
    category: product.category,
    brand: product.brand ?? "",
    collection: product.collection ?? "",
    description: product.description ?? "",
    costPrice: String(product.costPrice).replace(".", ","),
    wholesalePrice: String(product.wholesalePrice).replace(".", ","),
    retailPrice: String(product.retailPrice).replace(".", ","),
    minQuantity: String(product.minQuantity),
    weightGrams: product.weightGrams ? String(product.weightGrams) : "",
    tags: product.tags ?? "",
  });
  // galeria em ordem — a posição 0 é a capa; a lista final vai inteira no save
  const [photos, setPhotos] = useState<{ id?: string; url: string }[]>(
    product.images
  );
  const [stocks, setStocks] = useState<Record<string, string>>(
    Object.fromEntries(product.variants.map((v) => [v.id, String(v.stock)]))
  );
  // SKU por variação: chave de vínculo com a loja online (Nuvemshop)
  const [vskus, setVskus] = useState<Record<string, string>>(
    Object.fromEntries(product.variants.map((v) => [v.id, v.sku ?? ""]))
  );
  // histórico de estoque desta peça (carrega sob demanda)
  const [hist, setHist] = useState<StockMov[] | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [histAberto, setHistAberto] = useState(false);

  async function verHistorico() {
    if (histAberto) {
      setHistAberto(false);
      return;
    }
    setHistAberto(true);
    if (hist) return; // já carregado
    setHistBusy(true);
    const res = await fetch(`/api/products/${product.id}/movements`);
    const d = await res.json().catch(() => ({}));
    setHistBusy(false);
    if (res.ok) setHist(d.movimentos ?? []);
  }

  const num = (v: string) => parseFloat(v.replace(",", ".")) || 0;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        brand: form.brand || null,
        collection: form.collection || null,
        description: form.description || null,
        costPrice: num(form.costPrice),
        wholesalePrice: num(form.wholesalePrice),
        retailPrice: num(form.retailPrice),
        minQuantity: parseInt(form.minQuantity) || 1,
        weightGrams: parseInt(form.weightGrams) || null,
        tags: form.tags || null,
        images: photos.map((ph) => (ph.id ? { id: ph.id } : { url: ph.url })),
        variantStocks: Object.entries(stocks)
          .filter(([id]) => !removedIds.includes(id))
          .map(([id, stock]) => ({
            id,
            stock: parseInt(stock) || 0,
            sku: (vskus[id] ?? "").trim() || null,
          })),
        addVariants: pendingAdds,
        removeVariantIds: removedIds,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      // sem silêncio: se a API recusou (ex.: permissão), a pessoa fica sabendo
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Não foi possível salvar. Tente novamente.");
      return;
    }
    onChanged();
  }

  async function toggleActive() {
    setBusy(true);
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !product.active }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Não foi possível salvar. Tente novamente.");
      return;
    }
    onChanged();
  }

  async function removeProduct() {
    if (
      !window.confirm(
        `Remover "${product.name}" do catálogo? Os pedidos antigos ficam preservados.`
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error ?? "Não foi possível excluir. Tente novamente.");
      return;
    }
    onChanged();
  }

  function addPendingVariant() {
    if (!newVariant.color || !newVariant.size) return;
    const exists =
      product.variants.some(
        (v) => v.color === newVariant.color && v.size === newVariant.size
      ) ||
      pendingAdds.some(
        (v) => v.color === newVariant.color && v.size === newVariant.size
      );
    if (exists) return;
    setPendingAdds((prev) => [
      ...prev,
      {
        color: newVariant.color,
        size: newVariant.size,
        stock: parseInt(newVariant.stock) || 0,
      },
    ]);
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-3xl max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll animate-fade-up p-6">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <h3 className="font-semibold text-lg leading-tight">
              Editar produto
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {product.sku} · alterações aparecem na hora no catálogo geral
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 p-1 shrink-0">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div>
              <label className={label}>Nome</label>
              <input value={form.name} onChange={set("name")} className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Categoria</label>
                <input
                  value={form.category}
                  onChange={set("category")}
                  list="cat-list"
                  placeholder="Escolha ou crie"
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Marca</label>
                <input
                  value={form.brand}
                  onChange={set("brand")}
                  list="brand-list"
                  placeholder="Escolha ou crie"
                  className={input}
                />
              </div>
            </div>
            <div>
              <label className={label}>Coleção</label>
              <input
                value={form.collection}
                onChange={set("collection")}
                list="collection-list"
                placeholder="Escolha ou crie"
                className={input}
              />
            </div>
            <datalist id="cat-list">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <datalist id="brand-list">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <datalist id="collection-list">
              {collections.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div>
              <label className={label}>Descrição (aparece no catálogo)</label>
              <textarea
                value={form.description}
                onChange={set("description")}
                rows={3}
                className={input}
                placeholder="Ex.: Poliamida premium • Zero transparência • Toque macio"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={label}>Custo</label>
                <input value={form.costPrice} onChange={set("costPrice")} className={input} inputMode="decimal" />
              </div>
              <div>
                <label className={label}>Atacado</label>
                <input value={form.wholesalePrice} onChange={set("wholesalePrice")} className={input} inputMode="decimal" />
              </div>
              <div>
                <label className={label}>Varejo</label>
                <input value={form.retailPrice} onChange={set("retailPrice")} className={input} inputMode="decimal" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Qtd mínima atacado</label>
                <input value={form.minQuantity} onChange={set("minQuantity")} className={input} inputMode="numeric" />
              </div>
              <div>
                <label className={label}>Tags</label>
                <input value={form.tags} onChange={set("tags")} className={input} placeholder="lançamento, festa" />
              </div>
            </div>
            <div>
              <label className={label}>Peso da peça (g) — para cotar frete</label>
              <input
                value={form.weightGrams}
                onChange={set("weightGrams")}
                className={input}
                inputMode="numeric"
                placeholder="Ex.: 250 (vazio = usa o padrão da loja)"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className={label}>Fotos do produto</label>
              <PhotoManager photos={photos} onChange={setPhotos} mediaLibrary={mediaLibrary} />
            </div>

            <div>
              <label className={label}>Grade e estoque (cor · tamanho)</label>
              <div className="max-h-44 overflow-y-auto thin-scroll rounded-xl border border-gray-100 divide-y divide-gray-50">
                {product.variants
                  .filter((v) => !removedIds.includes(v.id))
                  .map((v) => (
                    <div key={v.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-xs font-medium flex-1 min-w-0 truncate">
                        {v.color} · {v.size}
                      </span>
                      <input
                        value={vskus[v.id] ?? ""}
                        onChange={(e) =>
                          setVskus((s) => ({ ...s, [v.id]: e.target.value }))
                        }
                        placeholder="SKU"
                        title="SKU da variação — usado pra vincular com a loja online (Nuvemshop)"
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-brand-400"
                      />
                      <input
                        value={stocks[v.id]}
                        onChange={(e) =>
                          setStocks((s) => ({
                            ...s,
                            [v.id]: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        inputMode="numeric"
                        className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-xs text-right outline-none focus:border-brand-400"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setRemovedIds((prev) => [...prev, v.id])
                        }
                        className="text-gray-300 hover:text-rose-500 transition p-0.5"
                        title="Remover variação"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                {pendingAdds.map((v, i) => (
                  <div
                    key={`new-${i}`}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50/60"
                  >
                    <span className="text-xs font-medium flex-1">
                      {v.color} · {v.size}{" "}
                      <span className="text-emerald-600">(nova)</span>
                    </span>
                    <span className="text-xs tabular-nums">{v.stock}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAdds((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="text-gray-300 hover:text-rose-500 p-0.5"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 mt-2">
                <select
                  value={newVariant.color}
                  onChange={(e) =>
                    setNewVariant((v) => ({ ...v, color: e.target.value }))
                  }
                  className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white outline-none"
                >
                  {libraryColors.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newVariant.size}
                  onChange={(e) =>
                    setNewVariant((v) => ({ ...v, size: e.target.value }))
                  }
                  className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white outline-none"
                >
                  {librarySizes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  value={newVariant.stock}
                  onChange={(e) =>
                    setNewVariant((v) => ({
                      ...v,
                      stock: e.target.value.replace(/\D/g, ""),
                    }))
                  }
                  inputMode="numeric"
                  className="w-14 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-right outline-none"
                />
                <button
                  type="button"
                  onClick={addPendingVariant}
                  className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-2.5 transition"
                  title="Adicionar variação"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Cores e tamanhos vêm da sua biblioteca em{" "}
                <a href="/configuracoes/catalogo" className="text-brand-600 underline">
                  Personalizar catálogo
                </a>
                . Ajustes de estoque ficam no histórico de movimentações.
              </p>

              <button
                type="button"
                onClick={verHistorico}
                className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-brand-600 transition"
              >
                <History className="size-3.5" />
                {histAberto ? "Ocultar histórico de estoque" : "Ver histórico de estoque"}
              </button>

              {histAberto && (
                <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
                  {histBusy ? (
                    <p className="flex items-center gap-1.5 text-xs text-gray-400 px-1 py-2">
                      <Loader2 className="size-3.5 animate-spin" /> Carregando…
                    </p>
                  ) : !hist || hist.length === 0 ? (
                    <p className="text-xs text-gray-400 px-1 py-2">
                      Nenhuma movimentação registrada nesta peça ainda.
                    </p>
                  ) : (
                    <ul className="max-h-52 overflow-y-auto thin-scroll divide-y divide-gray-100">
                      {hist.map((m) => {
                        const sinal = m.type === "SAIDA" ? "−" : m.type === "ENTRADA" ? "+" : "±";
                        const cor =
                          m.type === "SAIDA"
                            ? "text-rose-600"
                            : m.type === "ENTRADA"
                            ? "text-emerald-600"
                            : "text-amber-600";
                        return (
                          <li key={m.id} className="flex items-start gap-2 py-1.5 px-1">
                            <span className={`text-xs font-bold tabular-nums shrink-0 ${cor}`}>
                              {sinal}
                              {m.quantity}
                            </span>
                            <span className="text-[11px] text-gray-600 flex-1 min-w-0 leading-snug">
                              <b className="text-gray-800">{m.variacao}</b> — {m.reason || "—"}
                            </span>
                            <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                              {new Date(m.createdAt).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1.5 px-1 leading-snug">
                    Cada linha mostra o que mexeu no estoque: ajuste manual, venda,
                    reserva de orçamento ou sincronização da loja online (Nuvemshop/Jueri).
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-6">
          <button
            onClick={removeProduct}
            disabled={busy}
            className="rounded-xl border border-gray-200 text-gray-400 hover:border-rose-300 hover:text-rose-600 text-sm font-medium px-3 py-2.5 transition disabled:opacity-60"
            title="Remover produto"
          >
            <Trash2 className="size-4" />
          </button>
          <button
            onClick={toggleActive}
            disabled={busy}
            className={`rounded-xl text-sm font-medium px-4 py-2.5 transition disabled:opacity-60 ${
              product.active
                ? "border border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            }`}
          >
            {product.active ? "Desativar" : "Reativar"}
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-60"
          >
            {busy ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div></Portal>
  );
}

/**
 * Galeria de fotos do produto: sobe VÁRIAS de uma vez, remove uma a uma e
 * escolhe a capa (estrela → vira a primeira). A posição 0 é sempre a capa —
 * é ela que aparece na grade, no catálogo e na sacola.
 */
function PhotoManager({
  photos,
  onChange,
  max = 10,
  mediaLibrary = false,
}: {
  photos: { id?: string; url: string }[];
  onChange: (p: { id?: string; url: string }[]) => void;
  max?: number;
  mediaLibrary?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const room = Math.max(0, max - photos.length);
    const list = [...photos];
    for (const f of Array.from(files).slice(0, room)) {
      list.push({ url: await fileToDataUrl(f) });
    }
    onChange(list);
  }

  function addFromLibrary(dataUrl: string) {
    if (photos.length >= max) return;
    onChange([...photos, { url: dataUrl }]);
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-4 gap-2">
        {photos.map((ph, i) => (
          <div
            key={ph.id ?? `nova-${i}-${ph.url.length}`}
            className="relative aspect-[3/4] rounded-xl overflow-hidden border border-gray-100 bg-gray-50"
          >
            <img src={ph.url} alt="" className="w-full h-full object-cover object-top" />
            {i === 0 ? (
              <span className="absolute top-1 left-1 bg-brand-600 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5">
                CAPA
              </span>
            ) : (
              <button
                type="button"
                title="Tornar esta a foto de capa"
                onClick={() =>
                  onChange([ph, ...photos.filter((_, j) => j !== i)])
                }
                className="absolute top-1 left-1 size-6 rounded-full bg-white/90 flex items-center justify-center text-amber-500 shadow hover:bg-white transition"
              >
                <Star className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              title="Remover foto"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 size-6 rounded-full bg-white/90 flex items-center justify-center text-gray-500 hover:text-rose-600 shadow transition"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="aspect-[3/4] rounded-xl border-2 border-dashed border-brand-200 hover:bg-brand-50 flex flex-col items-center justify-center gap-1 text-brand-600 transition"
          >
            <Upload className="size-4" />
            <span className="text-[10px] font-medium leading-tight text-center px-1">
              Adicionar fotos
            </span>
          </button>
        )}
        {mediaLibrary && photos.length < max && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="aspect-[3/4] rounded-xl border-2 border-dashed border-gray-200 hover:bg-gray-50 flex flex-col items-center justify-center gap-1 text-gray-500 transition"
          >
            <Images className="size-4" />
            <span className="text-[10px] font-medium leading-tight text-center px-1">
              Da biblioteca
            </span>
          </button>
        )}
      </div>
      {pickerOpen && (
        <LibraryPicker
          onClose={() => setPickerOpen(false)}
          onPick={(dataUrl) => {
            addFromLibrary(dataUrl);
            setPickerOpen(false);
          }}
        />
      )}
      <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
        Até {max} fotos. A <b>capa</b> aparece na grade e no catálogo — toque na{" "}
        <Star className="inline size-3 text-amber-500 -mt-0.5" /> pra trocar. No
        catálogo, o cliente desliza pro lado pra ver todas. Ideal: 3:4
        (1200×1600px).
      </p>
    </div>
  );
}

/** Seletor da Biblioteca de imagens: escolhe uma foto guardada e devolve
 *  como data-URL, pronta pra entrar como foto nova do produto. */
function LibraryPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (dataUrl: string) => void;
}) {
  const [assets, setAssets] = useState<{ id: string; name: string | null }[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pegando, setPegando] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/media");
      const d = await res.json().catch(() => ({}));
      setAssets(res.ok ? d.assets ?? [] : []);
      setLoading(false);
    })();
  }, []);

  async function escolher(id: string) {
    setPegando(id);
    try {
      const res = await fetch(`/api/media/${id}/raw`);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      onPick(dataUrl);
    } catch {
      setPegando(null);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
              <Images className="size-4 text-brand-600" />
              Biblioteca de imagens
            </h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
              <X className="size-4" />
            </button>
          </div>
          <div className="p-4 overflow-y-auto thin-scroll">
            {loading ? (
              <p className="flex items-center gap-1.5 text-sm text-gray-400 py-8 justify-center">
                <Loader2 className="size-4 animate-spin" /> Carregando…
              </p>
            ) : !assets || assets.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                Nenhuma imagem na biblioteca ainda. Suba fotos em{" "}
                <a href="/biblioteca" className="text-brand-600 underline">
                  Biblioteca de imagens
                </a>
                .
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {assets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => escolher(a.id)}
                    disabled={!!pegando}
                    className="relative aspect-square rounded-xl overflow-hidden border border-gray-100 hover:ring-2 hover:ring-brand-400 transition disabled:opacity-60"
                    title={a.name ?? "Escolher"}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${a.id}/raw`}
                      alt={a.name ?? ""}
                      className="w-full h-full object-cover bg-gray-50"
                      loading="lazy"
                    />
                    {pegando === a.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-white/60">
                        <Loader2 className="size-4 animate-spin text-brand-600" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

const PLACEHOLDER_IMAGES = [
  "/products/vestido-rosa.svg",
  "/products/vestido-vinho.svg",
  "/products/blusa-tricot.svg",
  "/products/calca-jeans.svg",
  "/products/conjunto-fitness.svg",
  "/products/conjunto-linho.svg",
  "/products/saia-midi.svg",
  "/products/cropped-basico.svg",
];

function NewProductModal({
  libraryColors,
  librarySizes,
  categories,
  collections,
  brands,
  mediaLibrary = false,
  onClose,
  onCreated,
}: {
  libraryColors: LibraryColor[];
  librarySizes: string[];
  categories: string[];
  collections: string[];
  brands: string[];
  mediaLibrary?: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<{ id?: string; url: string }[]>([]);
  const [selColors, setSelColors] = useState<string[]>(
    libraryColors[0] ? [libraryColors[0].name] : []
  );
  const [selSizes, setSelSizes] = useState<string[]>(librarySizes.slice(0, 3));
  const [stockPerVariant, setStockPerVariant] = useState("5");

  const toggle = (list: string[], set: (v: string[]) => void, item: string) =>
    set(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selColors.length === 0 || selSizes.length === 0) {
      setError("Selecione ao menos uma cor e um tamanho.");
      return;
    }
    setSaving(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const num = (name: string) =>
      parseFloat(String(fd.get(name) ?? "0").replace(",", ".")) || 0;

    const stock = parseInt(stockPerVariant) || 0;
    const variants = selColors.flatMap((color) =>
      selSizes.map((size) => ({ color, size, stock }))
    );

    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        sku: fd.get("sku"),
        category: fd.get("category"),
        brand: fd.get("brand") || undefined,
        collection: fd.get("collection") || undefined,
        description: fd.get("description") || undefined,
        videoUrl: fd.get("videoUrl") || undefined,
        costPrice: num("costPrice"),
        wholesalePrice: num("wholesalePrice"),
        retailPrice: num("retailPrice"),
        minQuantity: parseInt(String(fd.get("minQuantity"))) || 1,
        weightGrams: parseInt(String(fd.get("weightGrams"))) || undefined,
        tags: fd.get("tags") || undefined,
        images: photos.length
          ? photos.map((p) => p.url)
          : [PLACEHOLDER_IMAGES[0]],
        variants,
      }),
    });
    setSaving(false);
    if (res.ok) onCreated();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar produto");
    }
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-6 animate-fade-up"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">Novo produto</h3>
          <button type="button" onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div>
              <label className={label}>Nome *</label>
              <input name="name" required className={input} placeholder="Vestido midi alfaiataria" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>SKU *</label>
                <input name="sku" required className={input} placeholder="VES-021" />
              </div>
              <div>
                <label className={label}>Categoria *</label>
                <input
                  name="category"
                  required
                  list="new-cat-list"
                  className={input}
                  placeholder="Escolha ou crie"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Marca</label>
                <input
                  name="brand"
                  list="new-brand-list"
                  className={input}
                  placeholder="Escolha ou crie"
                />
              </div>
              <div>
                <label className={label}>Coleção</label>
                <input
                  name="collection"
                  list="new-collection-list"
                  className={input}
                  placeholder="Escolha ou crie"
                />
              </div>
            </div>
            <datalist id="new-cat-list">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <datalist id="new-brand-list">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <datalist id="new-collection-list">
              {collections.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div>
              <label className={label}>Descrição</label>
              <textarea name="description" rows={2} className={input} />
            </div>
            <div>
              <label className={label}>Vídeo (URL, opcional)</label>
              <input name="videoUrl" className={input} placeholder="https://..." />
            </div>
            <div>
              <label className={label}>Tags (separadas por vírgula)</label>
              <input name="tags" className={input} placeholder="lançamento, festa" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={label}>Custo</label>
                <input name="costPrice" className={input} placeholder="0,00" inputMode="decimal" />
              </div>
              <div>
                <label className={label}>Atacado</label>
                <input name="wholesalePrice" className={input} placeholder="0,00" inputMode="decimal" />
              </div>
              <div>
                <label className={label}>Varejo *</label>
                <input name="retailPrice" required className={input} placeholder="0,00" inputMode="decimal" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Qtd mínima atacado</label>
                <input name="minQuantity" defaultValue="1" className={input} inputMode="numeric" />
              </div>
              <div>
                <label className={label}>Peso da peça (g)</label>
                <input name="weightGrams" className={input} inputMode="numeric" placeholder="Ex.: 250" />
              </div>
            </div>
            <div>
              <label className={label}>Cores (grade) *</label>
              <div className="flex flex-wrap gap-1.5">
                {libraryColors.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => toggle(selColors, setSelColors, c.name)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition border ${
                      selColors.includes(c.name)
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-brand-300"
                    }`}
                  >
                    <span
                      className="size-3 rounded-full border border-black/10"
                      style={{ background: c.hex }}
                    />
                    {c.name}
                  </button>
                ))}
                <a
                  href="/configuracoes/catalogo"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-brand-600 border border-dashed border-brand-300 hover:bg-brand-50 transition"
                >
                  <Palette className="size-3" />
                  criar cor
                </a>
              </div>
            </div>
            <div>
              <label className={label}>Tamanhos *</label>
              <div className="flex flex-wrap gap-1.5">
                {librarySizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggle(selSizes, setSelSizes, s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                      selSizes.includes(s)
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-brand-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>Estoque por variação</label>
              <input
                value={stockPerVariant}
                onChange={(e) => setStockPerVariant(e.target.value.replace(/\D/g, ""))}
                className={input}
                inputMode="numeric"
              />
            </div>
            <div>
              <label className={label}>Fotos</label>
              <PhotoManager photos={photos} onChange={setPhotos} mediaLibrary={mediaLibrary} />
              {photos.length === 0 && (
                <p className="text-[10px] text-gray-400 mt-1">
                  Sem foto? Tudo bem — o produto nasce com uma ilustração
                  provisória e você troca depois.
                </p>
              )}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-4">
            {error}
          </p>
        )}
        <button
          disabled={saving}
          className="mt-5 w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Cadastrar produto"}
        </button>
      </form>
    </div></Portal>
  );
}
