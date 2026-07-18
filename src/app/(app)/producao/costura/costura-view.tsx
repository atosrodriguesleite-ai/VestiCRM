"use client";

/**
 * Estoque de Costura — a estação entre o corte e a peça pronta.
 * Vendas e adm enxergam o que está cortado aguardando montagem; o
 * lançamento dá entrada no estoque real e baixa daqui.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Shirt } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";

export type CosturaRow = {
  id: string;
  cutCode: number | null;
  productName: string;
  color: string | null;
  size: string | null;
  cutPieces: number;
  donePieces: number;
  createdAt: string;
};

const inputCls =
  "rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

export function CosturaView({ itens }: { itens: CosturaRow[] }) {
  const router = useRouter();
  const [aba, setAba] = useState<"PENDENTES" | "CONCLUIDAS">("PENDENTES");
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [msg, setMsg] = useState<{ id: string; texto: string; tom: "ok" | "aviso" } | null>(null);

  const pendentes = useMemo(
    () => itens.filter((i) => i.cutPieces - i.donePieces > 0),
    [itens]
  );
  const concluidas = useMemo(
    () => itens.filter((i) => i.cutPieces - i.donePieces === 0),
    [itens]
  );
  const lista = aba === "PENDENTES" ? pendentes : concluidas;

  async function lancar(item: CosturaRow) {
    const restantes = item.cutPieces - item.donePieces;
    const n = parseInt(qtd[item.id] ?? String(restantes), 10);
    if (!(n > 0)) return;
    setBusyId(item.id);
    setMsg(null);
    const res = await fetch(`/api/producao/costura/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pieces: n }),
    });
    const d = await res.json().catch(() => ({}));
    setBusyId("");
    if (res.ok) {
      setMsg({
        id: item.id,
        texto: d.destino
          ? `✅ ${d.lancadas} peça(s) no estoque de ${d.destino} — loja online atualizada junto.`
          : `⚠️ ${d.aviso}`,
        tom: d.destino ? "ok" : "aviso",
      });
      setQtd((q) => ({ ...q, [item.id]: "" }));
      router.refresh();
    } else {
      setMsg({ id: item.id, texto: d.error ?? "Não foi possível lançar.", tom: "aviso" });
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4">
        {(["PENDENTES", "CONCLUIDAS"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition ${
              aba === t
                ? "bg-brand-600 border-brand-600 text-white"
                : "bg-white border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {t === "PENDENTES" ? `Aguardando montagem (${pendentes.length})` : `Concluídas (${concluidas.length})`}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Shirt />}
            title={aba === "PENDENTES" ? "Nada aguardando montagem" : "Nenhum lote concluído ainda"}
            hint="As peças chegam aqui automaticamente quando um corte registra produção."
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {lista.map((i) => {
            const restantes = i.cutPieces - i.donePieces;
            return (
              <div key={i.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-800">
                    {i.productName}
                    {i.color && <span className="text-gray-500 font-normal"> · {i.color}</span>}
                    {i.size && <span className="text-gray-500 font-normal"> · {i.size}</span>}
                    {i.cutCode != null && (
                      <span className="text-[11px] text-gray-400 font-mono font-normal">
                        {"  "}corte #{String(i.cutCode).padStart(6, "0")}
                      </span>
                    )}
                  </p>
                  <span className="text-xs text-gray-400">
                    {new Date(i.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mt-1">
                  <span>Cortadas: <b className="text-gray-700">{i.cutPieces}</b></span>
                  <span>Montadas: <b className="text-emerald-700">{i.donePieces}</b></span>
                  {restantes > 0 ? (
                    <span className="rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-semibold px-2.5 py-0.5">
                      {restantes} na costura
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold px-2.5 py-0.5">
                      lote completo ✓
                    </span>
                  )}
                </div>
                {restantes > 0 && (
                  <div className="flex items-center gap-2 mt-2.5">
                    <input
                      value={qtd[i.id] ?? ""}
                      onChange={(e) => setQtd((q) => ({ ...q, [i.id]: e.target.value }))}
                      inputMode="numeric"
                      placeholder={String(restantes)}
                      className={inputCls + " w-24"}
                    />
                    <button
                      onClick={() => lancar(i)}
                      disabled={busyId === i.id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3.5 py-2 transition disabled:opacity-50"
                    >
                      {busyId === i.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      Lançar prontas no estoque
                    </button>
                  </div>
                )}
                {msg?.id === i.id && (
                  <p
                    className={`text-xs rounded-lg px-3 py-2 mt-2 ${
                      msg.tom === "ok"
                        ? "text-emerald-700 bg-emerald-50"
                        : "text-amber-800 bg-amber-50"
                    }`}
                  >
                    {msg.texto}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
