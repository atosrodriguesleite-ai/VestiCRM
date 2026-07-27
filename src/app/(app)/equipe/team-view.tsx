"use client";

import { useRef, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { Plus, X, ShieldCheck, Camera } from "lucide-react";
import { brl, roleLabel } from "@/lib/format";
import { fileToDataUrl } from "@/lib/upload";
import { Card, Avatar, Badge } from "@/components/ui";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: string;
  color: string;
  avatarUrl: string | null;
  active: boolean;
  customers: number;
  conversations: number;
  pendingTasks: number;
  sales30: number;
  monthlyGoal: number;
  isMe: boolean;
};

const roleColor: Record<string, string> = {
  ADMIN: "#c4622d",
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
  const [transferFrom, setTransferFrom] = useState<TeamMember | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // foto do novo usuário (opcional) — data-URL já redimensionada
  const [newPhoto, setNewPhoto] = useState<string | null>(null);
  const newPhotoRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);

  // troca a foto de um usuário já cadastrado (abre o seletor de arquivo)
  function pickPhoto(m: TeamMember) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      setPhotoBusy(m.id);
      const dataUrl = await fileToDataUrl(f, 256, 0.85);
      await fetch(`/api/team/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      });
      setPhotoBusy(null);
      router.refresh();
    };
    inp.click();
  }

  async function removePhoto(m: TeamMember) {
    setPhotoBusy(m.id);
    await fetch(`/api/team/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: null }),
    });
    setPhotoBusy(null);
    router.refresh();
  }

  async function saveGoal(m: TeamMember, value: string) {
    const goal = parseFloat(value.replace(/\./g, "").replace(",", ".")) || 0;
    if (goal === m.monthlyGoal) return;
    await fetch(`/api/team/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyGoal: goal }),
    });
    router.refresh();
  }

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

  async function changeRole(m: TeamMember, role: string) {
    if (role === m.role) return;
    const res = await fetch(`/api/team/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) router.refresh();
    else window.alert("Não foi possível alterar o papel.");
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
        ...(newPhoto ? { avatarUrl: newPhoto } : {}),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setShowNew(false);
      setNewPhoto(null);
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {members.map((m) => (
          <Card
            key={m.id}
            className={`p-5 ${!m.active ? "opacity-60" : ""}`}
          >
            <div className="flex items-start gap-3">
              {canManage ? (
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => pickPhoto(m)}
                    disabled={photoBusy === m.id}
                    title="Trocar foto"
                    className="group relative rounded-full disabled:opacity-60"
                  >
                    <Avatar name={m.name} color={m.color} src={m.avatarUrl} size="lg" />
                    <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 max-md:opacity-100 max-md:bg-black/25 group-hover:opacity-100 transition flex items-center justify-center">
                      <Camera className="size-4 text-white" />
                    </span>
                  </button>
                  {m.avatarUrl && (
                    <button
                      type="button"
                      onClick={() => removePhoto(m)}
                      disabled={photoBusy === m.id}
                      className="text-[10px] text-gray-400 hover:text-rose-500"
                    >
                      remover
                    </button>
                  )}
                </div>
              ) : (
                <Avatar name={m.name} color={m.color} src={m.avatarUrl} size="lg" />
              )}
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
                <div className="flex items-center gap-1.5 mt-1.5">
                  {canManage && !m.isMe ? (
                    // o dono/admin muda o papel direto aqui
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-300 cursor-pointer"
                      style={{ color: roleColor[m.role] ?? "#64748b" }}
                    >
                      <option value="SELLER">Vendedor(a)</option>
                      <option value="MANAGER">Gerente</option>
                      <option value="ADMIN">Administrador</option>
                      <option value="SUPPORT">Suporte</option>
                    </select>
                  ) : (
                    <Badge color={roleColor[m.role] ?? "#64748b"}>
                      {roleLabel[m.role as keyof typeof roleLabel]}
                    </Badge>
                  )}
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
                  <button
                    onClick={() => setTransferFrom(m)}
                    className="text-xs font-medium text-gray-400 hover:text-brand-600 rounded-lg px-2.5 py-1 transition"
                    title="Passar clientes, negociações, tarefas e conversas em aberto para outro vendedor"
                  >
                    Transferir carteira
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
            {/* meta mensal: barra de progresso + edição pelo admin */}
            <div className="mt-3 pt-3 border-t border-gray-50">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.1em] text-gray-400">
                  Meta do mês
                </p>
                {canManage ? (
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    R$
                    <input
                      defaultValue={m.monthlyGoal ? m.monthlyGoal.toLocaleString("pt-BR") : ""}
                      onBlur={(e) => saveGoal(m, e.target.value)}
                      placeholder="sem meta"
                      inputMode="decimal"
                      className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs text-right bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
                    />
                  </span>
                ) : (
                  <span className="text-xs text-gray-500">
                    {m.monthlyGoal ? brl(m.monthlyGoal) : "sem meta"}
                  </span>
                )}
              </div>
              {m.monthlyGoal > 0 && (
                <>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${m.sales30 >= m.monthlyGoal ? "bg-emerald-500" : "bg-brand-500"}`}
                      style={{ width: `${Math.min(100, (m.sales30 / m.monthlyGoal) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {brl(m.sales30)} de {brl(m.monthlyGoal)} ·{" "}
                    {Math.round((m.sales30 / m.monthlyGoal) * 100)}%
                  </p>
                </>
              )}
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

      {transferFrom && (
        <TransferModal
          from={transferFrom}
          members={members}
          onClose={() => setTransferFrom(null)}
          onDone={() => {
            setTransferFrom(null);
            router.refresh();
          }}
        />
      )}

      {showNew && (
        <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => newPhotoRef.current?.click()}
                  className="group relative rounded-full shrink-0"
                  title="Adicionar foto"
                >
                  <Avatar name="?" src={newPhoto} size="lg" color="#c99b5f" />
                  <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 max-md:opacity-100 max-md:bg-black/25 group-hover:opacity-100 transition flex items-center justify-center">
                    <Camera className="size-4 text-white" />
                  </span>
                </button>
                <input
                  ref={newPhotoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setNewPhoto(await fileToDataUrl(f, 256, 0.85));
                  }}
                />
                <div className="text-xs text-gray-500">
                  <p className="font-medium text-gray-700">Foto (opcional)</p>
                  <p>Clique no círculo para escolher. Sem foto, usamos as iniciais.</p>
                  <p className="mt-0.5">📐 Ideal: <b>400 × 400 px</b> (quadrada).</p>
                  {newPhoto && (
                    <button
                      type="button"
                      onClick={() => setNewPhoto(null)}
                      className="text-[11px] text-gray-400 hover:text-rose-500 mt-0.5"
                    >
                      remover
                    </button>
                  )}
                </div>
              </div>
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
                    <option value="SUPPORT">Suporte</option>
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
        </div></Portal>
      )}
    </>
  );
}

/**
 * Transferir carteira: passa clientes, negociações abertas, tarefas pendentes
 * e conversas do membro para outro vendedor — ou redistribui no rodízio.
 * Histórico (vendas, comissões, pedidos) fica com quem fez.
 */
function TransferModal({
  from,
  members,
  onClose,
  onDone,
}: {
  from: TeamMember;
  members: TeamMember[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [dest, setDest] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);

  const destinos = members.filter(
    (m) => m.id !== from.id && m.active && m.role !== "SUPERADMIN"
  );

  async function transferir() {
    setBusy(true);
    setErro("");
    const res = await fetch(`/api/team/${from.id}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: dest || null }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setResultado(
        `Transferido: ${d.clientes} cliente${d.clientes === 1 ? "" : "s"}, ` +
          `${d.negociacoes} negociação(ões) aberta(s), ${d.tarefas} tarefa(s) pendente(s) ` +
          `e ${d.conversas} conversa(s)` +
          (dest ? "." : ` — redistribuídos entre ${d.destinos} vendedor(es) ativo(s).`)
      );
    } else setErro(d.error ?? "Não foi possível transferir.");
  }

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up">
        <h3 className="font-semibold text-lg mb-1">Transferir carteira</h3>
        <p className="text-sm text-gray-500 mb-4">
          Tudo que está <b>em aberto</b> no nome de <b>{from.name}</b> (clientes,
          negociações, tarefas e conversas) muda de responsável. O histórico de
          vendas e comissões fica com {from.name.split(" ")[0]}.
        </p>

        {resultado ? (
          <>
            <p className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5 mb-4">
              ✅ {resultado}
            </p>
            <button
              onClick={onDone}
              className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition"
            >
              Concluir
            </button>
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Para quem vai a carteira?
            </label>
            <select
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-brand-400 mb-4"
            >
              <option value="">
                Redistribuir entre os vendedores ativos (rodízio)
              </option>
              {destinos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {erro && (
              <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-3">{erro}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium py-2.5 transition"
              >
                Cancelar
              </button>
              <button
                onClick={transferir}
                disabled={busy}
                className="flex-1 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-60"
              >
                {busy ? "Transferindo…" : "Transferir agora"}
              </button>
            </div>
          </>
        )}
      </div>
    </div></Portal>
  );
}
