"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui";

/** Personalização do catálogo público (nome, frase, WhatsApp, mínimo). */
export function CatalogSettings({
  slug,
  catalogDomain,
  initial,
  canEdit,
}: {
  slug: string;
  catalogDomain: string | null;
  initial: {
    name: string;
    tagline: string;
    whatsapp: string;
    minOrder: number;
    minOrderMode: "NONE" | "PECAS" | "VALOR";
    minOrderValue: number;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: initial.name,
    tagline: initial.tagline,
    whatsapp: initial.whatsapp,
    minOrderMode: initial.minOrderMode,
    minOrder: String(initial.minOrder),
    minOrderValue: initial.minOrderValue ? String(initial.minOrderValue) : "",
  });
  const [slugForm, setSlugForm] = useState(slug);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  // Link público: usa o domínio de catálogos quando configurado (ex.:
  // catalago.net/toque-leve); senão, o endereço atual /catalogo/slug.
  const url = catalogDomain
    ? `https://${catalogDomain}/${slug}`
    : typeof window !== "undefined"
      ? `${window.location.origin}/catalogo/${slug}`
      : `/catalogo/${slug}`;

  async function save() {
    setSaving(true);
    setError("");
    const slugChanged = slugForm.trim() !== slug;
    if (
      slugChanged &&
      !window.confirm(
        "Mudar o endereço do catálogo faz os LINKS ANTIGOS pararem de funcionar (mensagens já enviadas, QR codes impressos). Continuar?"
      )
    ) {
      setSaving(false);
      setSlugForm(slug);
      return;
    }
    const res = await fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        ...(slugChanged ? { slug: slugForm.trim() } : {}),
        tagline: form.tagline || null,
        whatsapp: form.whatsapp || null,
        minOrderMode: form.minOrderMode,
        minOrder: form.minOrderMode === "PECAS" ? parseInt(form.minOrder) || 0 : 0,
        minOrderValue:
          form.minOrderMode === "VALOR"
            ? parseFloat(form.minOrderValue.replace(",", ".")) || 0
            : 0,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.slug) setSlugForm(data.slug);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível salvar.");
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
            href={url}
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
          <label className={label}>Endereço do catálogo</label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 shrink-0">
              {catalogDomain ?? "/catalogo"}/
            </span>
            <input
              disabled={!canEdit}
              value={slugForm}
              onChange={(e) => setSlugForm(e.target.value)}
              className={input}
              placeholder="minha-loja"
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400 leading-snug">
            Mudou o nome da loja? Ajuste aqui também. Atenção: links já
            enviados e QR codes impressos param de funcionar.
          </p>
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
        <div className="sm:col-span-2">
          <label className={label}>Pedido mínimo para enviar no WhatsApp</label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["NONE", "Sem trava"],
                ["PECAS", "Por peças"],
                ["VALOR", "Por valor"],
              ] as const
            ).map(([mode, txt]) => (
              <button
                key={mode}
                type="button"
                disabled={!canEdit}
                onClick={() => setForm((f) => ({ ...f, minOrderMode: mode }))}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition disabled:opacity-60 ${
                  form.minOrderMode === mode
                    ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/15"
                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                }`}
              >
                {txt}
              </button>
            ))}
          </div>

          {form.minOrderMode === "PECAS" && (
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1.5">
                Quantidade mínima de peças
              </label>
              <input
                disabled={!canEdit}
                value={form.minOrder}
                onChange={(e) =>
                  setForm((f) => ({ ...f, minOrder: e.target.value.replace(/\D/g, "") }))
                }
                className={input}
                inputMode="numeric"
                placeholder="Ex.: 10"
              />
            </div>
          )}
          {form.minOrderMode === "VALOR" && (
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1.5">
                Valor mínimo do pedido (R$)
              </label>
              <input
                disabled={!canEdit}
                value={form.minOrderValue}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    minOrderValue: e.target.value.replace(/[^\d.,]/g, ""),
                  }))
                }
                className={input}
                inputMode="decimal"
                placeholder="Ex.: 200,00"
              />
            </div>
          )}
          {form.minOrderMode === "NONE" && (
            <p className="mt-2 text-xs text-gray-400">
              O cliente pode enviar o pedido com qualquer quantidade ou valor.
            </p>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60"
          >
            {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar catálogo"}
          </button>
          {error && (
            <span className="text-xs font-medium text-rose-600">{error}</span>
          )}
        </div>
      )}
    </Card>
  );
}
