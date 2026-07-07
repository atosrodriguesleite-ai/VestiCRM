"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui";

/** Personalização do catálogo público (nome, frase, WhatsApp, mínimo). */
export function CatalogSettings({
  slug,
  initial,
  canEdit,
}: {
  slug: string;
  initial: { name: string; tagline: string; whatsapp: string; minOrder: number };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    tagline: initial.tagline,
    whatsapp: initial.whatsapp,
    minOrder: String(initial.minOrder),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/catalogo/${slug}`
    : `/catalogo/${slug}`;

  async function save() {
    setSaving(true);
    const res = await fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        tagline: form.tagline || null,
        whatsapp: form.whatsapp || null,
        minOrder: parseInt(form.minOrder) || 0,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    }
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition disabled:bg-gray-50 disabled:text-gray-400";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <Card className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between mb-4">
        <p className="text-sm text-gray-500">
          Link para compartilhar com clientes — atualiza na hora quando você
          edita produtos, fotos, preços e estoque.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => {
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition"
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado!" : "Copiar link"}
          </button>
          <a
            href={`/catalogo/${slug}`}
            target="_blank"
            className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-2 transition"
          >
            <ExternalLink className="size-3.5" />
            Abrir catálogo
          </a>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Nome da loja</label>
          <input
            disabled={!canEdit}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={input}
          />
        </div>
        <div>
          <label className={label}>WhatsApp de pedidos (DDI+DDD)</label>
          <input
            disabled={!canEdit}
            value={form.whatsapp}
            onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
            className={input}
            placeholder="5511999998888"
            inputMode="tel"
          />
        </div>
        <div>
          <label className={label}>Frase de apresentação</label>
          <input
            disabled={!canEdit}
            value={form.tagline}
            onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
            className={input}
            placeholder="Selecione os modelos e finalize pelo WhatsApp."
          />
        </div>
        <div>
          <label className={label}>Pedido mínimo (peças, 0 = sem mínimo)</label>
          <input
            disabled={!canEdit}
            value={form.minOrder}
            onChange={(e) =>
              setForm((f) => ({ ...f, minOrder: e.target.value.replace(/\D/g, "") }))
            }
            className={input}
            inputMode="numeric"
          />
        </div>
      </div>

      {canEdit && (
        <button
          onClick={save}
          disabled={saving}
          className="mt-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60"
        >
          {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar catálogo"}
        </button>
      )}
    </Card>
  );
}
