"use client";

/**
 * MÍNIMOS (RN-051): o da loja (vale para tudo que não tem mínimo próprio), o
 * de cada categoria, e a explicação de onde se define o de cada peça (na
 * linha do Inventário). Gerência edita; o resto vê.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import { Alert, Spinner } from "@/components/ui";

type Dados = {
  loja: number;
  categorias: { categoria: string; minimo: number | null }[];
  podeAjustar: boolean;
};

export function MinimosView() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [loja, setLoja] = useState("");
  const [salvandoLoja, setSalvandoLoja] = useState(false);
  const [okLoja, setOkLoja] = useState(false);

  async function carregar() {
    const r = await fetch("/api/estoque/minimos", { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return setErro(d?.error ?? "Não foi possível carregar os mínimos.");
    setDados(d);
    setLoja(String(d.loja));
  }
  useEffect(() => {
    carregar();
  }, []);

  async function salvarLoja() {
    const n = parseInt(loja, 10);
    if (!Number.isInteger(n) || n < 0) return;
    setSalvandoLoja(true);
    const r = await fetch("/api/estoque/minimos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loja: n }),
    });
    setSalvandoLoja(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível salvar.");
      return;
    }
    setOkLoja(true);
    setTimeout(() => setOkLoja(false), 1500);
    carregar();
  }

  if (erro)
    return (
      <Alert tone="danger" icon={<AlertTriangle />}>
        {erro}
      </Alert>
    );
  if (!dados)
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-4 max-w-3xl">
      <Alert tone="info">
        A régua é uma só: <b>a peça</b> manda; sem mínimo próprio vale o <b>da categoria</b>; sem os dois, o{" "}
        <b>da loja</b>. Quando uma cor/tamanho <b>chega</b> ao mínimo, a gerência recebe um aviso no sino (uma vez por
        peça — volta a avisar só depois que ela sobe e cai de novo).
      </Alert>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-800">Mínimo da loja</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Vale para toda cor e tamanho que não tem mínimo próprio nem de categoria. É o mesmo número do cartão
          &quot;Estoque baixo&quot; do Dashboard.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={loja}
            onChange={(e) => setLoja(e.target.value.replace(/\D/g, ""))}
            disabled={!dados.podeAjustar}
            inputMode="numeric"
            className="w-24 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-right tabular-nums outline-none focus:border-brand-400 disabled:bg-slate-50"
          />
          <span className="text-xs text-slate-500">peças de cada cor/tamanho</span>
          {dados.podeAjustar && (
            <button
              type="button"
              onClick={salvarLoja}
              disabled={salvandoLoja || loja === String(dados.loja)}
              className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {salvandoLoja ? "…" : okLoja ? "Salvo ✓" : "Salvar"}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-800">Mínimo por categoria</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Em branco = usa o da loja ({dados.loja}). Vale para cada cor/tamanho dos modelos da categoria.
          </p>
        </div>
        {dados.categorias.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400 text-center">Nenhuma categoria cadastrada ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {dados.categorias.map((c) => (
              <LinhaCategoria key={c.categoria} c={c} podeAjustar={dados.podeAjustar} onSalvo={carregar} />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-600">
        <b>Mínimo por peça:</b> abra o{" "}
        <Link href="/estoque" className="text-brand-700 hover:underline">
          Inventário
        </Link>{" "}
        e clique no número da coluna <b>Mín.</b> da peça. Ele vale para cada cor e tamanho daquele modelo.
      </div>
    </div>
  );
}

function LinhaCategoria({
  c,
  podeAjustar,
  onSalvo,
}: {
  c: { categoria: string; minimo: number | null };
  podeAjustar: boolean;
  onSalvo: () => void;
}) {
  const [valor, setValor] = useState(c.minimo === null ? "" : String(c.minimo));
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => setValor(c.minimo === null ? "" : String(c.minimo)), [c.minimo]);
  const mudou = valor !== (c.minimo === null ? "" : String(c.minimo));

  async function salvar() {
    setSalvando(true);
    setErro("");
    const r = await fetch("/api/estoque/minimos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoria: c.categoria, minimo: valor === "" ? null : parseInt(valor, 10) }),
    });
    setSalvando(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível salvar.");
      return;
    }
    setOk(true);
    setTimeout(() => setOk(false), 1500);
    onSalvo();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="flex-1 text-sm text-slate-800">{c.categoria}</span>
      {erro && <span className="text-[11px] text-rose-600">{erro}</span>}
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && mudou && salvar()}
        disabled={!podeAjustar}
        placeholder="da loja"
        inputMode="numeric"
        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm text-right tabular-nums outline-none focus:border-brand-400 disabled:bg-slate-50"
      />
      {podeAjustar && (
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !mudou}
          className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 disabled:opacity-40"
        >
          {salvando ? "…" : ok ? <Check className="size-3.5 inline text-emerald-600" /> : "Salvar"}
        </button>
      )}
    </li>
  );
}
