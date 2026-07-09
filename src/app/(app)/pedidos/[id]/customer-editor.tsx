"use client";

/**
 * Dados do cliente na tela do pedido — com edição inline.
 *
 * Pedidos do catálogo público podem chegar sem identificação; o vendedor
 * preenche nome/telefone aqui mesmo, sem sair do pedido.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { formatPhone } from "@/lib/format";
import { Avatar } from "@/components/ui";

export function CustomerEditor({
  customerId,
  name,
  phone,
}: {
  customerId: string;
  name: string;
  phone: string;
}) {
  const router = useRouter();
  const unidentified = !phone || name.startsWith("Cliente do catálogo");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: unidentified && name.startsWith("Cliente do catálogo") ? "" : name, phone });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!form.name.trim()) return setError("Informe o nome.");
    if (form.phone.replace(/\D/g, "").length < 8) return setError("Informe um telefone válido (com DDD).");
    setSaving(true);
    setError("");
    const res = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name.trim(), phone: form.phone.trim() }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error ?? "Não foi possível salvar.");
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <Avatar name={name} color="#6d28ff" size="sm" />
        <Link
          href={`/clientes/${customerId}`}
          className="text-sm font-medium hover:text-brand-600"
        >
          {name}
        </Link>
        {phone ? (
          <span className="text-xs text-gray-400">{formatPhone(phone)}</span>
        ) : (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-0.5">
            sem dados de contato
          </span>
        )}
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 transition"
        >
          <Pencil className="size-3" />
          {unidentified ? "Preencher dados do cliente" : "Editar"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3 max-w-md">
      <p className="text-xs font-semibold text-gray-600 mb-2">Dados do cliente</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Nome do cliente"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
        <input
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="Telefone (com DDD)"
          inputMode="tel"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
        />
      </div>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      <div className="flex gap-2 mt-2.5">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-2 transition disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-200 text-gray-500 text-xs font-medium px-3.5 py-2 transition hover:bg-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
