"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Target, Trash2, Power, Megaphone, Link2, ExternalLink } from "lucide-react";
import { Button, Card, Field, inputCls, EmptyState, Badge } from "@/components/ui";

export type Campanha = {
  id: string;
  name: string;
  channel: string;
  utmKey: string;
  active: boolean;
  adRefs: string | null; // anúncios desta campanha (links/códigos, um por linha)
  leads: number;
};

/** Anúncio que já trouxe cliente mas ainda não pertence a nenhuma campanha. */
export type AnuncioDetectado = {
  ref: string;
  clientes: number;
  ultimo: string | null;
  /**
   * Endereço ORIGINAL do anúncio. Nulo nos que foram detectados antes de o
   * sistema passar a guardar o criativo — nesses, o código não dá para virar
   * link (ele é gravado em minúsculas e o Instagram diferencia maiúsculas).
   */
  url: string | null;
  titulo: string | null;
  texto: string | null;
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

/** Quantos anúncios estão cadastrados nesta campanha. */
const refsCount = (c: { adRefs: string | null }) =>
  (c.adRefs ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length;

const channelTone: Record<string, string> = {
  INSTAGRAM: "bg-pink-50 text-pink-700 border-pink-200",
  FACEBOOK: "bg-blue-50 text-blue-700 border-blue-200",
  GOOGLE: "bg-amber-50 text-amber-700 border-amber-200",
  WHATSAPP: "bg-emerald-50 text-emerald-700 border-emerald-200",
  TIKTOK: "bg-slate-100 text-slate-700 border-slate-200",
  OUTRO: "bg-slate-100 text-slate-600 border-slate-200",
};

export function CampaignsManager({
  initial,
  anuncios = [],
}: {
  initial: Campanha[];
  anuncios?: AnuncioDetectado[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("INSTAGRAM");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [abrirRefs, setAbrirRefs] = useState<string | null>(null);
  const [refsDraft, setRefsDraft] = useState<Record<string, string>>({});

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

  /** Vincula um anúncio detectado a uma campanha (adota o histórico dele). */
  async function vincular(ref: string, campaignId: string) {
    if (!campaignId) return;
    setBusyRef(ref);
    const res = await fetch(`/api/marketing/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vincularAdRef: ref }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyRef(null);
    if (res.ok) {
      if (typeof data.adotados === "number" && data.adotados > 0) {
        alert(
          `Anúncio vinculado! ${data.adotados} cliente(s) que já tinham chegado por ele agora contam nesta campanha.`
        );
      }
      router.refresh();
    }
  }

  /** Salva a lista de anúncios de uma campanha (links ou códigos). */
  async function salvarRefs(c: Campanha, valor: string) {
    setBusyId(c.id);
    await fetch(`/api/marketing/campaigns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adRefs: valor.trim() || null }),
    });
    setBusyId(null);
    router.refresh();
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
                      {refsCount(c) > 0 && (
                        <>
                          {" · "}
                          <b className="text-slate-700 tabular-nums">{refsCount(c)}</b>{" "}
                          {refsCount(c) === 1 ? "anúncio" : "anúncios"}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAbrirRefs(abrirRefs === c.id ? null : c.id);
                        setRefsDraft((p) => ({ ...p, [c.id]: p[c.id] ?? (c.adRefs ?? "") }));
                      }}
                      title="Anúncios desta campanha"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-brand-300 hover:text-brand-700"
                    >
                      <Megaphone className="size-3.5" />
                      Anúncios
                    </button>
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

                {abrirRefs === c.id && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
                      Anúncios desta campanha
                    </p>
                    <p className="mb-2 text-[11px] leading-snug text-slate-500">
                      Cole o <b>link do post/anúncio</b> (um por linha). Quando alguém
                      chegar no WhatsApp clicando nele, a campanha é marcada sozinha.
                    </p>
                    <textarea
                      value={refsDraft[c.id] ?? ""}
                      onChange={(e) => setRefsDraft((p) => ({ ...p, [c.id]: e.target.value }))}
                      rows={3}
                      placeholder={"https://www.instagram.com/p/XXXXXXXXXX/"}
                      className={`${inputCls} font-mono text-[11px]`}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAbrirRefs(null)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500"
                      >
                        Fechar
                      </button>
                      <Button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => salvarRefs(c, refsDraft[c.id] ?? "")}
                      >
                        {busyId === c.id ? "Salvando…" : "Salvar anúncios"}
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ---- Anúncios detectados sem campanha ---- */}
      {anuncios.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Anúncios detectados</h2>
            <Badge>{anuncios.length}</Badge>
          </div>
          <Card className="p-4">
            <p className="mb-3 text-[13px] leading-snug text-slate-500">
              Clientes chegaram no WhatsApp clicando nestes anúncios, que ainda não
              pertencem a nenhuma campanha. Escolha a campanha e o histórico vai
              junto — os clientes que já vieram por ele passam a contar lá. 🎯
            </p>
            <div className="space-y-2">
              {anuncios.map((a) => (
                <div
                  key={a.ref}
                  className="flex flex-col gap-2 rounded-xl border border-slate-100 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    {/* TÍTULO DO ANÚNCIO primeiro: é assim que a lojista
                        reconhece qual é. O código curto sozinho ("dbn-u8qsqk4")
                        não diz nada para ninguém. */}
                    {a.titulo && (
                      <p className="truncate text-[13px] font-semibold text-slate-700">
                        {a.titulo}
                      </p>
                    )}
                    {/* CLICÁVEL quando temos o endereço original do anúncio.
                        O código é gravado em minúsculas e link de Instagram
                        diferencia maiúsculas — por isso o link tem de vir
                        guardado, não pode ser remontado a partir do código. */}
                    {a.url ? (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 truncate font-mono text-xs text-brand-600 hover:text-brand-700 hover:underline"
                        title="Abrir o anúncio"
                      >
                        <ExternalLink className="size-3.5 shrink-0" />
                        {a.ref}
                      </a>
                    ) : (
                      <p
                        className="flex items-center gap-1.5 truncate font-mono text-xs text-slate-700"
                        title="Este anúncio apareceu antes de o sistema passar a guardar o link"
                      >
                        <Link2 className="size-3.5 shrink-0 text-slate-400" />
                        {a.ref}
                      </p>
                    )}
                    {a.texto && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">
                        {a.texto}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      <b className="tabular-nums text-slate-700">{a.clientes}</b>{" "}
                      {a.clientes === 1 ? "cliente" : "clientes"}
                      {a.ultimo
                        ? ` · último em ${new Date(a.ultimo).toLocaleDateString("pt-BR")}`
                        : ""}
                    </p>
                  </div>
                  <select
                    defaultValue=""
                    disabled={busyRef === a.ref || initial.length === 0}
                    onChange={(e) => vincular(a.ref, e.target.value)}
                    className={`${inputCls} sm:w-56`}
                  >
                    <option value="">
                      {initial.length === 0 ? "Crie uma campanha antes" : "Vincular à campanha…"}
                    </option>
                    {initial.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
