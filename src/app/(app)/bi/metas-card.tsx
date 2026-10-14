"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { Card } from "@/components/ui";
import { brl } from "@/lib/format";
import { numeroBR } from "@/lib/numero-br";
import { TIPOS_DE_META, progressoDaMeta, type TipoDeMeta } from "@/lib/bi/metas";

type Props = {
  mes: string;
  rotuloDoMes: string;
  metas: Partial<Record<TipoDeMeta, number>>;
  realizado: Record<TipoDeMeta, number | null>;
};

function mostrar(valor: number | null, formato: string): string {
  if (valor == null) return "—";
  if (formato === "brl") return brl(valor);
  if (formato === "pct") return `${valor}%`;
  return String(valor);
}

/**
 * METAS DO MÊS (RN-082): a loja preenche as que quiser; cada uma vira uma
 * barra "realizado × meta". Sem número, a linha fica em branco e fora do
 * painel — meta é escolha, não obrigação.
 */
export function MetasCard({ mes, rotuloDoMes, metas, realizado }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(TIPOS_DE_META.map((t) => [t.tipo, metas[t.tipo] != null ? String(metas[t.tipo]) : ""]))
  );
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setErro("");
    // "1.500,50", "1500.50" e "4,95" entram certos (régua de numero-br); texto
    // que não é número é recusado AQUI — mandar NaN apagaria a meta em silêncio
    const metas: { tipo: string; valor: number | null }[] = [];
    for (const t of TIPOS_DE_META) {
      const texto = valores[t.tipo].trim();
      if (!texto) {
        metas.push({ tipo: t.tipo, valor: null });
        continue;
      }
      const n = numeroBR(texto);
      if (n === null) {
        setErro(`"${texto}" não é um número (${t.rotulo}).`);
        return;
      }
      metas.push({ tipo: t.tipo, valor: n });
    }
    setSaving(true);
    try {
      const res = await fetch("/api/bi/metas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, metas }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(json.error ?? "Não foi possível salvar.");
        return;
      }
      setEditando(false);
      router.refresh();
    } catch {
      setErro("Sem conexão — confira a internet e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  const comMeta = TIPOS_DE_META.filter((t) => metas[t.tipo] != null);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Target className="size-4 text-brand-600" />
          Metas de {rotuloDoMes}
        </h2>
        <button
          type="button"
          onClick={() => setEditando((e) => !e)}
          className="text-xs text-brand-700 hover:underline"
        >
          {editando ? "Fechar" : comMeta.length ? "Editar metas" : "Definir metas"}
        </button>
      </div>

      {!editando && comMeta.length === 0 && (
        <p className="text-sm text-gray-500">
          Nenhuma meta definida para este mês. Escolha as que fazem sentido para a sua loja:
          faturamento, pedidos, novos contatos, resposta no prazo, ticket ou recompra.
        </p>
      )}

      {!editando && comMeta.length > 0 && (
        <div className="space-y-3">
          {comMeta.map((t) => {
            const meta = metas[t.tipo]!;
            const feito = realizado[t.tipo];
            const pct = progressoDaMeta(feito, meta);
            const largura = Math.min(100, pct ?? 0);
            const tom = pct == null ? "bg-gray-300" : pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-brand-500" : "bg-amber-500";
            return (
              <div key={t.tipo}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-gray-700">{t.rotulo}</span>
                  <span className="text-gray-500 tabular-nums">
                    {mostrar(feito, t.formato)} <span className="text-gray-300">/</span> {mostrar(meta, t.formato)}
                    {pct != null && <b className="ml-2 text-gray-700">{pct}%</b>}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 mt-1 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${tom}`} style={{ width: `${largura}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editando && (
        <div className="grid sm:grid-cols-2 gap-3">
          {TIPOS_DE_META.map((t) => (
            <label key={t.tipo} className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">
                {t.rotulo} <span className="text-gray-400">({t.unidade})</span>
              </span>
              <input
                inputMode="decimal"
                value={valores[t.tipo]}
                onChange={(e) => setValores((v) => ({ ...v, [t.tipo]: e.target.value }))}
                placeholder="sem meta"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white outline-none focus:border-brand-400"
              />
            </label>
          ))}
          {erro && <p className="sm:col-span-2 text-sm text-red-600">{erro}</p>}
          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="button"
              onClick={salvar}
              disabled={saving}
              className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Salvar metas"}
            </button>
            <span className="text-xs text-gray-400">Campo em branco = sem meta daquele tipo.</span>
          </div>
        </div>
      )}
    </Card>
  );
}
