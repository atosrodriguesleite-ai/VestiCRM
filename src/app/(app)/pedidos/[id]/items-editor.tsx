"use client";

import { catalogPrice } from "@/lib/orders";

/**
 * Edição dos itens do pedido — ajustar quantidades, remover ou adicionar
 * produtos a qualquer momento (exceto pedido cancelado). Em pedido já pago,
 * o estoque e o faturamento são acertados automaticamente no servidor.
 */

import { useEffect, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2, Search, Pencil } from "lucide-react";
import { brl } from "@/lib/format";

type ApiVariant = { id: string; color: string; size: string; stock: number };
type ApiProduct = {
  id: string;
  name: string;
  sku: string;
  wholesalePrice: number;
  retailPrice: number;
  images: { url: string }[];
  variants: ApiVariant[];
};
type Line = {
  productId: string;
  variantId: string;
  name: string;
  variant: string;
  stock: number;
  quantity: number;
  unitPrice: number;
};

export function ItemsEditor({
  orderId,
  initialItems,
  discount,
  shippingFee,
  alreadyPaid = false,
  priceMode = null,
}: {
  orderId: string;
  initialItems: Line[];
  discount: number;
  shippingFee: number;
  alreadyPaid?: boolean;
  /**
   * TABELA que precificou o pedido (do link de atacado/varejo). O item
   * acrescentado depois segue a MESMA tabela — antes o sistema sugeria
   * atacado sempre que existisse, inclusive num pedido de varejo (revisão
   * 18/08/2026).
   */
  priceMode?: string | null;
}) {
  /** preço a sugerir para uma peça nova: a tabela do pedido manda. */
  const precoSugerido = (p: { wholesalePrice: number; retailPrice: number }) =>
    catalogPrice(p, priceMode);

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(initialItems);
  const [prodQuery, setProdQuery] = useState("");
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [picking, setPicking] = useState<ApiProduct | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || prodQuery.trim().length < 1) {
      setProducts([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/products?q=${encodeURIComponent(prodQuery.trim())}`);
      if (res.ok) setProducts(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [prodQuery, open]);

  function addLine(p: ApiProduct, v: ApiVariant) {
    setLines((prev) => {
      const ex = prev.find((l) => l.variantId === v.id);
      if (ex) return prev.map((l) => (l.variantId === v.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...prev,
        {
          productId: p.id, variantId: v.id, name: p.name,
          variant: [v.color, v.size].filter(Boolean).join(" · "),
          stock: v.stock, quantity: 1,
          unitPrice: precoSugerido(p),
        },
      ];
    });
    setPicking(null);
    setProdQuery("");
  }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = subtotal - discount + shippingFee;

  async function save() {
    setError("");
    if (lines.length === 0) return setError("O pedido precisa ter ao menos um item.");
    setSaving(true);
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((l) => ({
          productId: l.productId, variantId: l.variantId,
          quantity: l.quantity, unitPrice: l.unitPrice,
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return setError(d?.error ?? "Não foi possível salvar os itens.");
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 transition"
      >
        <Pencil className="size-3.5" />
        Editar itens
      </button>
    );
  }

  const inputCls = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300";

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setOpen(false)} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-6 animate-fade-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Editar itens do pedido</h3>
          <button onClick={() => setOpen(false)} className="text-gray-400 p-1"><X className="size-5" /></button>
        </div>

        {alreadyPaid && (
          <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Este pedido já foi pago. Ao salvar, o <strong>estoque é ajustado
            automaticamente</strong> (devolve o que sair, baixa o que entrar) e o
            faturamento acompanha o novo total.
          </p>
        )}

        {/* buscar/adicionar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-300" />
          <input value={prodQuery} onChange={(e) => setProdQuery(e.target.value)} placeholder="Adicionar produto (nome ou SKU)…" className={`${inputCls} pl-9`} />
          {prodQuery.trim() && !picking && (
            <div className="absolute z-10 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-pop max-h-56 overflow-y-auto">
              {products.slice(0, 8).map((p) => (
                <button key={p.id} onClick={() => setPicking(p)} className="w-full flex items-center gap-3 text-left px-3 py-2 hover:bg-brand-50 transition">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.images[0] ? <img src={p.images[0].url} alt="" className="size-9 rounded-lg object-cover bg-gray-50" /> : <span className="size-9 rounded-lg bg-gray-100" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{p.name}</span>
                    <span className="block text-xs text-gray-400">{p.sku} · {brl(p.wholesalePrice > 0 ? p.wholesalePrice : p.retailPrice)}</span>
                  </span>
                </button>
              ))}
              {products.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhum produto encontrado.</p>}
            </div>
          )}
        </div>
        {picking && (
          <div className="mb-4 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">{picking.name} — escolha a variação</p>
              <button onClick={() => setPicking(null)} className="text-gray-400 p-1"><X className="size-4" /></button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {picking.variants.map((v) => (
                <button key={v.id} onClick={() => addLine(picking, v)} className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-brand-600 hover:text-white transition">
                  {[v.color, v.size].filter(Boolean).join(" ")} ({v.stock})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* itens */}
        <div className="rounded-xl border border-gray-100 divide-y divide-gray-50 mb-4">
          {/* CADA LINHA É ELA MESMA. Antes a tela mexia na linha PELO VÍNCULO
              (variantId): duas peças que perderam o vínculo ficavam com o
              mesmo "" e viravam a MESMA linha — subir a quantidade de uma
              subia a da outra, e apagar uma apagava as duas. Agora é pela
              POSIÇÃO, que é única sempre. */}
          {lines.map((l, i) => {
            // Item sem vínculo com a peça atual (ex.: catálogo reimportado e a
            // religação não achou par). NÃO é estoque zero — dizer "estoque 0
            // (insuficiente)" aqui já quase fez a loja desistir de uma venda
            // com a peça cheia na Nuvemshop. Fala a verdade: perdeu o vínculo.
            const semVinculo = !l.variantId;
            const falta = !semVinculo && l.quantity > l.stock;
            const trocar = (mudanca: Partial<Line>) =>
              setLines((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...mudanca } : x)));
            return (
              <div key={l.variantId || `sem-vinculo-${i}`} className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{l.name}</p>
                  <p className={`text-xs ${falta ? "text-rose-500" : semVinculo ? "text-amber-600" : "text-gray-400"}`}>
                    {l.variant}
                    {semVinculo
                      ? " · peça não está mais no catálogo (apague a linha e adicione de novo)"
                      : ` · estoque ${l.stock}${falta ? " (insuficiente)" : ""}`}
                  </p>
                </div>
                <input type="number" min={1} value={l.quantity}
                  onChange={(e) => trocar({ quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                  className={`w-16 rounded-lg border px-2 py-1.5 text-sm text-center ${falta ? "border-rose-300" : "border-gray-200"}`} />
                <input value={String(l.unitPrice)}
                  onChange={(e) => trocar({ unitPrice: parseFloat(e.target.value.replace(",", ".")) || 0 })}
                  inputMode="decimal" className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-right" />
                <span className="w-20 text-right text-sm font-semibold tabular-nums">{brl(l.quantity * l.unitPrice)}</span>
                <button onClick={() => setLines((prev) => prev.filter((_, xi) => xi !== i))} className="text-gray-300 hover:text-rose-500 p-1"><Trash2 className="size-4" /></button>
              </div>
            );
          })}
        </div>

        {error && <p className="mb-3 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Total: <span className="text-base font-bold text-brand-700 tabular-nums">{brl(Math.max(total, 0))}</span></p>
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="rounded-xl border border-gray-200 text-gray-500 text-sm font-medium px-4 py-2.5 transition hover:bg-gray-50">Cancelar</button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60">
              <Plus className="size-4" />{saving ? "Salvando…" : "Salvar itens"}
            </button>
          </div>
        </div>
      </div>
    </div></Portal>
  );
}
