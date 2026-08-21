"use client";

/**
 * Novo pedido manual — para vendas que NÃO passam pelo catálogo público
 * (cliente que fecha direto no WhatsApp, no balcão, no showroom...).
 * O vendedor escolhe o cliente (ou cadastra um na hora), seleciona os
 * produtos/variações e o pedido entra no mesmo fluxo dos demais.
 */

import { useEffect, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2, Search } from "lucide-react";
import { brl, formatPhone, numeroBR } from "@/lib/format";
import { paymentMethodLabel, computeOrderTotals } from "@/lib/orders";

type CustomerHit = { id: string; name: string; phone: string; city: string | null; state: string | null };
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

const input =
  "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
const label = "block text-sm font-medium mb-1.5";

export function NewOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // cliente
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<CustomerHit[]>([]);
  const [newCustomer, setNewCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // produtos
  const [prodQuery, setProdQuery] = useState("");
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [picking, setPicking] = useState<ApiProduct | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  // resumo
  const [discount, setDiscount] = useState("");
  const [surcharge, setSurcharge] = useState("");
  const [shipping, setShipping] = useState("");
  const [payment, setPayment] = useState("PIX");
  const [status, setStatus] = useState<"ORCAMENTO" | "AGUARDANDO_PAGAMENTO">("ORCAMENTO");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || customer || newCustomer || custQuery.trim().length < 2) {
      setCustResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(custQuery.trim())}`);
      if (res.ok) setCustResults(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [custQuery, open, customer, newCustomer]);

  useEffect(() => {
    if (!open) return;
    // aborta a busca anterior: sem isso uma resposta LENTA e antiga
    // sobrescrevia a lista do que foi digitado por último
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(prodQuery.trim())}`, { signal: ctrl.signal });
        if (res.ok) setProducts(await res.json());
      } catch { /* busca abortada */ }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [prodQuery, open]);

  function addLine(p: ApiProduct, v: ApiVariant) {
    const key = v.id;
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === key);
      if (existing) {
        return prev.map((l) =>
          l.variantId === key ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          variantId: v.id,
          name: p.name,
          variant: [v.color, v.size].filter(Boolean).join(" · "),
          stock: v.stock,
          quantity: 1,
          unitPrice: p.wholesalePrice > 0 ? p.wholesalePrice : p.retailPrice,
        },
      ];
    });
    setPicking(null);
    setProdQuery("");
  }

  // mesma conta do servidor: desconto limitado (total nunca fica negativo)
  const totals = computeOrderTotals(
    lines,
    numeroBR(discount),
    numeroBR(shipping),
    numeroBR(surcharge)
  );

  async function submit() {
    setError("");
    if (lines.length === 0) return setError("Adicione ao menos um produto.");
    let customerId = customer?.id;

    setSaving(true);
    // cliente novo: cadastra na hora (entra pelo Lead Intake, origem manual)
    if (!customerId && newCustomer) {
      if (!newName.trim() || newPhone.replace(/\D/g, "").length < 10) {
        setSaving(false);
        return setError("Para cliente novo, informe nome e WhatsApp com DDD.");
      }
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.replace(/\D/g, ""),
          origin: "MANUAL",
          skipOpportunity: true, // o registro aqui é o próprio pedido
        }),
      });
      if (!res.ok) {
        setSaving(false);
        return setError("Não foi possível cadastrar o cliente.");
      }
      customerId = (await res.json()).id;
    }
    if (!customerId) {
      setSaving(false);
      return setError("Escolha um cliente (ou cadastre um novo).");
    }

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        items: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        discount: numeroBR(discount),
        surcharge: numeroBR(surcharge),
        shippingFee: numeroBR(shipping),
        paymentMethod: payment,
        status,
        notes: notes.trim() || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error ?? "Não foi possível criar o pedido.");
    }
    const order = await res.json();
    setOpen(false);
    router.push(`/pedidos/${order.id}`);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition active:scale-[0.98]"
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">Novo pedido</span>
        <span className="sm:hidden">Novo</span>
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-6 animate-fade-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-lg">Novo pedido</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 p-1">
                <X className="size-5" />
              </button>
            </div>

            {/* CLIENTE */}
            <div className="mb-5">
              <div className="flex items-center justify-between">
                <label className={label}>Cliente</label>
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomer((v) => !v);
                    setCustomer(null);
                  }}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  {newCustomer ? "Buscar cliente existente" : "+ Cliente novo"}
                </button>
              </div>
              {customer ? (
                <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{customer.name}</p>
                    <p className="text-xs text-gray-400">{formatPhone(customer.phone)}</p>
                  </div>
                  <button onClick={() => setCustomer(null)} className="text-gray-400 p-1">
                    <X className="size-4" />
                  </button>
                </div>
              ) : newCustomer ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome do cliente *" className={input} />
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="WhatsApp com DDD *" inputMode="tel" className={input} />
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-300" />
                  <input
                    value={custQuery}
                    onChange={(e) => setCustQuery(e.target.value)}
                    placeholder="Buscar por nome, telefone ou CPF/CNPJ…"
                    className={`${input} pl-9`}
                  />
                  {custResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-pop max-h-52 overflow-y-auto">
                      {custResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setCustomer(c); setCustQuery(""); setCustResults([]); }}
                          className="w-full text-left px-3 py-2 hover:bg-brand-50 transition"
                        >
                          <span className="block text-sm font-medium">{c.name}</span>
                          <span className="block text-xs text-gray-400">
                            {[formatPhone(c.phone), [c.city, c.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PRODUTOS */}
            <div className="mb-5">
              <label className={label}>Adicionar produtos</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-300" />
                <input
                  value={prodQuery}
                  onChange={(e) => setProdQuery(e.target.value)}
                  placeholder="Buscar produto por nome ou SKU…"
                  className={`${input} pl-9`}
                />
              </div>
              {prodQuery.trim().length > 0 && !picking && (
                <div className="mt-1 rounded-xl border border-gray-200 bg-white shadow-pop max-h-56 overflow-y-auto">
                  {/* a lista INTEIRA que o servidor devolveu, com rolagem — o
                      corte em 8 escondia o produto novo quando muitos nomes
                      parecidos vinham antes dele na ordem alfabética */}
                  {products.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPicking(p)}
                      className="w-full flex items-center gap-3 text-left px-3 py-2 hover:bg-brand-50 transition"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.images[0] ? (
                        <img src={p.images[0].url} alt="" className="size-9 rounded-lg object-cover bg-gray-50" />
                      ) : (
                        <span className="size-9 rounded-lg bg-gray-100" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{p.name}</span>
                        <span className="block text-xs text-gray-400">{p.sku} · {brl(p.wholesalePrice > 0 ? p.wholesalePrice : p.retailPrice)}</span>
                      </span>
                    </button>
                  ))}
                  {products.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">Nenhum produto encontrado.</p>
                  )}
                  {products.length >= 60 && (
                    <p className="px-3 py-2 text-xs text-amber-600">Tem mais resultado do que dá para mostrar — digite mais letras para afinar.</p>
                  )}
                </div>
              )}
              {picking && (
                <div className="mt-2 rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{picking.name} — escolha a variação</p>
                    <button onClick={() => setPicking(null)} className="text-gray-400 p-1">
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {picking.variants.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => addLine(picking, v)}
                        disabled={v.stock <= 0 && status !== "ORCAMENTO"}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-brand-600 hover:text-white transition disabled:opacity-40"
                      >
                        {[v.color, v.size].filter(Boolean).join(" ")} ({v.stock})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ITENS */}
            {lines.length > 0 && (
              <div className="mb-5 rounded-xl border border-gray-100 divide-y divide-gray-50">
                {lines.map((l) => (
                  <div key={l.variantId} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-xs text-gray-400">{l.variant} · estoque {l.stock}</p>
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.variantId === l.variantId
                              ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) }
                              : x
                          )
                        )
                      }
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-center"
                    />
                    <input
                      value={String(l.unitPrice)}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.variantId === l.variantId
                              ? { ...x, unitPrice: parseFloat(e.target.value.replace(",", ".")) || 0 }
                              : x
                          )
                        )
                      }
                      inputMode="decimal"
                      className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-right"
                    />
                    <span className="w-20 text-right text-sm font-semibold tabular-nums">
                      {brl(l.quantity * l.unitPrice)}
                    </span>
                    <button
                      onClick={() => setLines((prev) => prev.filter((x) => x.variantId !== l.variantId))}
                      className="text-gray-300 hover:text-rose-500 p-1"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* RESUMO */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className={label}>Desconto (R$)</label>
                <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" inputMode="decimal" className={input} />
              </div>
              <div>
                <label className={label}>Acréscimo (R$)</label>
                <input value={surcharge} onChange={(e) => setSurcharge(e.target.value)} placeholder="0,00" inputMode="decimal" className={input} />
              </div>
              <div>
                <label className={label}>Frete (R$)</label>
                <input value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0,00" inputMode="decimal" className={input} />
              </div>
              <div>
                <label className={label}>Pagamento</label>
                <select value={payment} onChange={(e) => setPayment(e.target.value)} className={`${input} bg-white`}>
                  {Object.entries(paymentMethodLabel).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Entrada como</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${input} bg-white`}>
                  <option value="ORCAMENTO">Orçamento</option>
                  <option value="AGUARDANDO_PAGAMENTO">Aguardando pagamento</option>
                </select>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Observações (condições combinadas, prazo...)"
              className={`${input} mb-4`}
            />

            {error && (
              <p className="mb-3 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Total:{" "}
                <span className="text-base font-bold text-brand-700 tabular-nums">{brl(totals.total)}</span>
              </p>
              <button
                onClick={submit}
                disabled={saving}
                className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 text-sm transition disabled:opacity-60"
              >
                {saving ? "Criando…" : "Criar pedido"}
              </button>
            </div>
          </div>
        </div></Portal>
      )}
    </>
  );
}
