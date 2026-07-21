"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target, Trash2, Power } from "lucide-react";
import { Button, Card, Field, inputCls, EmptyState, Badge } from "@/components/ui";

export type Campanha = {
  id: string;
  name: string;
  channel: string;
  utmKey: string;
  active: boolean;
  leads: number;
};

const CHANNELS: { value: string; label: string }[] = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "GOOGLE", label: "Google" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "OUTRO", label: "Outro" },
];
const channelLabel = (v: string) => CHANNELS.find((c) => c.value === v)?.label ?? v;

const channelTone: Record<string, string> = {
  INSTAGRAM: "bg-pink-50 text-pink-700 border-pink-200",
  FACEBOOK: "bg-blue-50 text-blue-700 border-blue-200",
  GOOGLE: "bg-amber-50 text-amber-700 border-amber-200",
  WHATSAPP: "bg-emerald-50 text-emerald-700 border-emerald-200",
  TIKTOK: "bg-slate-100 text-slate-700 border-slate-200",
  OUTRO: "bg-slate-100 text-slate-600 border-slate-200",
};

export function CampaignsManager({ initial }: { initial: Campanha[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("INSTAGRAM");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2 || saving) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/marketing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), channel }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setName("");
      router.refresh();
    } else {
      setError(data.error ?? "Não foi possível criar a campanha.");
    }
  }

  async function toggle(c: Campanha) {
    setBusyId(c.id);
    const res = await fetch(`/api/marketing/campaigns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    setBusyId(null);
    if (res.ok) router.refresh();
  }

  async function remove(c: Campanha) {
    if (
      !window.confirm(
        `Apagar a campanha "${c.name}"?${c.leads > 0 ? `\nOs ${c.leads} leads dela continuam no sistema, só perdem a etiqueta de campanha.` : ""}`
      )
    )
      return;
    setBusyId(c.id);
    const res = await fetch(`/api/marketing/campaigns/${c.id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* nova campanha */}
      <Card className="p-5">
        <form onSubmit={create} className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <Target className="size-5" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">Nova campanha</h3>
              <p className="text-xs text-slate-500">
                Ex.: “Inverno 2026”, “Promo Frete Grátis”. Depois é só o vendedor escolher ela ao cadastrar o lead.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <Field label="Nome da campanha">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Inverno 2026"
              />
            </Field>
            <Field label="Canal">
              <select className={`${inputCls} sm:w-40`} value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={saving || name.trim().length < 2} className="w-full sm:w-auto">
                <Plus className="size-4" />
                {saving ? "Criando…" : "Criar"}
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>
      </Card>

      {/* lista */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Campanhas</h2>
          <Badge>{initial.length}</Badge>
        </div>
        {initial.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Target />}
              title="Nenhuma campanha ainda"
              hint="Cadastre a primeira campanha acima para começar a medir de onde vêm seus leads."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {initial.map((c) => (
              <Card key={c.id} className={`p-4 ${c.active ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-slate-900">{c.name}</p>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${channelTone[c.channel] ?? channelTone.OUTRO}`}
                      >
                        {channelLabel(c.channel)}
                      </span>
                      {!c.active && (
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          pausada
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] text-slate-500">
                      <b className="text-slate-700 tabular-nums">{c.leads}</b> {c.leads === 1 ? "lead" : "leads"} atribuídos
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      disabled={busyId === c.id}
                      title={c.active ? "Pausar campanha" : "Reativar campanha"}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        c.active
                          ? "border-slate-200 text-slate-500 hover:border-slate-300"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      }`}
                    >
                      <Power className="size-3.5" />
                      {c.active ? "Pausar" : "Reativar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      disabled={busyId === c.id}
                      title="Apagar"
                      className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
