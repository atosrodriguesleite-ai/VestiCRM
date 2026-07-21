"use client";

/**
 * Afiliados — cadastro, link de divulgação e acompanhamento.
 * O link é copiado pronto; leads/fechados vêm da atribuição automática.
 * Valores de comissão ficam nas observações (negociação caso a caso).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, Plus, X, Pencil, Users, Trophy, Link2 } from "lucide-react";
import { Card, Badge, EmptyState } from "@/components/ui";
import { dateShort } from "@/lib/format";

export type AffiliateRow = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  pixKey: string | null;
  notes: string | null;
  active: boolean;
  leads: number;
  won: number;
  recent: { id: string; name: string; createdAt: string; won: boolean }[];
};

const inputCls =
  "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 bg-white";

export function AffiliatesView({
  initial,
  siteUrl,
}: {
  initial: AffiliateRow[];
  siteUrl: string;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "new" | AffiliateRow>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const linkFor = (slug: string) =>
    `${siteUrl}/?utm_source=afiliado&utm_medium=indicacao&utm_campaign=${slug}`;

  async function copy(slug: string) {
    await navigator.clipboard.writeText(linkFor(slug));
    setCopied(slug);
    setTimeout(() => setCopied(null), 1500);
  }

  async function toggleActive(a: AffiliateRow) {
    await fetch(`/api/affiliates/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !a.active }),
    });
    router.refresh();
  }

  const totals = initial.reduce(
    (s, a) => ({ leads: s.leads + a.leads, won: s.won + a.won }),
    { leads: 0, won: 0 }
  );

  return (
    <>
      {/* resumo */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card className="p-4">
          <p className="font-mono text-[10px] font-semibold text-slate-400 uppercase tracking-[0.1em]">Afiliados</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">{initial.length}</p>
        </Card>
        <Card className="p-4">
          <p className="font-mono text-[10px] font-semibold text-slate-400 uppercase tracking-[0.1em]">Leads trazidos</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">{totals.leads}</p>
        </Card>
        <Card className="p-4">
          <p className="font-mono text-[10px] font-semibold text-slate-400 uppercase tracking-[0.1em]">Fechados</p>
          <p className="text-2xl font-semibold tabular-nums mt-1 text-emerald-600">{totals.won}</p>
        </Card>
      </div>

      <div className="flex justify-end mb-3">
        <button
          onClick={() => setModal("new")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
        >
          <Plus className="size-4" /> Novo afiliado
        </button>
      </div>

      {initial.length === 0 ? (
        <Card className="p-10">
          <EmptyState title="Nenhum afiliado ainda" />
          <p className="text-center text-sm text-gray-400 -mt-2">
            Cadastre alguém e envie o link de divulgação dele.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {initial.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{a.name}</p>
                    {!a.active && <Badge color="#94a3b8">pausado</Badge>}
                    {a.phone && (
                      <span className="text-xs text-gray-400">{a.phone}</span>
                    )}
                  </div>
                  {/* link de divulgação */}
                  <button
                    onClick={() => copy(a.slug)}
                    title="Copiar link"
                    className="mt-1.5 inline-flex items-center gap-1.5 max-w-full rounded-lg bg-gray-50 border border-gray-100 hover:border-brand-300 px-2.5 py-1.5 text-xs text-gray-600 transition"
                  >
                    <Link2 className="size-3.5 shrink-0 text-brand-500" />
                    <span className="truncate">{linkFor(a.slug)}</span>
                    {copied === a.slug ? (
                      <Check className="size-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <Copy className="size-3.5 shrink-0 text-gray-400" />
                    )}
                  </button>
                  {a.pixKey && (
                    <p className="text-xs text-gray-400 mt-1.5">PIX: {a.pixKey}</p>
                  )}
                  {a.notes && (
                    <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">
                      {a.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <button
                    onClick={() => setOpen(open === a.id ? null : a.id)}
                    className="text-center"
                    title="Ver leads"
                  >
                    <p className="flex items-center gap-1 text-lg font-semibold tabular-nums justify-center">
                      <Users className="size-4 text-brand-500" /> {a.leads}
                    </p>
                    <p className="text-[10px] text-gray-400">leads</p>
                  </button>
                  <div className="text-center">
                    <p className="flex items-center gap-1 text-lg font-semibold tabular-nums text-emerald-600 justify-center">
                      <Trophy className="size-4" /> {a.won}
                    </p>
                    <p className="text-[10px] text-gray-400">fechados</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => setModal(a)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                      title="Editar"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => toggleActive(a)}
                      className={`text-[10px] font-medium rounded-lg px-2 py-1 transition ${
                        a.active
                          ? "text-gray-400 hover:bg-gray-100"
                          : "text-emerald-600 bg-emerald-50"
                      }`}
                    >
                      {a.active ? "pausar" : "ativar"}
                    </button>
                  </div>
                </div>
              </div>

              {/* leads recentes */}
              {open === a.id && (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  {a.recent.length === 0 ? (
                    <p className="text-xs text-gray-400">
                      Nenhum lead ainda — divulgue o link acima.
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-50">
                      {a.recent.map((l) => (
                        <li key={l.id} className="py-1.5 flex items-center gap-2 text-sm">
                          <Link
                            href={`/clientes/${l.id}`}
                            className="font-medium hover:text-brand-600 truncate"
                          >
                            {l.name}
                          </Link>
                          {l.won && <Badge color="#059669">fechado</Badge>}
                          <span className="ml-auto text-xs text-gray-400 shrink-0">
                            {dateShort(l.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <AffiliateModal
          affiliate={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function AffiliateModal({
  affiliate,
  onClose,
  onSaved,
}: {
  affiliate: AffiliateRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(affiliate?.name ?? "");
  const [slug, setSlug] = useState(affiliate?.slug ?? "");
  const [phone, setPhone] = useState(affiliate?.phone ?? "");
  const [pixKey, setPixKey] = useState(affiliate?.pixKey ?? "");
  const [notes, setNotes] = useState(affiliate?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = affiliate
      ? await fetch(`/api/affiliates/${affiliate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, phone, pixKey, notes }),
        })
      : await fetch("/api/affiliates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, slug, phone, pixKey, notes }),
        });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Não foi possível salvar.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">
            {affiliate ? "Editar afiliado" : "Novo afiliado"}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Nome *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Ex.: João da Silva" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Código do link *{" "}
              <span className="text-xs font-normal text-gray-400">
                (vai na URL — não dá para mudar depois)
              </span>
            </label>
            <input
              required
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }
              disabled={!!affiliate}
              className={`${inputCls} disabled:opacity-60 font-mono`}
              placeholder="ex.: joao"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1.5">WhatsApp</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="(33) 9..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Chave PIX</label>
              <input value={pixKey} onChange={(e) => setPixKey(e.target.value)} className={inputCls} placeholder="para pagar a comissão" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Acordo / observações
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder="Ex.: R$ 200 por loja fechada + 10% da implantação — negociado em 07/2026"
            />
          </div>
          {error && (
            <p className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            disabled={saving}
            className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
          >
            {saving ? "Salvando..." : affiliate ? "Salvar" : "Criar afiliado"}
          </button>
        </div>
      </form>
    </div>
  );
}
