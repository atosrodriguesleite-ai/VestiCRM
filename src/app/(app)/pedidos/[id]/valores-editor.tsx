"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Percent, DollarSign, Truck, Tag, Plus, Check, X } from "lucide-react";
import { brl, numeroBR } from "@/lib/format";
import { computeOrderTotals, ajusteParaFecharPor } from "@/lib/orders";

/**
 * VALORES DO PEDIDO — desconto, acréscimo e frete.
 *
 * Três coisas que a tela precisa deixar óbvias, porque decidem dinheiro:
 *  1. desconto e acréscimo aceitam REAIS ou PORCENTAGEM (o botão alterna);
 *  2. o FRETE fica visualmente separado — ele não é venda, não entra na
 *     comissão da vendedora nem no faturamento da loja;
 *  3. existem DOIS totais: o valor vendido (o que a loja faturou) e o total
 *     a pagar (o que a cliente paga, com frete).
 *
 * O atalho "fechar por" resolve o caso mais comum do balcão: "faz por 5.000
 * redondo" — a pessoa digita o total final e o sistema descobre sozinho se
 * aquilo virou desconto ou acréscimo.
 */

type Modo = "VALOR" | "PCT";

export function ValoresEditor({
  orderId,
  subtotal,
  discount,
  discountPct,
  surcharge,
  surchargePct,
  shippingFee,
  podeEditar,
  bloqueado,
}: {
  orderId: string;
  subtotal: number;
  discount: number;
  discountPct: number | null;
  surcharge: number;
  surchargePct: number | null;
  shippingFee: number;
  /** desconto/acréscimo são decisão comercial: Suporte não mexe */
  podeEditar: boolean;
  /** pedido cancelado não se edita */
  bloqueado?: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const [descModo, setDescModo] = useState<Modo>(discountPct != null ? "PCT" : "VALOR");
  const [descTexto, setDescTexto] = useState(
    discountPct != null ? String(discountPct) : discount ? String(discount) : ""
  );
  const [acrModo, setAcrModo] = useState<Modo>(surchargePct != null ? "PCT" : "VALOR");
  const [acrTexto, setAcrTexto] = useState(
    surchargePct != null ? String(surchargePct) : surcharge ? String(surcharge) : ""
  );
  const [freteTexto, setFreteTexto] = useState(shippingFee ? String(shippingFee) : "");
  const [fecharPor, setFecharPor] = useState("");

  // leitura à brasileira num lugar só ("1.000,50" = mil reais e cinquenta)
  const numero = numeroBR;

  // prévia ao vivo, com a MESMA conta do servidor (nada de fórmula paralela)
  const previa = useMemo(() => {
    const itensFicticios = [{ quantity: 1, unitPrice: subtotal }];
    return computeOrderTotals(
      itensFicticios,
      descModo === "PCT" ? { pct: numero(descTexto) } : { valor: numero(descTexto) },
      numero(freteTexto),
      acrModo === "PCT" ? { pct: numero(acrTexto) } : { valor: numero(acrTexto) }
    );
  }, [subtotal, descModo, descTexto, acrModo, acrTexto, freteTexto]);

  /** "fechar por": preenche desconto ou acréscimo a partir do total desejado */
  function aplicarFecharPor() {
    const alvo = numero(fecharPor);
    if (!alvo) return;
    const r = ajusteParaFecharPor(subtotal, alvo, numero(freteTexto));
    setDescModo("VALOR");
    setDescTexto(r.discount ? String(r.discount) : "");
    setAcrModo("VALOR");
    setAcrTexto(r.surcharge ? String(r.surcharge) : "");
    setFecharPor("");
  }

  async function salvar() {
    setSalvando(true);
    setErro("");
    const corpo: Record<string, number | null> = {
      shippingFee: numero(freteTexto),
      ...(descModo === "PCT"
        ? { discountPct: numero(descTexto), discount: 0 }
        : { discount: numero(descTexto), discountPct: null }),
      ...(acrModo === "PCT"
        ? { surchargePct: numero(acrTexto), surcharge: 0 }
        : { surcharge: numero(acrTexto), surchargePct: null }),
    };
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }).catch(() => null);
    setSalvando(false);
    if (!res || !res.ok) {
      const d = await res?.json().catch(() => ({}));
      setErro(d?.error ?? "Não foi possível salvar os valores.");
      return;
    }
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        disabled={!podeEditar || bloqueado}
        title={
          bloqueado
            ? "Pedido cancelado não pode ser editado"
            : !podeEditar
              ? "Desconto e acréscimo: só gerente ou admin"
              : undefined
        }
        className="mt-3 w-full rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Desconto, acréscimo e frete
      </button>
    );
  }

  const linhaAjuste = (
    rotulo: string,
    icone: React.ReactNode,
    modo: Modo,
    setModo: (m: Modo) => void,
    texto: string,
    setTexto: (t: string) => void,
    calculado: number,
    tom: string
  ) => (
    <div>
      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icone}
        {rotulo}
      </label>
      <div className="flex gap-1.5">
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setModo("VALOR")}
            className={`px-2 py-1.5 text-xs font-semibold transition ${modo === "VALOR" ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:text-brand-700"}`}
          >
            R$
          </button>
          <button
            type="button"
            onClick={() => setModo("PCT")}
            className={`px-2 py-1.5 text-xs font-semibold transition ${modo === "PCT" ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:text-brand-700"}`}
          >
            %
          </button>
        </div>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-brand-400"
        />
      </div>
      {modo === "PCT" && calculado > 0 && (
        <p className={`mt-1 text-[11px] tabular-nums ${tom}`}>= {brl(calculado)}</p>
      )}
    </div>
  );

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {linhaAjuste(
          "Desconto",
          <Tag className="size-3" />,
          descModo,
          setDescModo,
          descTexto,
          setDescTexto,
          previa.discount,
          "text-rose-600"
        )}
        {linhaAjuste(
          "Acréscimo",
          <Plus className="size-3" />,
          acrModo,
          setAcrModo,
          acrTexto,
          setAcrTexto,
          previa.surcharge,
          "text-emerald-600"
        )}
      </div>

      {/* frete apartado: não é venda, não comissiona, não fatura */}
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5">
        <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <Truck className="size-3" />
          Frete
        </label>
        <input
          value={freteTexto}
          onChange={(e) => setFreteTexto(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-brand-400"
        />
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          A cliente paga o frete, mas ele <b>não conta como faturamento</b> da loja nem entra na
          comissão da vendedora.
        </p>
      </div>

      {/* atalho de balcão */}
      <div className="mt-3 flex items-end gap-1.5">
        <div className="min-w-0 flex-1">
          <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <DollarSign className="size-3" />
            Fechar por (total)
          </label>
          <input
            value={fecharPor}
            onChange={(e) => setFecharPor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && aplicarFecharPor()}
            inputMode="decimal"
            placeholder="ex.: 5000"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-brand-400"
          />
        </div>
        <button
          type="button"
          onClick={aplicarFecharPor}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-700"
        >
          <Percent className="size-3.5" />
        </button>
      </div>

      {/* prévia: os dois totais, sempre lado a lado */}
      <div className="mt-3 space-y-1 rounded-lg bg-white p-2.5 text-sm">
        <div className="flex justify-between text-slate-500">
          <span>Produtos</span>
          <span className="tabular-nums">{brl(previa.subtotal)}</span>
        </div>
        {previa.discount > 0 && (
          <div className="flex justify-between text-rose-600">
            <span>Desconto</span>
            <span className="tabular-nums">− {brl(previa.discount)}</span>
          </div>
        )}
        {previa.surcharge > 0 && (
          <div className="flex justify-between text-emerald-600">
            <span>Acréscimo</span>
            <span className="tabular-nums">+ {brl(previa.surcharge)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-800">
          <span>Valor vendido</span>
          <span className="tabular-nums">{brl(previa.netTotal)}</span>
        </div>
        {previa.shippingFee > 0 && (
          <div className="flex justify-between text-slate-500">
            <span>Frete</span>
            <span className="tabular-nums">+ {brl(previa.shippingFee)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-100 pt-1 text-base font-bold text-brand-700">
          <span>Total a pagar</span>
          <span className="tabular-nums">{brl(previa.total)}</span>
        </div>
      </div>

      {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => {
            setAberto(false);
            setErro("");
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <X className="size-3.5" />
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <Check className="size-3.5" />
          {salvando ? "Salvando…" : "Salvar valores"}
        </button>
      </div>
    </div>
  );
}
