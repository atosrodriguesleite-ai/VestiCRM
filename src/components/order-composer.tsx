"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { Portal } from "@/components/portal";
import {
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { brl, numeroBR } from "@/lib/format";
import { computeOrderTotals, unitPriceFor } from "@/lib/orders";

type ApiProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  retailPrice: number;
  wholesalePrice: number;
  minQuantity: number;
  images: { url: string }[];
  variants: { id: string; color: string; size: string; stock: number }[];
};

export type CartLine = {
  productId: string;
  variantId: string;
  name: string;
  imageUrl: string | null;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  maxStock: number;
};

/**
 * Fluxo "pedido em menos de 60s": busca → variação → carrinho → finalizar,
 * sem sair da conversa. Usado na central de WhatsApp e reutilizável em
 * qualquer tela que tenha um cliente em contexto.
 */
export function OrderComposer({
  customerId,
  customerName,
  wholesaleCustomer,
  conversationId,
  onClose,
  onCreated,
}: {
  customerId: string;
  customerName: string;
  wholesaleCustomer: boolean;
  conversationId?: string;
  onClose: () => void;
  onCreated: (order: { id: string; number: number; total: number }) => void;
}) {
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<ApiProduct | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [surcharge, setSurcharge] = useState("");
  const [shipping, setShipping] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState("PIX");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mobileCart, setMobileCart] = useState(false);

  useEffect(() => {
    setLoading(true);
    // aborta a busca anterior: sem isso uma resposta LENTA e antiga
    // sobrescrevia a lista do que foi digitado por último
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/products?comEstoque=1${q ? `&q=${encodeURIComponent(q)}` : ""}`,
          { signal: ctrl.signal }
        );
        if (res.ok) setProducts(await res.json());
        setLoading(false);
      } catch { /* busca abortada */ }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const totals = useMemo(
    () =>
      computeOrderTotals(
        cart,
        numeroBR(discount),
        numeroBR(shipping),
        numeroBR(surcharge)
      ),
    [cart, discount, shipping, surcharge]
  );
  const itemCount = cart.reduce((s, c) => s + c.quantity, 0);

  function addLine(product: ApiProduct, variantId: string, quantity: number) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) return;
    const unitPrice = unitPriceFor(product, quantity, wholesaleCustomer);
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variantId);
      if (existing) {
        return prev.map((l) =>
          l.variantId === variantId
            ? {
                ...l,
                quantity: Math.min(l.quantity + quantity, l.maxStock),
                unitPrice: unitPriceFor(
                  product,
                  l.quantity + quantity,
                  wholesaleCustomer
                ),
              }
            : l
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          variantId,
          name: product.name,
          imageUrl: product.images[0]?.url ?? null,
          color: variant.color,
          size: variant.size,
          quantity,
          unitPrice,
          maxStock: variant.stock,
        },
      ];
    });
    setPicking(null);
  }

  function changeQty(variantId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.variantId === variantId
            ? {
                ...l,
                quantity: Math.max(
                  0,
                  Math.min(l.quantity + delta, l.maxStock)
                ),
              }
            : l
        )
        .filter((l) => l.quantity > 0)
    );
  }

  async function finalize(status: "ORCAMENTO" | "AGUARDANDO_PAGAMENTO") {
    if (cart.length === 0 || saving) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        conversationId,
        items: cart.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        discount: numeroBR(discount),
        surcharge: numeroBR(surcharge),
        shippingFee: numeroBR(shipping),
        notes: notes || undefined,
        paymentMethod: payment,
        status,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onCreated(await res.json());
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar pedido");
    }
  }

  const cartPanel = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <ShoppingBag className="size-4 text-brand-600" />
          Carrinho ({itemCount})
        </h4>
        <button
          onClick={() => setMobileCart(false)}
          className="md:hidden text-gray-400 p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll px-4 space-y-2">
        {cart.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-10">
            Busque um produto e adicione ao pedido.
          </p>
        )}
        {cart.map((l) => (
          <div
            key={l.variantId}
            className="flex gap-2.5 items-center bg-gray-50 rounded-xl p-2"
          >
            {l.imageUrl ? (
              <img
                src={l.imageUrl}
                alt=""
                className="size-11 rounded-lg object-cover shrink-0"
              />
            ) : (
              <div className="size-11 rounded-lg bg-gray-200 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">{l.name}</p>
              <p className="text-[10px] text-gray-400">
                {l.color} · {l.size} · {brl(l.unitPrice)}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <button
                  onClick={() => changeQty(l.variantId, -1)}
                  className="size-5 rounded-md bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand-300"
                >
                  <Minus className="size-3" />
                </button>
                <span className="text-xs font-semibold tabular-nums w-5 text-center">
                  {l.quantity}
                </span>
                <button
                  onClick={() => changeQty(l.variantId, 1)}
                  disabled={l.quantity >= l.maxStock}
                  className="size-5 rounded-md bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand-300 disabled:opacity-40"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-semibold tabular-nums">
                {brl(l.quantity * l.unitPrice)}
              </p>
              <button
                onClick={() => changeQty(l.variantId, -l.quantity)}
                className="text-gray-300 hover:text-rose-500 mt-1"
                title="Remover"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-gray-100 space-y-2 shrink-0">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-gray-400 font-medium">
              Desconto (R$)
            </label>
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 font-medium">
              Acréscimo (R$)
            </label>
            <input
              value={surcharge}
              onChange={(e) => setSurcharge(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 font-medium">
              Frete (R$)
            </label>
            <input
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white outline-none"
          >
            <option value="PIX">PIX</option>
            <option value="CARTAO">Cartão</option>
            <option value="BOLETO">Boleto</option>
            <option value="DINHEIRO">Dinheiro</option>
            <option value="OUTRO">Outro</option>
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações"
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
          />
        </div>

        <div className="text-xs space-y-1 pt-1">
          <div className="flex justify-between text-gray-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{brl(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-rose-500">
              <span>Desconto</span>
              <span className="tabular-nums">- {brl(totals.discount)}</span>
            </div>
          )}
          {totals.surcharge > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Acréscimo</span>
              <span className="tabular-nums">+ {brl(totals.surcharge)}</span>
            </div>
          )}
          {/* frete separado do valor vendido: ele não fatura nem comissiona */}
          {totals.shippingFee > 0 && (
            <>
              <div className="flex justify-between border-t border-gray-100 pt-1 font-medium text-gray-700">
                <span>Valor vendido</span>
                <span className="tabular-nums">{brl(totals.netTotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Frete</span>
                <span className="tabular-nums">+ {brl(totals.shippingFee)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between font-semibold text-sm">
            <span>{totals.shippingFee > 0 ? "Total a pagar" : "Total"}</span>
            <span className="tabular-nums text-brand-700">
              {brl(totals.total)}
            </span>
          </div>
        </div>

        {error && (
          <p className="text-[11px] text-rose-600 bg-rose-50 rounded-lg px-2 py-1.5">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => finalize("ORCAMENTO")}
            disabled={saving || cart.length === 0}
            className="rounded-xl border border-brand-200 text-brand-700 text-xs font-medium py-2.5 hover:bg-brand-50 transition disabled:opacity-50"
          >
            Salvar orçamento
          </button>
          <button
            onClick={() => finalize("AGUARDANDO_PAGAMENTO")}
            disabled={saving || cart.length === 0}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium py-2.5 transition disabled:opacity-50"
          >
            {saving ? "Gerando..." : "Fechar pedido"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-4xl h-[calc(100dvh_-_var(--kb,0px))] md:h-[80dvh] flex flex-col md:flex-row overflow-hidden animate-fade-up">
        {/* busca + resultados */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-100">
          <div className="p-4 pb-2 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">
                Adicionar produto{" "}
                <span className="text-gray-400 font-normal text-sm">
                  · {customerName}
                </span>
              </h3>
              <button onClick={onClose} className="text-gray-400 p-1">
                <X className="size-5" />
              </button>
            </div>
            <div className="relative">
              <Search className="size-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nome ou SKU..."
                className="w-full rounded-xl bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white pl-9 pr-3 py-2.5 text-sm outline-none transition"
              />
            </div>
            {wholesaleCustomer && (
              <p className="text-[11px] text-sky-600 mt-1.5">
                Cliente atacado: preços de atacado aplicados automaticamente.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto thin-scroll px-4 pb-4">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-10">
                Carregando catálogo...
              </p>
            ) : products.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Package className="size-8 mx-auto mb-2" />
                <p className="text-sm">Nenhum produto com estoque encontrado</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPicking(p)}
                    className="text-left rounded-xl border border-gray-100 hover:border-brand-300 hover:shadow-card transition overflow-hidden"
                  >
                    <div className="aspect-square bg-gray-50">
                      {p.images[0] && (
                        <img
                          src={p.images[0].url}
                          alt={p.name}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold leading-tight line-clamp-2">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-brand-700 font-semibold mt-1">
                        {brl(
                          wholesaleCustomer && p.wholesalePrice > 0
                            ? p.wholesalePrice
                            : p.retailPrice
                        )}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* carrinho desktop */}
        <div className="hidden md:flex w-80 shrink-0 flex-col">{cartPanel}</div>

        {/* carrinho mobile: barra + sheet */}
        {!mobileCart && cart.length > 0 && (
          <button
            onClick={() => setMobileCart(true)}
            className="md:hidden absolute bottom-3 inset-x-4 rounded-xl bg-brand-600 text-white text-sm font-medium py-3 shadow-pop flex items-center justify-center gap-2"
          >
            <ShoppingBag className="size-4" />
            Ver carrinho ({itemCount}) · {brl(totals.total)}
          </button>
        )}
        {mobileCart && (
          <div className="md:hidden absolute inset-0 bg-white flex flex-col animate-fade-up">
            {cartPanel}
          </div>
        )}

        {/* seletor de variação */}
        {picking && (
          <VariantPicker
            product={picking}
            wholesaleCustomer={wholesaleCustomer}
            onCancel={() => setPicking(null)}
            onAdd={addLine}
          />
        )}
      </div>
    </div></Portal>
  );
}

function VariantPicker({
  product,
  wholesaleCustomer,
  onCancel,
  onAdd,
}: {
  product: ApiProduct;
  wholesaleCustomer: boolean;
  onCancel: () => void;
  onAdd: (product: ApiProduct, variantId: string, quantity: number) => void;
}) {
  const colors = [...new Set(product.variants.map((v) => v.color))];
  const [color, setColor] = useState(colors[0]);
  const sizes = product.variants.filter((v) => v.color === color);
  const [variantId, setVariantId] = useState(
    sizes.find((v) => v.stock > 0)?.id ?? sizes[0]?.id
  );
  const [qty, setQty] = useState(1);

  const variant = product.variants.find((v) => v.id === variantId);
  const price = unitPriceFor(product, qty, wholesaleCustomer);

  return (
    <div className="absolute inset-0 z-10 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onCancel} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-sm p-5 animate-fade-up">
        <div className="flex gap-3 mb-4">
          {product.images[0] && (
            <img
              src={product.images[0].url}
              alt=""
              className="size-16 rounded-xl object-cover shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-tight">{product.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{product.sku}</p>
            <p className="text-sm font-semibold text-brand-700 mt-1">
              {brl(price)}
              {product.minQuantity > 1 && product.wholesalePrice > 0 && (
                <span className="text-[10px] text-gray-400 font-normal">
                  {" "}
                  · atacado a partir de {product.minQuantity} un.
                </span>
              )}
            </p>
          </div>
        </div>

        <p className="text-xs font-medium text-gray-500 mb-1.5">Cor</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                const first = product.variants.find(
                  (v) => v.color === c && v.stock > 0
                );
                if (first) setVariantId(first.id);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                color === c
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <p className="text-xs font-medium text-gray-500 mb-1.5">Tamanho</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {sizes.map((v) => (
            <button
              key={v.id}
              onClick={() => setVariantId(v.id)}
              disabled={v.stock === 0}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:line-through ${
                variantId === v.id
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {v.size}
            </button>
          ))}
        </div>

        <p className="text-xs font-medium text-gray-500 mb-1.5">
          Quantidade{" "}
          <span className="text-gray-300">
            (estoque: {variant?.stock ?? 0})
          </span>
        </p>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setQty((v) => Math.max(1, v - 1))}
            className="size-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand-300"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="font-semibold tabular-nums w-8 text-center">{qty}</span>
          <button
            onClick={() =>
              setQty((v) => Math.min(variant?.stock ?? 1, v + 1))
            }
            className="size-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:border-brand-300"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border border-gray-200 text-gray-500 text-sm font-medium py-2.5 hover:border-gray-300 transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => variant && onAdd(product, variant.id, qty)}
            disabled={!variant || variant.stock === 0}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
          >
            Adicionar · {brl(price * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}
