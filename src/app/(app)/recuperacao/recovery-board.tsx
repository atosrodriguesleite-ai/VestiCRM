"use client";

/**
 * ESTEIRA DE RECUPERAÇÃO — Novos → Chamadas → Recuperados/Perdidos.
 *
 * Cada carrinho mostra quem é a cliente, as peças, o valor e de onde veio
 * (catálogo ou Nuvemshop). Um toque abre o WhatsApp com a mensagem pronta —
 * incluindo o link mágico que REMONTA a sacola. O placar do mês mostra o que
 * a recuperação está rendendo de verdade (pedidos pagos amarrados).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShoppingCart,
  Sparkles,
  RotateCcw,
  CheckCircle,
  XCircle,
  Store,
  Globe,
} from "lucide-react";
import { brl, formatPhone } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";

type Item = {
  productId?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  qty: number;
};

type Cart = {
  id: string;
  source: string;
  status: "NOVO" | "CHAMADA" | "RECUPERADO" | "PERDIDO";
  value: number;
  items: Item[];
  customer: { id: string; name: string; phone: string } | null;
  channel: string | null;
  abandonedAt: string;
  autoSentAt: string | null;
  recoveredAt: string | null;
  checkoutUrl: string | null;
  mensagem: string;
};

type Dados = {
  recoveryAuto: boolean;
  podeConfigurar: boolean;
  placarMes: number;
  recuperadosMes: number;
  carts: Cart[];
};

const COLUNAS: { status: Cart["status"]; titulo: string; cor: string }[] = [
  { status: "NOVO", titulo: "Novos", cor: "#e11d48" },
  { status: "CHAMADA", titulo: "Chamadas", cor: "#d97706" },
  { status: "RECUPERADO", titulo: "Recuperados", cor: "#059669" },
  { status: "PERDIDO", titulo: "Perdidos", cor: "#94a3b8" },
];

function tempoDesde(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "há menos de 1h";
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}

export function RecoveryBoard() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [salvandoAuto, setSalvandoAuto] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/recuperacao");
    if (r.ok) setDados(await r.json());
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function mover(id: string, status: Cart["status"]) {
    // otimista: a tela responde na hora, o servidor confirma atrás
    setDados((d) =>
      d
        ? { ...d, carts: d.carts.map((c) => (c.id === id ? { ...c, status } : c)) }
        : d
    );
    await fetch(`/api/recuperacao/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    carregar();
  }

  async function alternarAuto() {
    if (!dados) return;
    setSalvandoAuto(true);
    await fetch("/api/recuperacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryAuto: !dados.recoveryAuto }),
    });
    setSalvandoAuto(false);
    carregar();
  }

  function abrirWhats(c: Cart) {
    if (!c.customer?.phone) return;
    const dig = c.customer.phone.replace(/\D/g, "");
    const fone = dig.length <= 11 ? `55${dig}` : dig;
    window.open(
      `https://wa.me/${fone}?text=${encodeURIComponent(c.mensagem)}`,
      "_blank"
    );
    if (c.status === "NOVO") mover(c.id, "CHAMADA");
  }

  const porColuna = (status: Cart["status"]) =>
    (dados?.carts ?? []).filter((c) => c.status === status);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Recuperação de carrinhos"
        subtitle="Quem encheu a sacola e não finalizou — do catálogo e da Nuvemshop. Chame antes que esfrie."
        action={
          dados && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-right">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                  Recuperado no mês
                </p>
                <p className="text-lg font-semibold text-emerald-700 tabular-nums">
                  {brl(dados.placarMes)}
                  <span className="text-xs font-normal text-emerald-600">
                    {" "}
                    · {dados.recuperadosMes} venda{dados.recuperadosMes === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
              {dados.podeConfigurar && (
                <button
                  onClick={alternarAuto}
                  disabled={salvandoAuto}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    dados.recoveryAuto
                      ? "bg-brand-600 border-brand-600 text-white"
                      : "bg-white border-gray-200 text-gray-500 hover:border-brand-300"
                  }`}
                  title="A 1ª mensagem sai sozinha 2h após o abandono (horário comercial, ritmo anti-bloqueio). A insistência continua sendo sua."
                >
                  <Sparkles className="size-3.5" />
                  1ª mensagem automática: {dados.recoveryAuto ? "LIGADA" : "desligada"}
                </button>
              )}
            </div>
          )
        }
      />

      {!dados ? (
        <Card className="p-10 text-center text-sm text-gray-400">Carregando…</Card>
      ) : dados.carts.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum carrinho abandonado por aqui 🎉"
            hint="Quando alguém encher a sacola no catálogo (ou na Nuvemshop) e não finalizar, o carrinho aparece nesta esteira em até 1 hora."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {COLUNAS.map((col) => {
            const lista = porColuna(col.status);
            return (
              <div key={col.status} className="min-w-0">
                <p className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: col.cor }}
                  />
                  {col.titulo}
                  <span className="text-gray-300 font-semibold">{lista.length}</span>
                </p>
                <div className="space-y-3">
                  {lista.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-300">
                      vazio
                    </div>
                  )}
                  {lista.map((c) => (
                    <Card key={c.id} className="p-3.5">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          {c.customer ? (
                            <Link
                              href={`/clientes/${c.customer.id}`}
                              className="block text-sm font-semibold truncate hover:text-brand-600"
                            >
                              {c.customer.name}
                            </Link>
                          ) : (
                            <p className="text-sm font-semibold text-gray-400">
                              Visitante não identificada
                            </p>
                          )}
                          <p className="text-[11px] text-gray-400">
                            {c.customer ? `${formatPhone(c.customer.phone)} · ` : ""}
                            {tempoDesde(c.abandonedAt)}
                          </p>
                        </div>
                        <span
                          className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{
                            background: c.source === "NUVEMSHOP" ? "#14b8a61a" : "#c4622d1a",
                            color: c.source === "NUVEMSHOP" ? "#0d9488" : "#c4622d",
                          }}
                        >
                          {c.source === "NUVEMSHOP" ? (
                            <Globe className="size-3" />
                          ) : (
                            <Store className="size-3" />
                          )}
                          {c.source === "NUVEMSHOP" ? "Nuvemshop" : "Catálogo"}
                        </span>
                      </div>

                      <p className="text-base font-semibold text-emerald-700 tabular-nums mb-1.5">
                        {brl(c.value)}
                      </p>
                      <ul className="text-[11px] text-gray-500 space-y-0.5 mb-2.5">
                        {c.items.slice(0, 3).map((i, ix) => (
                          <li key={ix} className="truncate">
                            {[`${i.qty}× ${i.name}`, i.color, i.size]
                              .filter(Boolean)
                              .join(" · ")}
                          </li>
                        ))}
                        {c.items.length > 3 && (
                          <li className="text-gray-300">
                            e mais {c.items.length - 3}…
                          </li>
                        )}
                      </ul>

                      {c.autoSentAt && c.status !== "RECUPERADO" && (
                        <p className="mb-2 text-[10px] font-medium text-brand-600 flex items-center gap-1">
                          <Sparkles className="size-3" /> 1ª mensagem enviada automaticamente
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        {(c.status === "NOVO" || c.status === "CHAMADA") && (
                          <>
                            {c.customer?.phone && (
                              <button
                                onClick={() => abrirWhats(c)}
                                className="flex-1 min-w-max rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2.5 py-1.5 transition"
                              >
                                {c.status === "NOVO" ? "Recuperar no WhatsApp" : "Insistir no WhatsApp"}
                              </button>
                            )}
                            <button
                              onClick={() => mover(c.id, "RECUPERADO")}
                              className="rounded-lg border border-emerald-200 text-emerald-700 text-[11px] font-semibold px-2.5 py-1.5 hover:bg-emerald-50 transition"
                              title="A cliente comprou (fecha o carrinho como recuperado)"
                            >
                              <CheckCircle className="size-3.5" />
                            </button>
                            <button
                              onClick={() => mover(c.id, "PERDIDO")}
                              className="rounded-lg border border-gray-200 text-gray-400 text-[11px] font-semibold px-2.5 py-1.5 hover:bg-gray-50 transition"
                              title="Desistiu (fecha como perdido)"
                            >
                              <XCircle className="size-3.5" />
                            </button>
                          </>
                        )}
                        {(c.status === "RECUPERADO" || c.status === "PERDIDO") && (
                          <button
                            onClick={() => mover(c.id, "NOVO")}
                            className="flex items-center gap-1 rounded-lg border border-gray-200 text-gray-400 text-[11px] font-semibold px-2.5 py-1.5 hover:bg-gray-50 transition"
                          >
                            <RotateCcw className="size-3" /> Reabrir
                          </button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[11px] text-gray-400 flex items-center gap-1.5">
        <ShoppingCart className="size-3.5" />
        O carrinho fecha sozinho como “Recuperado” quando a cliente faz um pedido
        pago depois do abandono — o placar soma o valor real desses pedidos.
      </p>
    </div>
  );
}
