"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ShieldCheck } from "lucide-react";
import { brl, roleLabel } from "@/lib/format";
import { Card, Avatar, Badge } from "@/components/ui";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: string;
  color: string;
  active: boolean;
  customers: number;
  conversations: number;
  pendingTasks: number;
  sales30: number;
  isMe: boolean;
};

const roleColor: Record<string, string> = {
  ADMIN: "#6d28ff",
  MANAGER: "#0ea5e9",
  SELLER: "#f59e0b",
  SUPPORT: "#10b981",
};

export function TeamView({
  members,
  canManage,
}: {
  members: TeamMember[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function resetPassword(m: TeamMember) {
    const nova = window.prompt(`Nova senha para ${m.name} (mín. 6 caracteres):`);
    if (!nova) return;
    if (nova.length < 6) return window.alert("A senha precisa de pelo menos 6 caracteres.");
    const res = await fetch(`/api/team/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: nova }),
    });
    window.alert(res.ok ? "Senha redefinida. Informe ao usuário." : "Não foi possível redefinir.");
  }

  async function toggleActive(m: TeamMember) {
    const res = await fetch(`/api/team/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !m.active }),
    });
    if (res.ok) router.refresh();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        login: fd.get("login"),
        password: fd.get("password"),
        role: fd.get("role"),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setShowNew(false);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar usuário");
    }
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <>
      {canManage && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
          >
            <Plus className="size-4" />
            Novo usuário
          </button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {members.map((m) => (
          <Card
            key={m.id}
            className={`p-5 ${!m.active ? "opacity-60" : ""}`}
          >
            <div className="flex items-start gap-3">
              <Avatar name={m.name} color={m.color} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">
                  {m.name}
                  {m.isMe && (
                    <span className="text-xs text-gray-400 font-normal">
                      {" "}
                      (você)
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {m.username ?? m.email}
                </p>
                <div className="flex gap-1.5 mt-1.5">
                  <Badge color={roleColor[m.role] ?? "#64748b"}>
                    {roleLabel[m.role as keyof typeof roleLabel]}
                  </Badge>
                  {!m.active && <Badge color="#94a3b8">Desativado</Badge>}
                </div>
              </div>
              {canManage && !m.isMe && (
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={() => toggleActive(m)}
                    className={`text-xs font-medium rounded-lg px-2.5 py-1.5 transition ${
                      m.active
                        ? "text-rose-600 hover:bg-rose-50"
                        : "text-emerald-600 hover:bg-emerald-50"
                    }`}
                  >
                    {m.active ? "Desativar" : "Reativar"}
                  </button>
                  <button
                    onClick={() => resetPassword(m)}
                    className="text-xs font-medium text-gray-400 hover:text-brand-600 rounded-lg px-2.5 py-1 transition"
                  >
                    Redefinir senha
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-gray-50 text-center">
              <div>
                <p className="text-sm font-semibold tabular-nums">
                  {m.customers}
                </p>
                <p className="text-[10px] text-gray-400">clientes</p>
              </div>
              <div>
                <p className="text-sm font-semibold tabular-nums">
                  {m.conversations}
                </p>
                <p className="text-[10px] text-gray-400">conversas</p>
              </div>
              <div>
                <p className="text-sm font-semibold tabular-nums">
                  {m.pendingTasks}
                </p>
                <p className="text-[10px] text-gray-400">tarefas</p>
              </div>
              <div>
                <p className="text-sm font-semibold tabular-nums text-emerald-600">
                  {brl(m.sales30)}
                </p>
                <p className="text-[10px] text-gray-400">vendas 30d</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4 mt-6 flex items-start gap-3">
        <ShieldCheck className="size-5 text-brand-600 shrink-0 mt-0.5" />
        <div className="text-xs text-gray-500 leading-relaxed">
          <p className="font-semibold text-gray-700 mb-0.5">
            Permissões por papel
          </p>
          <p>
            <strong>Administrador</strong>: visão geral + gerencia equipe,
            produtos e configurações · <strong>Gerente</strong>: visão geral
            (dashboard da loja, relatórios e inteligência) ·{" "}
            <strong>Vendedor(a)</strong>: vê apenas os próprios clientes,
            pedidos e números — sem relatórios da loja ·{" "}
            <strong>Atendimento</strong>: central de WhatsApp e tarefas.
            Cada loja acessa somente os próprios dados.
          </p>
        </div>
      </Card>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30 animate-fade-in"
            onClick={() => setShowNew(false)}
          />
          <form
            onSubmit={submit}
            className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-lg">Novo usuário</h3>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="text-gray-400 p-1"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={label}>Nome *</label>
                <input name="name" required className={input} />
              </div>
              <div>
                <label className={label}>Login de acesso *</label>
                <input
                  name="login"
                  required
                  className={input}
                  placeholder="ex.: maria  (ou um e-mail)"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Pode ser um nome simples (sem e-mail) — é com ele que a pessoa entra no sistema.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Senha *</label>
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={6}
                    className={input}
                  />
                </div>
                <div>
                  <label className={label}>Papel</label>
                  <select name="role" defaultValue="SELLER" className={`${input} bg-white`}>
                    <option value="SELLER">Vendedor(a) — só o que é dele</option>
                    <option value="MANAGER">Gerente — visão geral</option>
                    <option value="ADMIN">Administrador — total</option>
                    <option value="SUPPORT">Atendimento</option>
                  </select>
                </div>
              </div>
              {error && (
                <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <button
                disabled={saving}
                className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
              >
                {saving ? "Criando..." : "Criar usuário"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
