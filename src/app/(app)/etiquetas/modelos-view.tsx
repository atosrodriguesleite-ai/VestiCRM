"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { TIPOS, type TipoDeEtiqueta } from "@/lib/etiquetas/modelo";
import { EditorDeModelo } from "./editor-de-modelo";

export type ModeloNaLista = {
  id: string;
  nome: string;
  tipo: TipoDeEtiqueta;
  larguraMm: number;
  alturaMm: number;
  colunas: number;
  espacoMm: number;
  girada: boolean;
  padrao: boolean;
  editado: boolean;
  updatedAt: string;
};

/**
 * ABA MODELOS (RN-059): os modelos da loja por tipo, com criar, editar,
 * duplicar, definir como padrão e arquivar; e a composição (tecido) por
 * categoria, que a etiqueta de composição imprime.
 */
export function ModelosView({
  modelos,
  composicoes,
  categorias,
  podeEditar,
}: {
  modelos: ModeloNaLista[];
  composicoes: { category: string; composition: string }[];
  categorias: string[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ nome: string; tipo: TipoDeEtiqueta } | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [erro, setErro] = useState("");

  async function chamar(url: string, init: RequestInit, chave: string) {
    setBusy(chave);
    setErro("");
    const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    const d = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) {
      setErro(d?.error ?? "Não foi possível concluir.");
      return null;
    }
    router.refresh();
    return d;
  }

  async function criar() {
    if (!novo) return;
    const d = await chamar("/api/etiquetas/modelos", { method: "POST", body: JSON.stringify(novo) }, "novo");
    if (d?.modelo?.id) {
      setNovo(null);
      setEditando(d.modelo.id);
    }
  }


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-500">
          Cada tipo de etiqueta tem um modelo <b>padrão</b> (é o que os botões de imprimir usam). Crie quantos
          quiser e defina o padrão.
        </p>
        {podeEditar && (
          <button
            type="button"
            onClick={() => setNovo({ nome: "", tipo: "EMBALAGEM" })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
          >
            <Plus className="size-4" /> Novo modelo
          </button>
        )}
      </div>
      {erro && <p className="text-sm text-rose-600">{erro}</p>}

      {TIPOS.map((t) => {
        const lista = modelos.filter((m) => m.tipo === t.tipo);
        return (
          <Card key={t.tipo} className="p-5">
            <h2 className="font-semibold">{t.rotulo}</h2>
            <p className="text-xs text-gray-500 mb-3">{t.descricao}</p>
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
              {lista.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {m.nome}
                      {m.padrao && (
                        <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100 px-2 py-0.5 text-[10px] font-semibold">
                          padrão
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {m.larguraMm} × {m.alturaMm} mm{m.colunas > 1 ? ` · ${m.colunas} colunas` : ""}
                      {m.girada ? " · girada" : ""} · {m.editado ? "desenho próprio" : "desenho automático"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditando(m.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-2.5 py-1.5"
                    >
                      <Pencil className="size-3.5" /> {podeEditar ? "Editar" : "Ver"}
                    </button>
                    {podeEditar && (
                      <>
                        <button
                          type="button"
                          title="Duplicar este modelo"
                          disabled={busy !== ""}
                          onClick={() =>
                            chamar("/api/etiquetas/modelos", { method: "POST", body: JSON.stringify({ nome: `${m.nome} (cópia)`, tipo: m.tipo, copiarDe: m.id }) }, m.id)
                          }
                          className="rounded-lg border border-gray-200 hover:border-gray-300 text-gray-500 p-1.5"
                        >
                          <Copy className="size-3.5" />
                        </button>
                        {!m.padrao && (
                          <button
                            type="button"
                            title="Definir como padrão deste tipo"
                            disabled={busy !== ""}
                            onClick={() => chamar(`/api/etiquetas/modelos/${m.id}`, { method: "PATCH", body: JSON.stringify({ padrao: true }) }, m.id)}
                            className="rounded-lg border border-gray-200 hover:border-amber-300 text-gray-500 hover:text-amber-600 p-1.5"
                          >
                            <Star className="size-3.5" />
                          </button>
                        )}
                        {!m.padrao && (
                          <button
                            type="button"
                            title="Arquivar (some da lista; não apaga)"
                            disabled={busy !== ""}
                            onClick={() => {
                              if (confirm(`Arquivar o modelo "${m.nome}"?`)) chamar(`/api/etiquetas/modelos/${m.id}`, { method: "DELETE" }, m.id);
                            }}
                            className="rounded-lg border border-gray-200 hover:border-rose-300 text-gray-500 hover:text-rose-600 p-1.5"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      <ComposicaoPorCategoria categorias={categorias} composicoes={composicoes} podeEditar={podeEditar} />

      {novo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setNovo(null)} />
          <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-md p-6 space-y-3">
            <h3 className="font-semibold text-lg">Novo modelo</h3>
            <input
              autoFocus
              value={novo.nome}
              onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
              placeholder="Nome (ex.: Embalagem rolo 4 colunas)"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
            <div className="grid gap-2">
              {TIPOS.map((t) => (
                <label key={t.tipo} className={`flex items-start gap-2 rounded-xl border px-3 py-2 cursor-pointer ${novo.tipo === t.tipo ? "border-brand-400 bg-brand-50" : "border-gray-200"}`}>
                  <input type="radio" name="tipo" checked={novo.tipo === t.tipo} onChange={() => setNovo({ ...novo, tipo: t.tipo })} className="mt-1" />
                  <span>
                    <span className="text-sm font-medium">{t.rotulo}</span>
                    <span className="block text-xs text-gray-500">{t.descricao}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setNovo(null)} className="rounded-xl border border-gray-200 text-gray-600 text-sm px-4 py-2">
                Cancelar
              </button>
              <button
                type="button"
                disabled={!novo.nome.trim() || busy === "novo"}
                onClick={criar}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
              >
                {busy === "novo" && <Loader2 className="size-4 animate-spin" />} Criar e editar
              </button>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <EditorDeModelo
          modeloId={editando}
          podeEditar={podeEditar}
          onClose={() => {
            setEditando(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Composição (tecido) por categoria: a peça só preenche a dela quando difere. */
function ComposicaoPorCategoria({
  categorias,
  composicoes,
  podeEditar,
}: {
  categorias: string[];
  composicoes: { category: string; composition: string }[];
  podeEditar: boolean;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(composicoes.map((c) => [c.category, c.composition]))
  );
  /** o último valor que o servidor confirmou: só o que MUDOU vai ao servidor no blur */
  const [salvos, setSalvos] = useState<Record<string, string>>(() => ({ ...valores }));
  const [salvando, setSalvando] = useState<string>("");
  const [ok, setOk] = useState<string>("");
  const [erro, setErro] = useState<string>("");

  async function salvar(category: string) {
    // tabular pelos campos sem digitar nada disparava um PATCH por campo
    if ((valores[category] ?? "") === (salvos[category] ?? "")) return;
    setSalvando(category);
    setOk("");
    setErro("");
    const r = await fetch("/api/etiquetas/composicao", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, composition: valores[category] ?? "" }),
    });
    const d = await r.json().catch(() => null);
    setSalvando("");
    // falha calada aqui é a etiqueta saindo com o tecido velho: sempre diz
    if (r.ok) {
      setOk(category);
      setSalvos((v) => ({ ...v, [category]: valores[category] ?? "" }));
    } else setErro(`"${category}": ${d?.error ?? "não foi possível salvar (sessão vencida?)"}`);
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Composição por categoria</h2>
      <p className="text-xs text-gray-500 mb-3">
        O tecido que a etiqueta de composição imprime. Vale para todas as peças da categoria; a peça só precisa da
        própria composição (na ficha dela) quando for diferente.
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        {categorias.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <span className="text-sm text-gray-700 w-32 truncate" title={c}>
              {c}
            </span>
            <input
              value={valores[c] ?? ""}
              disabled={!podeEditar}
              onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))}
              onBlur={() => podeEditar && salvar(c)}
              placeholder="Ex.: 8% elastano, 92% poliamida"
              className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-400 disabled:bg-gray-50"
            />
            <span className="w-4 text-xs text-emerald-600">{salvando === c ? "…" : ok === c ? "✓" : ""}</span>
          </div>
        ))}
        {erro && <p className="sm:col-span-2 text-xs text-rose-600">Não salvou {erro}</p>}
        {categorias.length === 0 && <p className="text-xs text-gray-400">Cadastre peças com categoria para preencher aqui.</p>}
      </div>
    </Card>
  );
}
