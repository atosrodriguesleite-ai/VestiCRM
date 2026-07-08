"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus, QrCode, Store, X } from "lucide-react";
import { brl } from "@/lib/format";
import { Card, Badge, EmptyState } from "@/components/ui";

type Campaign = {
  id: string;
  name: string;
  slug: string;
  channel: string;
  clicks: number;
  orders: number;
  revenue: number;
  active: boolean;
};

const CHANNELS = [
  ["campanha", "Campanha"], ["instagram", "Instagram"], ["facebook", "Facebook"],
  ["google", "Google"], ["google-meu-negocio", "Google Meu Negócio"],
  ["whatsapp", "WhatsApp"], ["qr", "QR Code"], ["loja-fisica", "Loja Física"],
  ["marketplace", "Marketplace"], ["tiktok", "TikTok"],
];

// QR Codes prontos para a loja física
const STORE_QRS = [
  { slug: "qr-vitrine", name: "QR da Vitrine" },
  { slug: "qr-balcao", name: "QR do Balcão" },
  { slug: "qr-provador", name: "QR do Provador" },
  { slug: "qr-caixa", name: "QR do Caixa" },
];

function baseUrl() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function LinksManager({
  slug,
  team,
  campaigns,
}: {
  slug: string;
  team: { id: string; name: string }[];
  campaigns: Campaign[];
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [qrFor, setQrFor] = useState<{ url: string; label: string } | null>(null);
  const [copied, setCopied] = useState("");

  const linkFor = (ref: string) => `${baseUrl()}/c/${slug}?ref=${ref}`;
  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <>
      {/* Links por vendedor */}
      <Card className="p-5 mb-4">
        <h3 className="font-semibold text-sm mb-1">Links dos vendedores</h3>
        <p className="text-xs text-gray-500 mb-4">
          Cada vendedor tem seu link. Os acessos e vendas caem no ranking dele
          automaticamente.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {team.map((u) => {
            const ref = u.name
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .split(/\s+/)[0];
            const url = linkFor(ref);
            return (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{u.name.split(" ")[0]}</p>
                  <p className="text-[10px] text-gray-400 font-mono truncate">/c/{slug}?ref={ref}</p>
                </div>
                <button
                  onClick={() => copy(url)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                  title="Copiar link"
                >
                  {copied === url ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                </button>
                <button
                  onClick={() => setQrFor({ url, label: `Link ${u.name.split(" ")[0]}` })}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                  title="QR Code"
                >
                  <QrCode className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Loja física */}
      <Card className="p-5 mb-4">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
          <Store className="size-4 text-brand-600" />
          QR Codes da loja física
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Imprima e cole na vitrine, balcão, provador e caixa. Depois descubra
          qual ponto converte mais.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STORE_QRS.map((q) => (
            <button
              key={q.slug}
              onClick={() => setQrFor({ url: linkFor(q.slug), label: q.name })}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-100 hover:border-brand-300 hover:bg-brand-50 py-3 transition"
            >
              <QrCode className="size-6 text-brand-600" />
              <span className="text-xs font-medium">{q.name}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Campanhas */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Campanhas</h3>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-2 transition"
          >
            <Plus className="size-3.5" />
            Nova campanha
          </button>
        </div>
        {campaigns.length === 0 ? (
          <EmptyState title="Nenhuma campanha ainda" hint="Crie uma campanha para gerar link, UTM e QR Code." />
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => {
              const url = linkFor(c.slug);
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate flex items-center gap-2">
                      {c.name}
                      {!c.active && <Badge color="#94a3b8">inativa</Badge>}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono truncate">/c/{slug}?ref={c.slug}</p>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs font-semibold tabular-nums">{c.clicks} cliques · {c.orders} pedidos</p>
                    <p className="text-[11px] text-emerald-600 tabular-nums">{brl(c.revenue)}</p>
                  </div>
                  <button onClick={() => copy(url)} className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50" title="Copiar">
                    {copied === url ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                  </button>
                  <button onClick={() => setQrFor({ url, label: c.name })} className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50" title="QR Code">
                    <QrCode className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modal QR */}
      {qrFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setQrFor(null)} />
          <div className="relative bg-white rounded-2xl shadow-pop p-6 w-full max-w-xs text-center animate-fade-up">
            <button onClick={() => setQrFor(null)} className="absolute top-3 right-3 text-gray-400 p-1">
              <X className="size-5" />
            </button>
            <p className="font-semibold mb-3">{qrFor.label}</p>
            <img
              src={`/api/qrcode?url=${encodeURIComponent(qrFor.url)}`}
              alt="QR Code"
              className="w-full rounded-xl border border-gray-100"
            />
            <p className="text-[10px] text-gray-400 font-mono mt-3 break-all">{qrFor.url}</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => copy(qrFor.url)}
                className="flex-1 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium py-2 hover:border-brand-300 transition"
              >
                {copied === qrFor.url ? "Copiado!" : "Copiar link"}
              </button>
              <a
                href={`/api/qrcode?url=${encodeURIComponent(qrFor.url)}`}
                download={`qr-${qrFor.label}.svg`}
                className="flex-1 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium py-2 transition"
              >
                Baixar QR
              </a>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <NewCampaignModal
          team={team}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function NewCampaignModal({
  team,
  onClose,
  onCreated,
}: {
  team: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [channel, setChannel] = useState("campanha");
  const [ownerId, setOwnerId] = useState("");
  const [goal, setGoal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const autoSlug = (v: string) =>
    v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  async function submit() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/track-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        slug: slug || autoSlug(name),
        channel,
        ownerId: ownerId || null,
        goal: parseFloat(goal.replace(",", ".")) || 0,
      }),
    });
    setSaving(false);
    if (res.ok) onCreated();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Erro ao criar");
    }
  }

  const input = "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">Nova campanha</h3>
          <button onClick={onClose} className="text-gray-400 p-1"><X className="size-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className={label}>Nome</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setSlug(autoSlug(e.target.value)); }}
              className={input}
              placeholder="Ex.: Campanha Verão"
            />
          </div>
          <div>
            <label className={label}>Ref (aparece no link)</label>
            <input value={slug} onChange={(e) => setSlug(autoSlug(e.target.value))} className={`${input} font-mono`} placeholder="campanha-verao" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Canal</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${input} bg-white`}>
                {CHANNELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Responsável</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={`${input} bg-white`}>
                <option value="">Loja</option>
                {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={label}>Meta de faturamento (R$)</label>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} className={input} placeholder="0,00" inputMode="decimal" />
          </div>
          {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}
          <button
            onClick={submit}
            disabled={saving || !name}
            className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
          >
            {saving ? "Criando..." : "Criar campanha + QR Code"}
          </button>
        </div>
      </div>
    </div>
  );
}
