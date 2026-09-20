"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * MONTAR PEDIDO (RN-062) — para a venda que NÃO passa pelo catálogo público
 * (a cliente que fecha no WhatsApp, no balcão, no showroom).
 *
 * Redesenhado em 20/09/2026 a pedido do dono, com o print do celular: a
 * busca devolvia QUATRO linhas escritas "Baby Look · R$ 34", só o SKU
 * mudando, e ele não tinha como saber qual era qual; e cada variação era
 * uma ida à busca, que fechava e apagava o termo a cada peça adicionada.
 *
 * O caminho agora tem TRÊS passos com um só assunto cada um — cliente,
 * peças, conferir — em vez de um formulário comprido onde o total ficava no
 * fim do rolar. No meio dele está a grade (cor × tamanho), que é como a
 * lojista pensa o pedido de atacado.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, Package, Pencil, Plus, Search, ShoppingBag, Trash2, UserPlus, X } from "lucide-react";
import { brl, formatPhone, numeroBR } from "@/lib/format";
import { precoSugeridoNoPedido, paymentMethodLabel, computeOrderTotals } from "@/lib/orders";
import {
  agruparPorProduto,
  aplicarGradeNoPedido,
  aplicarPrecoNoProduto,
  pecasAcimaDoEstoque,
  pecasNoPedido,
  quantidadesNoPedido,
  type LinhaDoPedido,
} from "@/lib/pedido-grade";
import { GradeDePecas, type ProdutoDaGrade } from "@/components/pedido/grade-de-pecas";

type CustomerHit = { id: string; name: string; phone: string; city: string | null; state: string | null };
type ApiVariant = { id: string; color: string; size: string; stock: number };
type ApiProduct = ProdutoDaGrade & {
  category?: string;
  wholesalePrice: number;
  retailPrice: number;
  variants: ApiVariant[];
};

type Etapa = "cliente" | "pecas" | "revisar";

const input =
  "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
const label = "block text-xs font-medium text-gray-500 mb-1.5";

export function NewOrderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("cliente");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // cliente
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<CustomerHit[]>([]);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // peças
  const [prodQuery, setProdQuery] = useState("");
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [buscandoPecas, setBuscandoPecas] = useState(true);
  const [picking, setPicking] = useState<ApiProduct | null>(null);
  const [lines, setLines] = useState<LinhaDoPedido[]>([]);
  /** o cadastro das peças que entraram no pedido — é o que reabre a grade na conferência */
  const [usados, setUsados] = useState<Record<string, ApiProduct>>({});

  // conferência
  const [discount, setDiscount] = useState("");
  const [surcharge, setSurcharge] = useState("");
  const [shipping, setShipping] = useState("");
  const [payment, setPayment] = useState("PIX");
  const [status, setStatus] = useState<"ORCAMENTO" | "AGUARDANDO_PAGAMENTO">("ORCAMENTO");
  const [notes, setNotes] = useState("");
  /** preço por MODELO enquanto a pessoa digita (vírgula, campo vazio) */
  const [precoTexto, setPrecoTexto] = useState<Record<string, string>>({});

  const buscaPecasRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || customer || newCustomer || custQuery.trim().length < 2) {
      setCustResults([]);
      setBuscandoCliente(false);
      return;
    }
    setBuscandoCliente(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(custQuery.trim())}`, { signal: ctrl.signal });
        if (res.ok) setCustResults(await res.json());
      } catch { /* busca abortada ou sem rede */ } finally {
        // fora do `try`: falha de rede deixava a tela "buscando" para sempre,
        // escondendo até o "Cadastrar X" (achado da revisão). A busca que foi
        // ABORTADA não mexe no sinal — quem a substituiu já ligou o dele.
        if (!ctrl.signal.aborted) setBuscandoCliente(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [custQuery, open, customer, newCustomer]);

  useEffect(() => {
    if (!open || etapa !== "pecas") return;
    setBuscandoPecas(true);
    // aborta a busca anterior: sem isso uma resposta LENTA e antiga
    // sobrescrevia a lista do que foi digitado por último
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(prodQuery.trim())}`, { signal: ctrl.signal });
        if (res.ok) setProducts(await res.json());
      } catch { /* busca abortada ou sem rede */ } finally {
        if (!ctrl.signal.aborted) setBuscandoPecas(false);
      }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [prodQuery, open, etapa]);

  function reiniciar() {
    setEtapa("cliente");
    setCustomer(null); setCustQuery(""); setCustResults([]);
    setNewCustomer(false); setNewName(""); setNewPhone("");
    setProdQuery(""); setPicking(null); setLines([]); setUsados({});
    setDiscount(""); setSurcharge(""); setShipping(""); setPayment("PIX");
    setStatus("ORCAMENTO"); setNotes(""); setPrecoTexto({}); setError("");
  }

  /**
   * Fechar GUARDA o rascunho: um toque fora do quadro apagava cliente,
   * grade, preços e observações sem confirmação (achado da revisão) — e no
   * computador a área escura ao lado do quadro é igualzinha à da grade, que
   * só fecha a grade. O pedido só é zerado depois de criado.
   */
  function fechar() {
    setOpen(false);
    setPicking(null);
    setError("");
  }

  /**
   * O preço digitado à mão morre junto com a peça, pelos DOIS caminhos de
   * remoção (a lixeira e zerar a grade): sem isso, tirar o modelo e pôr de
   * novo mostrava no campo o preço velho (R$ 30) enquanto as linhas — e o
   * pedido criado — valiam o sugerido (achado da revisão).
   */
  useEffect(() => {
    setPrecoTexto((prev) => {
      const doPedido = new Set(lines.map((l) => l.productId));
      const sobrando = Object.keys(prev).filter((id) => !doPedido.has(id));
      if (sobrando.length === 0) return prev;
      const novo = { ...prev };
      for (const id of sobrando) delete novo[id];
      return novo;
    });
  }, [lines]);

  /** A grade fechou: o pedido passa a ser o que ela mostrava daquela peça (RN-062). */
  function aplicarGrade(produto: ApiProduct, quantidades: Map<string, number>) {
    setLines((prev) =>
      aplicarGradeNoPedido(prev, produto, produto.variants, quantidades, () => precoSugeridoNoPedido(produto))
    );
    setUsados((prev) => ({ ...prev, [produto.id]: produto }));
    setPicking(null);
    // a busca CONTINUA onde estava: o modelo seguinte costuma ser vizinho
    // deste, e reescrever o termo a cada peça era a reclamação do dono
  }

  const totals = computeOrderTotals(lines, numeroBR(discount), numeroBR(shipping), numeroBR(surcharge));
  const pecas = lines.reduce((s, l) => s + l.quantity, 0);
  const grupos = useMemo(() => agruparPorProduto(lines), [lines]);
  const acimaDoEstoque = useMemo(() => pecasAcimaDoEstoque(lines), [lines]);

  async function submit() {
    setError("");
    if (lines.length === 0) return setError("Adicione ao menos uma peça.");
    let customerId = customer?.id;

    setSaving(true);
    // cliente novo: cadastra na hora (entra pelo Lead Intake, origem manual)
    if (!customerId && newCustomer) {
      if (!newName.trim() || newPhone.replace(/\D/g, "").length < 10) {
        setSaving(false);
        setEtapa("cliente");
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
        setEtapa("cliente");
        return setError("Não foi possível cadastrar o cliente.");
      }
      customerId = (await res.json()).id;
    }
    if (!customerId) {
      setSaving(false);
      setEtapa("cliente");
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
    reiniciar();
    router.push(`/pedidos/${order.id}`);
    router.refresh();
  }

  const clienteEscolhido = customer?.name ?? (newCustomer && newName.trim() ? newName.trim() : null);
  const podeAvancarCliente = !!customer || (newCustomer && newName.trim().length > 0 && newPhone.replace(/\D/g, "").length >= 10);

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
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
            <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={fechar} />
            <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-3xl h-[calc(100dvh_-_var(--kb,0px)_-_1rem)] md:h-[88dvh] flex flex-col overflow-hidden animate-fade-up">
              {/* CABEÇALHO: os três passos, com o cliente sempre à vista */}
              <div className="shrink-0 border-b border-gray-100">
                <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                  <h3 className="font-semibold">Novo pedido</h3>
                  <button onClick={fechar} aria-label="Fechar" className="text-gray-400 p-1">
                    <X className="size-5" />
                  </button>
                </div>
                <div className="flex items-center gap-1 px-4 pb-2.5 text-xs overflow-x-auto thin-scroll">
                  <PassoDoTopo n={1} titulo={clienteEscolhido ?? "Cliente"} ativo={etapa === "cliente"} feito={!!clienteEscolhido} onClick={() => setEtapa("cliente")} />
                  <ChevronRight className="size-3.5 text-gray-300 shrink-0" />
                  <PassoDoTopo
                    n={2}
                    titulo={pecas > 0 ? `${pecas} ${pecas === 1 ? "peça" : "peças"}` : "Peças"}
                    ativo={etapa === "pecas"}
                    feito={pecas > 0}
                    onClick={() => podeAvancarCliente && setEtapa("pecas")}
                  />
                  <ChevronRight className="size-3.5 text-gray-300 shrink-0" />
                  <PassoDoTopo n={3} titulo="Conferir" ativo={etapa === "revisar"} feito={false} onClick={() => lines.length > 0 && setEtapa("revisar")} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto thin-scroll">
                {/* ---------- PASSO 1 · CLIENTE ---------- */}
                {etapa === "cliente" && (
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium">Para quem é o pedido?</p>
                      <button
                        type="button"
                        onClick={() => { setNewCustomer((v) => !v); setCustomer(null); }}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
                      >
                        {newCustomer ? <><Search className="size-3.5" /> Buscar existente</> : <><UserPlus className="size-3.5" /> Cliente novo</>}
                      </button>
                    </div>

                    {customer ? (
                      <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{customer.name}</p>
                          <p className="text-xs text-gray-500">
                            {[formatPhone(customer.phone), [customer.city, customer.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <button onClick={() => setCustomer(null)} aria-label="Trocar cliente" className="text-gray-400 p-1 shrink-0">
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : newCustomer ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className={label}>Nome *</label>
                          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome da cliente" className={input} />
                        </div>
                        <div>
                          <label className={label}>WhatsApp com DDD *</label>
                          <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="(11) 90000-0000" inputMode="tel" className={input} />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-300" />
                          <input
                            autoFocus
                            value={custQuery}
                            onChange={(e) => setCustQuery(e.target.value)}
                            placeholder="Nome, telefone ou CPF/CNPJ…"
                            className={`${input} pl-9`}
                          />
                        </div>
                        <div className="mt-2 divide-y divide-gray-50">
                          {custResults.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => { setCustomer(c); setCustQuery(""); setCustResults([]); setEtapa("pecas"); }}
                              className="w-full text-left px-3 py-2.5 hover:bg-brand-50 rounded-lg transition"
                            >
                              <span className="block text-sm font-medium">{c.name}</span>
                              <span className="block text-xs text-gray-400">
                                {[formatPhone(c.phone), [c.city, c.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}
                              </span>
                            </button>
                          ))}
                          {custQuery.trim().length >= 2 && !buscandoCliente && custResults.length === 0 && (
                            <p className="px-1 py-3 text-xs text-gray-400">
                              Ninguém encontrado com esse nome.{" "}
                              <button onClick={() => { setNewCustomer(true); setNewName(custQuery.trim()); }} className="text-brand-600 font-medium">
                                Cadastrar “{custQuery.trim()}”
                              </button>
                            </p>
                          )}
                          {custQuery.trim().length < 2 && (
                            <p className="px-1 py-3 text-xs text-gray-400">Digite pelo menos duas letras para buscar.</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ---------- PASSO 2 · PEÇAS ---------- */}
                {etapa === "pecas" && (
                  <div className="p-4">
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-300" />
                      <input
                        ref={buscaPecasRef}
                        value={prodQuery}
                        onChange={(e) => setProdQuery(e.target.value)}
                        placeholder="Buscar peça por nome ou código…"
                        className={`${input} pl-9 pr-9`}
                      />
                      {prodQuery && (
                        <button onClick={() => { setProdQuery(""); buscaPecasRef.current?.focus(); }} aria-label="Limpar busca" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 p-1">
                          <X className="size-4" />
                        </button>
                      )}
                    </div>

                    {buscandoPecas && products.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-10">Carregando catálogo…</p>
                    ) : products.length === 0 ? (
                      <div className="text-center py-10 text-gray-400">
                        <Package className="size-8 mx-auto mb-2" />
                        <p className="text-sm">Nenhuma peça encontrada.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {products.map((p) => (
                          <CartaoDaPeca key={p.id} produto={p} noPedido={pecasNoPedido(lines, p.id)} onClick={() => setPicking(p)} />
                        ))}
                      </div>
                    )}
                    {products.length >= 60 && (
                      <p className="mt-2 text-xs text-amber-600">Tem mais resultado do que cabe aqui — digite mais letras para afinar.</p>
                    )}
                  </div>
                )}

                {/* ---------- PASSO 3 · CONFERIR ---------- */}
                {etapa === "revisar" && (
                  <div className="p-4 space-y-4">
                    {grupos.length === 0 ? (
                      <div className="text-center py-10 text-gray-400">
                        <ShoppingBag className="size-8 mx-auto mb-2" />
                        <p className="text-sm">Nenhuma peça no pedido ainda.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {grupos.map((g) => {
                          const produto = usados[g.productId];
                          const texto = precoTexto[g.productId];
                          return (
                            <div key={g.productId} className="rounded-xl border border-gray-100 p-3">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{g.name}</p>
                                  <p className="text-xs text-gray-400">
                                    {g.pecas} {g.pecas === 1 ? "peça" : "peças"} · {brl(g.valor)}
                                  </p>
                                </div>
                                {produto && (
                                  <button
                                    onClick={() => { setPicking(produto); setEtapa("pecas"); }}
                                    className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 shrink-0"
                                  >
                                    <Pencil className="size-3.5" /> Grade
                                  </button>
                                )}
                                <button
                                  onClick={() => setLines((prev) => prev.filter((l) => l.productId !== g.productId))}
                                  aria-label={`Remover ${g.name}`}
                                  className="text-gray-300 hover:text-rose-500 p-0.5 shrink-0"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </div>

                              <div className="flex flex-wrap gap-1 mt-2">
                                {g.linhas.map((l) => (
                                  <span
                                    key={l.variantId}
                                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ${
                                      l.quantity > l.stock ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"
                                    }`}
                                  >
                                    {l.color} {l.size}
                                    <span className="tabular-nums font-semibold">×{l.quantity}</span>
                                  </span>
                                ))}
                              </div>

                              {/* preço por MODELO: no atacado o número é um só para a peça inteira */}
                              <div className="flex items-center gap-2 mt-2.5">
                                <span className="text-xs text-gray-500">Preço por peça</span>
                                {g.precoUnico === null ? (
                                  <span className="text-xs text-amber-600">preços diferentes nas variações</span>
                                ) : (
                                  <input
                                    value={texto ?? g.precoUnico.toFixed(2).replace(".", ",")}
                                    onChange={(e) => {
                                      const t = e.target.value;
                                      setPrecoTexto((prev) => ({ ...prev, [g.productId]: t }));
                                      setLines((prev) => aplicarPrecoNoProduto(prev, g.productId, numeroBR(t)));
                                    }}
                                    inputMode="decimal"
                                    aria-label={`Preço de ${g.name}`}
                                    className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-right tabular-nums outline-none focus:border-brand-400"
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {acimaDoEstoque.length > 0 && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        {acimaDoEstoque.length === 1 ? "1 peça ficou" : `${acimaDoEstoque.length} peças ficaram`} acima do estoque
                        {" "}— alguém vendeu enquanto você montava. Abra a grade e ajuste: o pedido é recusado enquanto faltar peça
                        {" ("}
                        {acimaDoEstoque.map((l) => `${l.color} ${l.size}: restam ${l.stock}`).join("; ")}
                        {")."}
                      </p>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                      placeholder="Observações (condições combinadas, prazo…)"
                      className={input}
                    />

                    <div className="rounded-xl bg-gray-50 p-3 text-sm space-y-1">
                      <div className="flex justify-between text-gray-500">
                        <span>Subtotal ({pecas} {pecas === 1 ? "peça" : "peças"})</span>
                        <span className="tabular-nums">{brl(totals.subtotal)}</span>
                      </div>
                      {totals.discount > 0 && (
                        <div className="flex justify-between text-rose-500">
                          <span>Desconto</span>
                          <span className="tabular-nums">− {brl(totals.discount)}</span>
                        </div>
                      )}
                      {totals.surcharge > 0 && (
                        <div className="flex justify-between text-emerald-600">
                          <span>Acréscimo</span>
                          <span className="tabular-nums">+ {brl(totals.surcharge)}</span>
                        </div>
                      )}
                      {/* frete separado do valor vendido: ele não fatura nem comissiona (RN-002) */}
                      {totals.shippingFee > 0 && (
                        <>
                          <div className="flex justify-between border-t border-gray-200 pt-1 text-gray-700 font-medium">
                            <span>Valor vendido</span>
                            <span className="tabular-nums">{brl(totals.netTotal)}</span>
                          </div>
                          <div className="flex justify-between text-gray-500">
                            <span>Frete</span>
                            <span className="tabular-nums">+ {brl(totals.shippingFee)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between font-semibold text-base border-t border-gray-200 pt-1.5">
                        <span>{totals.shippingFee > 0 ? "Total a pagar" : "Total"}</span>
                        <span className="tabular-nums text-brand-700">{brl(totals.total)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* RODAPÉ FIXO: o total fica SEMPRE à vista, e o passo seguinte também */}
              <div className="shrink-0 border-t border-gray-100 p-3">
                {error && (
                  <p className="mb-2 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
                )}
                <div className="flex items-center gap-3">
                  {etapa !== "cliente" && (
                    <button
                      onClick={() => setEtapa(etapa === "revisar" ? "pecas" : "cliente")}
                      aria-label="Voltar"
                      className="rounded-xl border border-gray-200 text-gray-600 px-3 py-2.5 hover:bg-gray-50 transition shrink-0"
                    >
                      <ArrowLeft className="size-4" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    {pecas > 0 ? (
                      <>
                        <p className="text-sm font-semibold tabular-nums leading-tight">{brl(totals.total)}</p>
                        <p className="text-[11px] text-gray-400">{pecas} {pecas === 1 ? "peça" : "peças"} · {grupos.length} {grupos.length === 1 ? "modelo" : "modelos"}</p>
                      </>
                    ) : (
                      <p className="text-[11px] text-gray-400">
                        {etapa === "cliente" ? "Escolha a cliente para começar" : "Toque numa peça para preencher a grade"}
                      </p>
                    )}
                  </div>
                  {etapa === "cliente" && (
                    <button
                      onClick={() => { setError(""); setEtapa("pecas"); }}
                      disabled={!podeAvancarCliente}
                      className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-40 shrink-0"
                    >
                      Escolher peças
                    </button>
                  )}
                  {etapa === "pecas" && (
                    <button
                      onClick={() => setEtapa("revisar")}
                      disabled={lines.length === 0}
                      className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-40 shrink-0"
                    >
                      Conferir
                    </button>
                  )}
                  {etapa === "revisar" && (
                    <button
                      onClick={submit}
                      disabled={saving || lines.length === 0}
                      className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-60 shrink-0 inline-flex items-center gap-1.5"
                    >
                      <Check className="size-4" />
                      {saving ? "Criando…" : "Criar pedido"}
                    </button>
                  )}
                </div>
              </div>

              {picking && (
                <GradeDePecas
                  produto={picking}
                  quantidadesIniciais={quantidadesNoPedido(lines, picking.id)}
                  precoUnitario={() => precoSugeridoNoPedido(picking)}
                  jaNoPedido={pecasNoPedido(lines, picking.id) > 0}
                  onCancelar={() => setPicking(null)}
                  onAplicar={(q) => aplicarGrade(picking, q)}
                />
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

function PassoDoTopo({
  n,
  titulo,
  ativo,
  feito,
  onClick,
}: {
  n: number;
  titulo: string;
  ativo: boolean;
  feito: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "step" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 max-w-[46%] transition ${
        ativo ? "bg-brand-50 text-brand-700 font-semibold" : "text-gray-500 hover:text-gray-800"
      }`}
    >
      <span
        className={`size-4 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
          ativo ? "bg-brand-600 text-white" : feito ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"
        }`}
      >
        {feito && !ativo ? <Check className="size-2.5" /> : n}
      </span>
      <span className="truncate">{titulo}</span>
    </button>
  );
}

/**
 * O resultado da busca DIZ qual peça é qual: foto, código, cores e tamanhos.
 * Quatro linhas escritas só "Baby Look · R$ 34" era o print que o dono
 * mandou — o nome sozinho não distingue modelo nenhum numa confecção.
 */
function CartaoDaPeca({
  produto,
  noPedido,
  onClick,
}: {
  produto: ApiProduct;
  noPedido: number;
  onClick: () => void;
}) {
  const cores = [...new Set(produto.variants.map((v) => (v.color ?? "").trim()).filter(Boolean))];
  const estoque = produto.variants.reduce((s, v) => s + Math.max(0, v.stock), 0);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 rounded-xl border p-2 transition ${
        noPedido > 0 ? "border-brand-300 bg-brand-50/40" : "border-gray-100 hover:border-brand-300 hover:bg-brand-50/30"
      }`}
    >
      {produto.images[0] ? (
        <img src={produto.images[0].url} alt="" className="size-14 rounded-lg object-cover bg-gray-50 shrink-0" />
      ) : (
        <span className="size-14 rounded-lg bg-gray-100 shrink-0" />
      )}
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="block text-sm font-medium truncate">{produto.name}</span>
          {noPedido > 0 && (
            <span className="shrink-0 rounded-full bg-brand-600 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">{noPedido}</span>
          )}
        </span>
        <span className="block text-[11px] text-gray-400 truncate">
          {produto.sku}
          {produto.category ? ` · ${produto.category}` : ""}
        </span>
        <span className="block text-[11px] text-gray-500 truncate mt-0.5">
          {cores.length > 0 ? `${cores.slice(0, 3).join(", ")}${cores.length > 3 ? ` +${cores.length - 3}` : ""} · ` : ""}
          {estoque > 0 ? `${estoque} em estoque` : "sem estoque"}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className="block text-sm font-semibold text-brand-700 tabular-nums">{brl(precoSugeridoNoPedido(produto))}</span>
        <span className="block text-[10px] text-gray-400">atacado</span>
      </span>
    </button>
  );
}
