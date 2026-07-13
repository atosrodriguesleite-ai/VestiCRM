"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Palette, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { brl } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { fileToDataUrl } from "@/lib/upload";
import { ImportCatalog } from "./import-catalog";

type LibraryColor = { name: string; hex: string };

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
  active: boolean;
  tags: string | null;
  images: string[];
  variants: { id: string; color: string; size: string; stock: number }[];
};

export function totalStock(p: ProductItem) {
  return p.variants.reduce((s, v) => s + v.stock, 0);
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
}: {
  initial: ProductItem[];
  categories: string[];
  collections: string[];
  brands: string[];
  colors: string[];
  sizes: string[];
  libraryColors: LibraryColor[];
  librarySizes: string[];
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
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<ProductItem | null>(null);

  const filtered = useMemo(
    () =>
      initial.filter((p) => {
        if (
          q &&
          !p.name.toLowerCase().includes(q.toLowerCase()) &&
          !p.sku.toLowerCase().includes(q.toLowerCase())
        )
          return false;
        if (category && p.category !== category) return false;
        if (collection && p.collection !== collection) return false;
        if (brand && p.brand !== brand) return false;
        if (color && !p.variants.some((v) => v.color === color)) return false;
        if (size && !p.variants.some((v) => v.size === size)) return false;
        if (maxPrice && p.retailPrice > Number(maxPrice)) return false;
        if (onlyStock && totalStock(p) === 0) return false;
        return true;
      }),
    [initial, q, category, collection, brand, color, size, maxPrice, onlyStock]
  );

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
                      src={p.images[0]}
                      alt={p.name}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition"
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
                  {stock === 0 && p.active && (
                    <span className="absolute top-2 left-2 bg-rose-600/90 text-white text-[10px] font-medium rounded-full px-2 py-0.5">
                      Sem estoque
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
  onClose,
  onChanged,
}: {
  product: ProductItem;
  libraryColors: LibraryColor[];
  librarySizes: string[];
  categories: string[];
  collections: string[];
  brands: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
    tags: product.tags ?? "",
  });
  const [image, setImage] = useState(product.images[0] ?? PLACEHOLDER_IMAGES[0]);
  const [stocks, setStocks] = useState<Record<string, string>>(
    Object.fromEntries(product.variants.map((v) => [v.id, String(v.stock)]))
  );

  const num = (v: string) => parseFloat(v.replace(",", ".")) || 0;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    await fetch(`/api/products/${product.id}`, {
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
        tags: form.tags || null,
        imageUrl: image,
        variantStocks: Object.entries(stocks)
          .filter(([id]) => !removedIds.includes(id))
          .map(([id, stock]) => ({ id, stock: parseInt(stock) || 0 })),
        addVariants: pendingAdds,
        removeVariantIds: removedIds,
      }),
    });
    setBusy(false);
    onChanged();
  }

  async function toggleActive() {
    setBusy(true);
    await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !product.active }),
    });
    setBusy(false);
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
    await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  async function uploadPhoto(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setImage(dataUrl);
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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-3xl max-h-[92dvh] overflow-y-auto thin-scroll animate-fade-up p-6">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <h3 className="font-semibold text-lg leading-tight">
              Editar produto
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {product.sku} · alterações aparecem na hora no catálogo público
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
          </div>

          <div className="space-y-3">
            <div>
              <label className={label}>Foto do produto</label>
              <div className="flex gap-3">
                <img
                  src={image}
                  alt=""
                  className="size-24 rounded-xl object-cover border border-gray-100 shrink-0"
                />
                <div className="flex-1 space-y-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadPhoto(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-medium py-2 transition"
                  >
                    <Upload className="size-3.5" />
                    Enviar foto do computador/celular
                  </button>
                  <div className="grid grid-cols-4 gap-1.5">
                    {PLACEHOLDER_IMAGES.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setImage(url)}
                        className={`aspect-square rounded-lg overflow-hidden border-2 transition ${
                          image === url ? "border-brand-500" : "border-transparent"
                        }`}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className={label}>Grade e estoque (cor · tamanho)</label>
              <div className="max-h-44 overflow-y-auto thin-scroll rounded-xl border border-gray-100 divide-y divide-gray-50">
                {product.variants
                  .filter((v) => !removedIds.includes(v.id))
                  .map((v) => (
                    <div key={v.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-xs font-medium flex-1">
                        {v.color} · {v.size}
                      </span>
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
    </div>
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
  onClose,
  onCreated,
}: {
  libraryColors: LibraryColor[];
  librarySizes: string[];
  categories: string[];
  collections: string[];
  brands: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState(PLACEHOLDER_IMAGES[0]);
  const fileRef = useRef<HTMLInputElement>(null);
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
        tags: fd.get("tags") || undefined,
        images: [image],
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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[92dvh] overflow-y-auto thin-scroll p-6 animate-fade-up"
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
            <div>
              <label className={label}>Qtd mínima atacado</label>
              <input name="minQuantity" defaultValue="1" className={input} inputMode="numeric" />
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
              <label className={label}>Foto</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setImage(await fileToDataUrl(f));
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-medium py-2 mb-2 transition"
              >
                <Upload className="size-3.5" />
                Enviar foto do computador/celular
              </button>
              <div className="grid grid-cols-5 gap-1.5">
                {[image.startsWith("data:") ? image : null, ...PLACEHOLDER_IMAGES]
                  .filter(Boolean)
                  .slice(0, 5)
                  .map((url) => (
                    <button
                      key={url as string}
                      type="button"
                      onClick={() => setImage(url as string)}
                      className={`aspect-square rounded-xl overflow-hidden border-2 transition ${
                        image === url ? "border-brand-500" : "border-transparent"
                      }`}
                    >
                      <img src={url as string} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
              </div>
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
    </div>
  );
}
