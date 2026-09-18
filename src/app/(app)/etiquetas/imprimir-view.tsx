"use client";

import { useMemo, useState } from "react";
import { Loader2, Package, Search, Truck } from "lucide-react";
import { Card } from "@/components/ui";
import { casaTexto } from "@/lib/busca";
import type { TipoDeEtiqueta } from "@/lib/etiquetas/modelo";
import { ImprimirEtiquetas, type ItemParaEtiqueta } from "@/components/imprimir-etiquetas";

type ModeloOpcao = { id: string; nome: string; tipo: TipoDeEtiqueta; padrao: boolean };
type Produto = { id: string; name: string; sku: string; category: string; variants: { id: string; color: string; size: string; stock: number }[] };

/**
 * ABA IMPRIMIR (RN-059): escolhe o modelo e o que imprimir — uma peça (a
 * grade inteira) ou um pedido pelo número (as peças dele; com modelo de
 * ENVIO, a etiqueta do pacote com o endereço da cliente).
 */
export function ImprimirView({ modelos, produtos }: { modelos: ModeloOpcao[]; produtos: Produto[] }) {
  const padrao = modelos.find((m) => m.tipo === "EMBALAGEM" && m.padrao) ?? modelos[0];
  const [modeloId, setModeloId] = useState(padrao?.id ?? "");
  const modelo = modelos.find((m) => m.id === modeloId) ?? padrao;
  const [q, setQ] = useState("");
  const [numero, setNumero] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<{ titulo: string; itens: ItemParaEtiqueta[]; envio?: { orderId: string } } | null>(null);

  const achados = useMemo(() => {
    const t = q.trim();
    if (t.length < 2) return [];
    return produtos.filter((p) => casaTexto(`${p.name} ${p.sku} ${p.category}`, t)).slice(0, 30);
  }, [q, produtos]);

  function abrirPeca(p: Produto) {
    setAberto({
      titulo: p.name,
      itens: p.variants.map((v) => ({ variantId: v.id, rotulo: `${v.color} · ${v.size}`, quantidade: Math.max(0, v.stock) })),
    });
  }

  async function abrirPedido() {
    setBuscando(true);
    setErro("");
    const r = await fetch(`/api/etiquetas/pedido?numero=${encodeURIComponent(numero)}`);
    const d = await r.json().catch(() => null);
    setBuscando(false);
    if (!r.ok) {
      setErro(d?.error ?? "Pedido não encontrado.");
      return;
    }
    if (modelo?.tipo === "ENVIO") {
      setAberto({ titulo: `Pedido ${d.numero} · ${d.cliente}`, itens: [], envio: { orderId: d.id } });
    } else {
      setAberto({ titulo: `Pedido ${d.numero} · ${d.cliente}`, itens: d.itens });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <label className="text-sm font-medium text-gray-700">Modelo de etiqueta</label>
        <select value={modeloId} onChange={(e) => setModeloId(e.target.value)} className="mt-1 w-full max-w-md rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400">
          {(["EMBALAGEM", "COMPOSICAO", "ENVIO"] as TipoDeEtiqueta[]).map((t) => (
            <optgroup key={t} label={t === "EMBALAGEM" ? "Embalagem" : t === "COMPOSICAO" ? "Composição" : "Envio"}>
              {modelos.filter((m) => m.tipo === t).map((m) => (
                <option key={m.id} value={m.id}>{m.nome}{m.padrao ? " (padrão)" : ""}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className={`p-5 ${modelo?.tipo === "ENVIO" ? "opacity-50" : ""}`}>
          <h2 className="font-semibold flex items-center gap-2 mb-1"><Package className="size-4 text-brand-600" /> Por peça</h2>
          <p className="text-xs text-gray-500 mb-3">Busque a peça: a grade inteira abre para você ajustar as quantidades.</p>
          <div className="relative">
            <Search className="size-4 text-gray-400 absolute left-3 top-2.5" />
            <input
              value={q}
              disabled={modelo?.tipo === "ENVIO"}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, SKU ou categoria"
              className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400 disabled:bg-gray-50"
            />
          </div>
          {achados.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto thin-scroll rounded-xl border border-gray-100 divide-y divide-gray-50">
              {achados.map((p) => (
                <button key={p.id} type="button" onClick={() => abrirPeca(p)} className="w-full text-left px-3 py-2 hover:bg-gray-50">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-gray-400">{p.sku} · {p.category} · {p.variants.length} variação{p.variants.length === 1 ? "" : "ões"}</p>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && achados.length === 0 && <p className="mt-2 text-xs text-gray-400">Nenhuma peça com esse nome.</p>}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-1"><Truck className="size-4 text-brand-600" /> Por pedido</h2>
          <p className="text-xs text-gray-500 mb-3">
            {modelo?.tipo === "ENVIO"
              ? "Etiqueta do pacote com o endereço da cliente e o número do pedido."
              : "As peças do pedido, já com a quantidade de cada linha."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (numero.trim()) abrirPedido();
            }}
            className="flex gap-2"
          >
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              inputMode="numeric"
              placeholder="Número do pedido (ex.: 110)"
              className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
            <button type="submit" disabled={buscando || !numero.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-50">
              {buscando ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Abrir
            </button>
          </form>
          {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
        </Card>
      </div>

      {aberto && modelo && (
        <ImprimirEtiquetas
          titulo={`${aberto.titulo} · ${modelo.nome}`}
          itens={aberto.itens}
          modeloId={modelo.id}
          envio={aberto.envio}
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}
