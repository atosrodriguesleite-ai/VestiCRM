"use client";

import { useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { customerTypeLabel, originLabel } from "@/lib/format";

export function NewCustomerButton({
  interests,
}: {
  interests: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [erro, setErro] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        phone: String(fd.get("phone")).replace(/\D/g, ""),
        cpf: fd.get("cpf") || undefined,
        cnpj: fd.get("cnpj") || undefined,
        city: fd.get("city") || undefined,
        state: fd.get("state") || undefined,
        type: fd.get("type"),
        origin: fd.get("origin"),
        preferredSize: fd.get("preferredSize") || undefined,
        birthDate: fd.get("birthDate") || undefined,
        preferredColors: fd.get("preferredColors") || undefined,
        notes: fd.get("notes") || undefined,
        interestIds: selectedInterests,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setErro("");
      setOpen(false);
      setSelectedInterests([]);
      router.refresh();
      return;
    }
    // sem isto o formulário só ficava parado quando o CPF estava errado, e a
    // vendedora não fazia ideia do porquê
    const data = await res.json().catch(() => null);
    setErro(data?.error ?? "Não foi possível cadastrar o cliente.");
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition active:scale-[0.98]"
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">Novo cliente</span>
        <span className="sm:hidden">Novo</span>
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
          <div
            className="absolute inset-0 bg-black/30 animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <form
            onSubmit={submit}
            className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-lg max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-6 animate-fade-up"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-lg">Novo cliente</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 p-1"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={label}>Nome *</label>
                <input name="name" required className={input} placeholder="Maria Silva" />
              </div>
              <div>
                <label className={label}>WhatsApp *</label>
                <input
                  name="phone"
                  required
                  className={input}
                  placeholder="(11) 99876-5432"
                  inputMode="tel"
                />
              </div>
              {/* CPF e CNPJ separados: a cliente lojista tem os dois, e cada
                  transportadora/nota pede um deles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>CPF</label>
                  <input
                    name="cpf"
                    className={input}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className={label}>CNPJ</label>
                  <input
                    name="cnpj"
                    className={input}
                    placeholder="00.000.000/0000-00"
                    inputMode="numeric"
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 -mt-2">
                Pode preencher os dois: cada transportadora pede um. 📦
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={label}>Cidade</label>
                  <input name="city" className={input} placeholder="São Paulo" />
                </div>
                <div>
                  <label className={label}>UF</label>
                  <input name="state" className={input} placeholder="SP" maxLength={2} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Tipo de cliente</label>
                  <select name="type" className={`${input} bg-white`}>
                    {Object.entries(customerTypeLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Origem</label>
                  <select name="origin" defaultValue="MANUAL" className={`${input} bg-white`}>
                    {Object.entries(originLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={label}>Aniversário</label>
                <input type="date" name="birthDate" className={input} />
                <p className="text-[11px] text-gray-400 mt-1">
                  O sistema avisa você no dia — é a mensagem que mais vende no ano.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Tamanho preferido</label>
                  <input name="preferredSize" className={input} placeholder="M" />
                </div>
                <div>
                  <label className={label}>Cores preferidas</label>
                  <input
                    name="preferredColors"
                    className={input}
                    placeholder="Rosa, Nude"
                  />
                </div>
              </div>
              <div>
                <label className={label}>Interesses</label>
                <div className="flex flex-wrap gap-1.5">
                  {interests.map((i) => {
                    const active = selectedInterests.includes(i.id);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() =>
                          setSelectedInterests((prev) =>
                            active
                              ? prev.filter((x) => x !== i.id)
                              : [...prev, i.id]
                          )
                        }
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                          active
                            ? "bg-brand-600 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {i.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className={label}>Observações</label>
                <textarea
                  name="notes"
                  rows={2}
                  className={input}
                  placeholder="Preferências, condições combinadas..."
                />
              </div>
              {erro && (
                <p className="rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-xs px-3 py-2">
                  {erro}
                </p>
              )}
              <button
                disabled={saving}
                className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Cadastrar cliente"}
              </button>
              <p className="text-[11px] text-gray-400 text-center">
                Uma tarefa de primeiro contato será criada automaticamente.
              </p>
            </div>
          </form>
        </div></Portal>
      )}
    </>
  );
}
