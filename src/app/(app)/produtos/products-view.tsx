"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus, Search, X } from "lucide-react";
import { brl } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";

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
}: {
  initial: ProductItem[];
  categories: string[];
  collections: string[];
  brands: string[];
  colors: string[];
  sizes: string[];
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
        <button
          onClick={() => setShowNew(true)}
          className="ml-auto flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Novo produto</span>
          <span className="sm:hidden">Novo</span>
        </button>
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
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null);
            router.refresh();
          }}
        />
      )}
      {showNew && (
        <NewProductModal
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

/** Editor completo do produto: a loja altera foto, textos, preços e estoque. */
function ProductDetailModal({
  product,
  onClose,
  onChanged,
}: {
  product: ProductItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
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
        variantStocks: Object.entries(stocks).map(([id, stock]) => ({
          id,
          stock: parseInt(stock) || 0,
        })),
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
                <input value={form.category} onChange={set("category")} className={input} />
              </div>
              <div>
                <label className={label}>Marca</label>
                <input value={form.brand} onChange={set("brand")} className={input} />
              </div>
            </div>
            <div>
              <label className={label}>Coleção</label>
              <input value={form.collection} onChange={set("collection")} className={input} />
            </div>
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
              <label className={label}>Foto principal</label>
              <div className="flex gap-3">
                <img
                  src={image}
                  alt=""
                  className="size-24 rounded-xl object-cover border border-gray-100 shrink-0"
                />
                <div className="grid grid-cols-4 gap-1.5 flex-1">
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
              <input
                value={image}
                onChange={(e) => setImage(e.target.value)}
                className={`${input} mt-2`}
                placeholder="ou cole a URL de uma foto sua"
              />
            </div>

            <div>
              <label className={label}>Estoque por variação (cor · tamanho)</label>
              <div className="max-h-56 overflow-y-auto thin-scroll rounded-xl border border-gray-100 divide-y divide-gray-50">
                {product.variants.map((v) => (
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
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-xs text-right outline-none focus:border-brand-400"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Ajustes de estoque ficam registrados no histórico de movimentações.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={toggleActive}
            disabled={busy}
            className={`rounded-xl text-sm font-medium px-4 py-2.5 transition disabled:opacity-60 ${
              product.active
                ? "border border-gray-200 text-gray-500 hover:border-rose-300 hover:text-rose-600"
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
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState(PLACEHOLDER_IMAGES[0]);
  const [colorsInput, setColorsInput] = useState("Rosa");
  const [sizesInput, setSizesInput] = useState("P, M, G");
  const [stockPerVariant, setStockPerVariant] = useState("5");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const num = (name: string) =>
      parseFloat(String(fd.get(name) ?? "0").replace(",", ".")) || 0;

    const colors = colorsInput.split(",").map((c) => c.trim()).filter(Boolean);
    const sizes = sizesInput.split(",").map((s) => s.trim()).filter(Boolean);
    const stock = parseInt(stockPerVariant) || 0;
    const variants = colors.flatMap((color) =>
      sizes.map((size) => ({ color, size, stock }))
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
                <input name="category" required className={input} placeholder="Vestidos" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Marca</label>
                <input name="brand" className={input} placeholder="Bella Moda" />
              </div>
              <div>
                <label className={label}>Coleção</label>
                <input name="collection" className={input} placeholder="Verão 2027" />
              </div>
            </div>
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
              <input
                value={colorsInput}
                onChange={(e) => setColorsInput(e.target.value)}
                className={input}
                placeholder="Rosa, Preto"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Tamanhos *</label>
                <input
                  value={sizesInput}
                  onChange={(e) => setSizesInput(e.target.value)}
                  className={input}
                  placeholder="P, M, G"
                />
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
            </div>
            <div>
              <label className={label}>Foto</label>
              <div className="grid grid-cols-4 gap-2">
                {PLACEHOLDER_IMAGES.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setImage(url)}
                    className={`aspect-square rounded-xl overflow-hidden border-2 transition ${
                      image === url ? "border-brand-500" : "border-transparent"
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Upload de fotos reais chega com o armazenamento de arquivos; o
                modelo já suporta múltiplas imagens por URL.
              </p>
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
