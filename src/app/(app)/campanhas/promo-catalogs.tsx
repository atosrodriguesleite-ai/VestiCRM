"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Catálogos de campanha: vitrine à parte com produtos selecionados e um
 * desconto próprio. Cada campanha ganha link + QR Code para divulgar; o
 * catálogo geral da loja continua intacto.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  ExternalLink,
  Plus,
  QrCode,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Card } from "@/components/ui";

export type PromoItem = {
  id: string;
  name: string;
  slug: string;
  discount: number;
  active: boolean;
  products: number;
};

export type PromoProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  image: string | null;
  retailPrice: number;
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PromoCatalogs({
  initial,
  products,
  linkBase, // ex.: https://catalago.net/bella-moda  ou  /catalogo/bella-moda
}: {
  initial: PromoItem[];
  products: PromoProduct[];
  linkBase: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [showNew, setShowNew] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const promoLink = (slug: string) => `${linkBase}/c/${slug}`;
  const absoluteLink = (slug: string) =>
    promoLink(slug).startsWith("http")
      ? promoLink(slug)
      : `${window.location.origin}${promoLink(slug)}`;

  async function copiar(slug: string) {
    try {
      await navigator.clipboard.writeText(absoluteLink(slug));
      setCopied(slug);
      setTimeout(() => setCopied(null), 1600);
    } catch {}
  }

  async function toggleActive(p: PromoItem) {
    setList((l) => l.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)));
    await fetch(`/api/promo-catalogs/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !p.active }),
    });
    router.refresh();
  }

  async function remover(p: PromoItem) {
    if (
      !window.confirm(
        `Excluir a campanha "${p.name}"? O link dela para de funcionar (os pedidos já feitos ficam).`
      )
    )
      return;
    setList((l) => l.filter((x) => x.id !== p.id));
    await fetch(`/api/promo-catalogs/${p.id}`, { method: "DELETE" });
  }

  return (
    <Card className="p-5 mb-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <Tag className="size-4 text-brand-600" />
          Catálogos de campanha
        </h2>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
        >
          <Plus className="size-4" />
          Novo catálogo
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Um catálogo à parte, só com as peças escolhidas e um desconto próprio —
        perfeito pra promoção relâmpago, queima de estoque ou lançamento. O
        catálogo geral não muda.
      </p>

      {list.length === 0 ? (
        <p className="text-sm text-gray-400">
          Nenhum catálogo de campanha ainda — crie o primeiro.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 flex-wrap ${
                p.active ? "border-gray-100" : "border-gray-100 opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">
                  {p.name}{" "}
                  <span className="text-brand-700 font-bold">-{p.discount}%</span>
                  {!p.active && (
                    <span className="ml-2 text-[10px] font-medium uppercase text-gray-400">
                      pausada
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400 truncate">
                  {p.products} produto{p.products === 1 ? "" : "s"} ·{" "}
                  {promoLink(p.slug).replace(/^https?:\/\//, "")}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => copiar(p.slug)}
                  title="Copiar link"
                  className="flex items-center gap-1 rounded-lg border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-2.5 py-1.5 transition"
                >
                  <Copy className="size-3.5" />
                  {copied === p.slug ? "Copiado ✓" : "Link"}
                </button>
                <a
                  href={`/api/qrcode?url=${encodeURIComponent(
                    promoLink(p.slug).startsWith("http")
                      ? promoLink(p.slug)
                      : `https://www.atacadopro.com${promoLink(p.slug)}`
                  )}`}
                  download={`qr-campanha-${p.slug}.svg`}
                  title="Baixar QR Code da campanha"
                  className="rounded-lg border border-gray-200 hover:border-brand-300 text-gray-600 p-1.5 transition"
                >
                  <QrCode className="size-3.5" />
                </a>
                <a
                  href={promoLink(p.slug)}
                  target="_blank"
                  title="Abrir catálogo da campanha"
                  className="rounded-lg border border-gray-200 hover:border-brand-300 text-gray-600 p-1.5 transition"
                >
                  <ExternalLink className="size-3.5" />
                </a>
                <button
                  onClick={() => toggleActive(p)}
                  className={`rounded-lg text-xs font-medium px-2.5 py-1.5 border transition ${
                    p.active
                      ? "border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {p.active ? "Pausar" : "Reativar"}
                </button>
                <button
                  onClick={() => remover(p)}
                  title="Excluir campanha"
                  className="rounded-lg border border-gray-200 text-gray-400 hover:border-rose-300 hover:text-rose-600 p-1.5 transition"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewPromoModal
          products={products}
          onClose={() => setShowNew(false)}
          onCreated={(p) => {
            setList((l) => [p, ...l]);
            setShowNew(false);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function NewPromoModal({
  products,
  onClose,
  onCreated,
}: {
  products: PromoProduct[];
  onClose: () => void;
  onCreated: (p: PromoItem) => void;
}) {
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("10");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.sku.toLowerCase().includes(q.toLowerCase()) ||
          p.category.toLowerCase().includes(q.toLowerCase())
      ),
    [products, q]
  );

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function salvar() {
    const d = parseInt(discount) || 0;
    if (name.trim().length < 2) return setError("Dê um nome pra campanha.");
    if (d < 1 || d > 90) return setError("Desconto entre 1% e 90%.");
    if (sel.size === 0) return setError("Escolha ao menos um produto.");
    setSaving(true);
    setError("");
    const res = await fetch("/api/promo-catalogs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), discount: d, productIds: [...sel] }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) onCreated(data);
    else setError(data.error ?? "Não foi possível criar a campanha.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-6 animate-fade-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Nova campanha</h3>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Nome da campanha
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Queima de Inverno"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Desconto (%)
            </label>
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
        </div>

        <label className="block text-xs font-medium text-gray-500 mb-1">
          Produtos da campanha ({sel.size} selecionado{sel.size === 1 ? "" : "s"})
        </label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, SKU ou categoria..."
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 mb-2"
        />
        <div className="max-h-72 overflow-y-auto thin-scroll rounded-xl border border-gray-100 divide-y divide-gray-50">
          {filtered.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-brand-50/40 transition"
            >
              <input
                type="checkbox"
                checked={sel.has(p.id)}
                onChange={() => toggle(p.id)}
                className="size-4 accent-brand-600 shrink-0"
              />
              {p.image ? (
                <img
                  src={p.image}
                  alt=""
                  className="size-9 rounded-lg object-cover object-top border border-gray-100 shrink-0"
                />
              ) : (
                <span className="size-9 rounded-lg bg-gray-100 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{p.name}</span>
                <span className="block text-[11px] text-gray-400 truncate">
                  {p.sku} · {p.category} · {brl(p.retailPrice)}
                </span>
              </span>
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-gray-400 p-3">Nenhum produto encontrado.</p>
          )}
        </div>

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{error}</p>
        )}
        <button
          onClick={salvar}
          disabled={saving}
          className="mt-4 w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
        >
          {saving ? "Criando…" : "Criar campanha e gerar link"}
        </button>
      </div>
    </div>
  );
}
