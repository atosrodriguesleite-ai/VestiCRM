"use client";

/**
 * Gerenciador de categorias do catálogo: criar, renomear e apagar. Ao apagar
 * uma categoria que tem produtos, o usuário escolhe MOVER os produtos para
 * outra categoria ou APAGAR os produtos junto. Liberado para gerente/admin e
 * para o perfil Suporte.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Portal } from "@/components/portal";
import { Tags, Plus, Pencil, Trash2, X, Check, Loader2, ArrowRight, AlertTriangle, AlignLeft } from "lucide-react";

type Cat = { name: string; count: number; description?: string };

export function CategoryManager() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [novo, setNovo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [apagando, setApagando] = useState<Cat | null>(null);
  const [moverPara, setMoverPara] = useState("");
  const [descrevendo, setDescrevendo] = useState<string | null>(null);
  const [descTexto, setDescTexto] = useState("");
  // `msg` nasceu só para erro (sai em vermelho); o aviso de "salvou" precisa
  // sair em verde, senão parece que deu problema quando deu certo.
  const [msgOk, setMsgOk] = useState(false);

  /**
   * Descrição da categoria no catálogo público. Antes o catálogo mostrava a
   * descrição do PRIMEIRO produto da seção — texto que mudava sozinho quando a
   * ordem mudava ou quando a Nuvemshop sobrescrevia o produto.
   */
  async function salvarDescricao(name: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: name, description: descTexto.trim() }),
    });
    setBusy(false);
    if (r.ok) {
      setDescrevendo(null);
      setMsgOk(true);
      setMsg(
        descTexto.trim()
          ? "Descrição salva — já aparece no catálogo."
          : "Descrição removida."
      );
      await carregar();
      router.refresh();
    } else {
      const d = await r.json().catch(() => ({}));
      setMsgOk(false);
      setMsg(d.error ?? "Não foi possível salvar a descrição.");
    }
  }

  async function carregar() {
    setCats(null);
    const r = await fetch("/api/categories");
    if (r.ok) setCats((await r.json()).categories);
    else { setMsgOk(false); setMsg("Não foi possível carregar as categorias."); }
  }
  useEffect(() => {
    if (open && cats === null) void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function criar() {
    const name = novo.trim();
    if (!name || busy) return;
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (r.ok) {
      setNovo("");
      await carregar();
      router.refresh();
    } else {
      const d = await r.json().catch(() => ({}));
      setMsgOk(false);
      setMsg(d.error ?? "Não foi possível criar.");
    }
  }

  async function renomear(from: string) {
    const to = editNome.trim();
    if (!to || to === from) {
      setEditando(null);
      return;
    }
    setBusy(true);
    const r = await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    setBusy(false);
    setEditando(null);
    if (r.ok) {
      await carregar();
      router.refresh();
    } else {
      const d = await r.json().catch(() => ({}));
      setMsgOk(false);
      setMsg(d.error ?? "Não foi possível renomear.");
    }
  }

  async function apagar(cat: Cat, opts: { moveTo?: string; deleteProducts?: boolean } = {}) {
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cat.name, ...opts }),
    });
    setBusy(false);
    if (r.ok) {
      setApagando(null);
      setMoverPara("");
      await carregar();
      router.refresh();
    } else {
      const d = await r.json().catch(() => ({}));
      setMsgOk(false);
      setMsg(d.error ?? "Não foi possível apagar.");
    }
  }

  function fechar() {
    setOpen(false);
    setEditando(null);
    setApagando(null);
    setMsg("");
  }

  const outras = (cats ?? []).filter((c) => c.name !== apagando?.name);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Criar, renomear e apagar categorias do catálogo"
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-3.5 py-2.5 transition"
      >
        <Tags className="size-4" />
        <span className="hidden sm:inline">Categorias</span>
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
            <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={fechar} />
            <div className="relative flex max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] w-full flex-col rounded-t-2xl bg-white shadow-pop animate-fade-up md:max-w-md md:rounded-2xl md:max-h-[85dvh]">
              <div className="border-b border-gray-100 p-5 pb-3">
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-lg font-semibold">
                    <Tags className="size-5 text-brand-600" /> Categorias
                  </h3>
                  <button onClick={fechar} className="p-1 text-gray-400">
                    <X className="size-5" />
                  </button>
                </div>
                <p className="text-xs leading-snug text-gray-500">
                  Organize o catálogo: crie, renomeie ou apague categorias.
                </p>
                {/* criar */}
                <div className="mt-3 flex items-center gap-2">
                  <input
                    value={novo}
                    onChange={(e) => setNovo(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && criar()}
                    placeholder="Nova categoria (ex.: Calças)"
                    maxLength={40}
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                  />
                  <button
                    onClick={criar}
                    disabled={busy || !novo.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
                  >
                    <Plus className="size-4" /> Criar
                  </button>
                </div>
                {msg && (
                  <p className={`mt-2 text-xs font-medium ${msgOk ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>
                )}
              </div>

              <div className="thin-scroll flex-1 overflow-y-auto p-5 pt-3">
                {cats === null ? (
                  <p className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                    <Loader2 className="size-4 animate-spin" /> Carregando...
                  </p>
                ) : cats.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">Nenhuma categoria ainda.</p>
                ) : (
                  <div className="space-y-1.5">
                    {cats.map((c) => (
                      <div key={c.name} className="rounded-xl border border-gray-100">
                        <div className="flex items-center gap-2 p-2.5">
                          {editando === c.name ? (
                            <>
                              <input
                                autoFocus
                                value={editNome}
                                onChange={(e) => setEditNome(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") renomear(c.name);
                                  if (e.key === "Escape") setEditando(null);
                                }}
                                maxLength={40}
                                className="min-w-0 flex-1 rounded-lg border border-brand-300 px-2.5 py-1.5 text-sm outline-none"
                              />
                              <button onClick={() => renomear(c.name)} className="grid size-8 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Salvar">
                                <Check className="size-4" />
                              </button>
                              <button onClick={() => setEditando(null)} className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100" title="Cancelar">
                                <X className="size-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{c.name}</span>
                              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                                {c.count} {c.count === 1 ? "produto" : "produtos"}
                              </span>
                              <button
                                onClick={() => {
                                  setEditando(c.name);
                                  setEditNome(c.name);
                                  setApagando(null);
                                }}
                                className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-brand-600"
                                title="Renomear"
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setDescrevendo(descrevendo === c.name ? null : c.name);
                                  setDescTexto(c.description ?? "");
                                  setApagando(null);
                                  setEditando(null);
                                }}
                                className={`grid size-8 place-items-center rounded-lg hover:bg-gray-100 hover:text-brand-600 ${
                                  c.description ? "text-brand-600" : "text-gray-400"
                                }`}
                                title="Descrição que aparece no catálogo"
                              >
                                <AlignLeft className="size-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setApagando(apagando?.name === c.name ? null : c);
                                  setMoverPara("");
                                  setEditando(null);
                                  setDescrevendo(null);
                                }}
                                className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-500"
                                title="Apagar"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </>
                          )}
                        </div>

                        {/* descrição da categoria no catálogo público */}
                        {descrevendo === c.name && (
                          <div className="border-t border-gray-100 bg-brand-50/40 p-3">
                            <p className="mb-1.5 text-xs font-semibold text-gray-700">
                              Texto que aparece embaixo de <b>{c.name}</b> no catálogo
                            </p>
                            <textarea
                              autoFocus
                              value={descTexto}
                              onChange={(e) => setDescTexto(e.target.value)}
                              maxLength={220}
                              rows={2}
                              placeholder="Ex.: Poliamida Premium · 100% Forrada · Zero transparência · P ao GG"
                              className="w-full resize-none rounded-lg border border-brand-200 px-2.5 py-2 text-sm outline-none focus:border-brand-400"
                            />
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-[11px] text-gray-400">
                                {descTexto.length}/220 · deixe vazio para não mostrar nada
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setDescrevendo(null)}
                                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
                                >
                                  Cancelar
                                </button>
                                <button
                                  onClick={() => salvarDescricao(c.name)}
                                  disabled={busy}
                                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                                >
                                  {busy ? "Salvando…" : "Salvar"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* painel de exclusão */}
                        {apagando?.name === c.name && (
                          <div className="border-t border-gray-100 bg-gray-50/60 p-3">
                            {c.count === 0 ? (
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-gray-600">Apagar a categoria <b>{c.name}</b>?</p>
                                <div className="flex gap-2">
                                  <button onClick={() => setApagando(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">Cancelar</button>
                                  <button onClick={() => apagar(c)} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">Apagar</button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2.5">
                                <p className="flex items-start gap-1.5 text-xs text-amber-700">
                                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                  <span>Essa categoria tem <b>{c.count} produto{c.count === 1 ? "" : "s"}</b>. O que fazer com eles?</span>
                                </p>
                                {/* mover para outra */}
                                <div className="flex items-center gap-2">
                                  <select
                                    value={moverPara}
                                    onChange={(e) => setMoverPara(e.target.value)}
                                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-brand-400"
                                  >
                                    <option value="">Mover produtos para...</option>
                                    {outras.map((o) => (
                                      <option key={o.name} value={o.name}>{o.name}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => apagar(c, { moveTo: moverPara })}
                                    disabled={busy || !moverPara}
                                    className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                                  >
                                    Mover e apagar <ArrowRight className="size-3.5" />
                                  </button>
                                </div>
                                {/* ou apagar produtos junto */}
                                <div className="flex items-center justify-between gap-2 border-t border-gray-200/70 pt-2">
                                  <p className="text-[11px] text-gray-500">Ou apague a categoria <b>e os produtos</b> dela.</p>
                                  <button
                                    onClick={() => {
                                      if (window.confirm(`Apagar a categoria "${c.name}" e os ${c.count} produtos dela? Não dá para desfazer.`)) {
                                        apagar(c, { deleteProducts: true });
                                      }
                                    }}
                                    disabled={busy}
                                    className="shrink-0 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                                  >
                                    Apagar tudo
                                  </button>
                                </div>
                                <button onClick={() => setApagando(null)} className="w-full rounded-lg py-1 text-xs font-medium text-gray-400 hover:text-gray-600">Cancelar</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
