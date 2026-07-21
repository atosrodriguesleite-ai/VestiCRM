"use client";

/**
 * Setores de atendimento (Central de Atendimento — WhatsApp).
 * A loja cria os setores (Vendas, Financeiro...), escolhe quais vendedores
 * atendem cada um, e define o setor padrão do número (para onde os chamados
 * novos entram). Config de admin/gerente.
 */

import { useEffect, useState } from "react";
import { Building2, Plus, Trash2, ChevronDown, Check, Loader2, Users } from "lucide-react";
import { Card } from "@/components/ui";

type Setor = { id: string; name: string; color: string; userIds: string[]; conversations: number };
type TeamUser = { id: string; name: string; role: string; color: string };

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"];

export function SetoresManager() {
  const [setores, setSetores] = useState<Setor[] | null>(null);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [novo, setNovo] = useState("");
  const [cor, setCor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [expand, setExpand] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/setores");
    if (r.ok) {
      const d = await r.json();
      setSetores(d.setores);
      setTeam(d.team);
      setDefaultId(d.defaultSetorId);
    } else setSetores([]);
  }
  useEffect(() => {
    void load();
  }, []);

  async function criar() {
    const name = novo.trim();
    if (!name || busy) return;
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/setores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: cor }),
    });
    setBusy(false);
    if (r.ok) {
      const d = await r.json();
      setSetores((prev) => [...(prev ?? []), d.setor]);
      setNovo("");
    } else {
      const d = await r.json().catch(() => ({}));
      setMsg(d.error ?? "Não foi possível criar.");
    }
  }

  async function apagar(s: Setor) {
    if (!window.confirm(`Apagar o setor "${s.name}"?`)) return;
    setSetores((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    if (defaultId === s.id) setDefaultId(null);
    await fetch(`/api/setores/${s.id}`, { method: "DELETE" });
  }

  async function toggleUser(s: Setor, userId: string) {
    const has = s.userIds.includes(userId);
    const userIds = has ? s.userIds.filter((u) => u !== userId) : [...s.userIds, userId];
    setSetores((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, userIds } : x)));
    await fetch(`/api/setores/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds }),
    });
  }

  async function setColor(s: Setor, color: string) {
    setSetores((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, color } : x)));
    await fetch(`/api/setores/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
  }

  async function setDefault(id: string) {
    const value = id || null;
    setDefaultId(value);
    await fetch("/api/setores", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultSetorId: value }),
    });
  }

  return (
    <Card className="p-5 mb-6">
      <div className="mb-1 flex items-center gap-2">
        <Building2 className="size-4 text-brand-600" />
        <h2 className="font-semibold">Setores de atendimento</h2>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Organize o atendimento em setores (Vendas, Financeiro, Suporte…) e escolha quais vendedores atendem cada um. O chamado que chega vai para o setor padrão do número.
      </p>

      {setores === null ? (
        <p className="flex items-center gap-2 py-4 text-sm text-gray-400"><Loader2 className="size-4 animate-spin" /> Carregando…</p>
      ) : (
        <>
          {/* setor padrão do número */}
          {setores.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
              <span className="text-xs font-medium text-gray-500">Setor padrão do número</span>
              <select
                value={defaultId ?? ""}
                onChange={(e) => setDefault(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
              >
                <option value="">— nenhum —</option>
                {setores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* lista de setores */}
          <div className="space-y-2">
            {setores.length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">
                Nenhum setor ainda. Crie o primeiro abaixo (ex.: Vendas).
              </p>
            )}
            {setores.map((s) => (
              <div key={s.id} className="rounded-xl border border-gray-100">
                <div className="flex items-center gap-2.5 p-3">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{s.name}</span>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                    <Users className="mr-1 inline size-3" />{s.userIds.length}
                  </span>
                  <button
                    onClick={() => setExpand(expand === s.id ? null : s.id)}
                    className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100"
                    title="Vendedores e cor"
                  >
                    <ChevronDown className={`size-4 transition ${expand === s.id ? "rotate-180" : ""}`} />
                  </button>
                  <button onClick={() => apagar(s)} className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-500" title="Apagar">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {expand === s.id && (
                  <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-3">
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium text-gray-500">Cor</p>
                      <div className="flex flex-wrap gap-1.5">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setColor(s, c)}
                            className={`size-6 rounded-full border-2 transition ${s.color === c ? "border-gray-800" : "border-transparent"}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium text-gray-500">Vendedores deste setor</p>
                      <div className="flex flex-wrap gap-1.5">
                        {team.map((u) => {
                          const on = s.userIds.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              onClick={() => toggleUser(s, u.id)}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                                on ? "border-brand-400 bg-brand-50 font-medium text-brand-700" : "border-gray-200 text-gray-500 hover:border-gray-300"
                              }`}
                            >
                              {on && <Check className="size-3" />}
                              {u.name.split(" ")[0]}
                            </button>
                          );
                        })}
                        {team.length === 0 && <span className="text-xs text-gray-400">Nenhum vendedor cadastrado.</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* criar setor */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1">
              {COLORS.slice(0, 5).map((c) => (
                <button key={c} onClick={() => setCor(c)} className={`size-5 rounded-full border-2 ${cor === c ? "border-gray-800" : "border-transparent"}`} style={{ background: c }} />
              ))}
            </span>
            <input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="Novo setor (ex.: Vendas, Financeiro)"
              maxLength={40}
              className="min-w-44 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
            <button
              onClick={criar}
              disabled={busy || !novo.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Plus className="size-4" /> Criar setor
            </button>
          </div>
          {msg && <p className="mt-2 text-xs font-medium text-rose-600">{msg}</p>}
        </>
      )}
    </Card>
  );
}
