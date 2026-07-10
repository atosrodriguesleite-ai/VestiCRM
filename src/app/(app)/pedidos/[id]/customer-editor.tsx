"use client";

/**
 * Dados do cliente + venda na tela do pedido, com edição inline.
 *
 * Pedidos do catálogo público podem chegar sem identificação; o vendedor
 * preenche aqui nome, telefone, CPF/CNPJ, e-mail e endereço (nada é
 * obrigatório além do nome), além do vendedor responsável e do canal de
 * origem do cliente.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { formatPhone, originLabel } from "@/lib/format";
import { Avatar } from "@/components/ui";

type CustomerData = {
  name: string;
  phone: string;
  email: string | null;
  document: string | null;
  zip: string | null;
  street: string | null;
  streetNumber: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  origin: string;
};

export function CustomerEditor({
  customerId,
  orderId,
  customer,
  sellerId,
  sellers,
}: {
  customerId: string;
  orderId: string;
  customer: CustomerData;
  sellerId: string | null;
  sellers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const unidentified =
    !customer.phone || customer.name.startsWith("Cliente do catálogo");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: customer.name.startsWith("Cliente do catálogo") ? "" : customer.name,
    phone: customer.phone,
    email: customer.email ?? "",
    document: customer.document ?? "",
    zip: customer.zip ?? "",
    street: customer.street ?? "",
    streetNumber: customer.streetNumber ?? "",
    district: customer.district ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    origin: customer.origin,
    sellerId: sellerId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.name.trim()) return setError("Informe o nome.");
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (form.phone && phoneDigits.length < 8)
      return setError("Telefone incompleto (use DDD + número).");
    setSaving(true);
    setError("");

    const customerBody: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      document: form.document.trim() || null,
      zip: form.zip.trim() || null,
      street: form.street.trim() || null,
      streetNumber: form.streetNumber.trim() || null,
      district: form.district.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      origin: form.origin,
    };
    if (phoneDigits.length >= 8) customerBody.phone = form.phone.trim();

    const res = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customerBody),
    });
    let ok = res.ok;
    if (ok && (form.sellerId || null) !== (sellerId ?? null)) {
      const r2 = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: form.sellerId || null }),
      });
      ok = r2.ok;
    }
    setSaving(false);
    if (!ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error ?? "Não foi possível salvar.");
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    const addr = [
      [customer.street, customer.streetNumber].filter(Boolean).join(", "),
      customer.district,
      [customer.city, customer.state].filter(Boolean).join("/"),
      customer.zip ? `CEP ${customer.zip}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="mt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Avatar name={customer.name} color="#6d28ff" size="sm" />
          <Link
            href={`/clientes/${customerId}`}
            className="text-sm font-medium hover:text-brand-600"
          >
            {customer.name}
          </Link>
          {customer.phone ? (
            <span className="text-xs text-gray-400">
              {formatPhone(customer.phone)}
            </span>
          ) : (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-0.5">
              sem dados de contato
            </span>
          )}
          <span className="text-xs text-gray-400">
            · Canal: {originLabel[customer.origin as keyof typeof originLabel] ?? customer.origin}
          </span>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 transition"
          >
            <Pencil className="size-3" />
            {unidentified ? "Preencher dados do cliente" : "Editar dados"}
          </button>
        </div>
        {(customer.document || customer.email || addr) && (
          <div className="mt-1.5 space-y-0.5 text-xs text-gray-400">
            {customer.document && <p>CPF/CNPJ: {customer.document}</p>}
            {customer.email && <p>E-mail: {customer.email}</p>}
            {addr && <p>Endereço: {addr}</p>}
          </div>
        )}
      </div>
    );
  }

  const input =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300";
  const label = "block text-[11px] font-semibold text-gray-500 mb-1";

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4 max-w-2xl">
      <p className="text-xs font-semibold text-gray-600 mb-3">
        Dados do cliente e da venda
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className={label}>Nome *</span>
          <input value={form.name} onChange={set("name")} placeholder="Nome do cliente" className={input} />
        </div>
        <div>
          <span className={label}>Telefone (com DDD)</span>
          <input value={form.phone} onChange={set("phone")} placeholder="(11) 99999-0000" inputMode="tel" className={input} />
        </div>
        <div>
          <span className={label}>CPF / CNPJ</span>
          <input value={form.document} onChange={set("document")} placeholder="000.000.000-00" className={input} />
        </div>
        <div>
          <span className={label}>E-mail</span>
          <input value={form.email} onChange={set("email")} placeholder="cliente@email.com" type="email" className={input} />
        </div>
        <div>
          <span className={label}>CEP</span>
          <input value={form.zip} onChange={set("zip")} placeholder="00000-000" inputMode="numeric" className={input} />
        </div>
        <div>
          <span className={label}>Rua</span>
          <input value={form.street} onChange={set("street")} placeholder="Rua / Avenida" className={input} />
        </div>
        <div>
          <span className={label}>Número</span>
          <input value={form.streetNumber} onChange={set("streetNumber")} placeholder="123" className={input} />
        </div>
        <div>
          <span className={label}>Bairro</span>
          <input value={form.district} onChange={set("district")} placeholder="Bairro" className={input} />
        </div>
        <div>
          <span className={label}>Cidade</span>
          <input value={form.city} onChange={set("city")} placeholder="Cidade" className={input} />
        </div>
        <div>
          <span className={label}>Estado (UF)</span>
          <input value={form.state} onChange={set("state")} placeholder="SP" maxLength={2} className={input} />
        </div>
        <div>
          <span className={label}>Vendedor(a) da venda</span>
          <select value={form.sellerId} onChange={set("sellerId")} className={input}>
            <option value="">Sem vendedor definido</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>Canal de origem do cliente</span>
          <select value={form.origin} onChange={set("origin")} className={input}>
            {Object.entries(originLabel).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
      <div className="flex gap-2 mt-4">
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
