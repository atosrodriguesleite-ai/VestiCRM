"use client";

/**
 * Seletor do MEIO DE ENVIO do pedido (Correios / Transportadora): Sedex, Pac,
 * Loggi, Jadlog... Funciona igual à forma de pagamento. Admin/gerente e o
 * perfil Suporte podem cadastrar e apagar meios ali mesmo (botão engrenagem).
 * Otimista: muda na hora; o servidor confirma em seguida.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2, Plus, Trash2, X, Loader2 } from "lucide-react";
import { Portal } from "@/components/portal";

type Method = { id: string; name: string; kind: string };

const KIND_LABEL: Record<string, string> = {
  CORREIOS: "Correios",
  TRANSPORTADORA: "Transportadora",
};

export function ShippingMethodChanger({
  orderId,
  current,
  canManage,
}: {
  orderId: string;
  current: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [shown, setShown] = useState<string>(current ?? "");
  const [open, setOpen] = useState(false);
  useEffect(() => setShown(current ?? ""), [current]);

  async function load() {
    const r = await fetch("/api/shipping-methods");
    if (r.ok) setMethods((await r.json()).methods);
    else setMethods([]);
  }
  useEffect(() => {
    void load();
  }, []);

  async function change(method: string) {
    if (method === shown) return;
    setShown(method); // resposta visual imediata
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shippingMethod: method || null }),
    });
    if (!res.ok) setShown(current ?? "");
    else router.refresh();
  }

  // agrupa por tipo para o <optgroup>; garante que o valor atual apareça mesmo
  // que não esteja mais na lista cadastrada (pedido antigo com texto livre)
  const correios = (methods ?? []).filter((m) => m.kind === "CORREIOS");
  const transp = (methods ?? []).filter((m) => m.kind !== "CORREIOS");
  const known = new Set((methods ?? []).map((m) => m.name));
  const currentUnknown = shown && !known.has(shown);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <select
          value={shown}
          onChange={(e) => change(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          <option value="">A definir</option>
          {currentUnknown && <option value={shown}>{shown}</option>}
          {correios.length > 0 && (
            <optgroup label="Correios">
              {correios.map((m) => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </optgroup>
          )}
          {transp.length > 0 && (
            <optgroup label="Transportadora">
              {transp.map((m) => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        {canManage && (
          <button
            onClick={() => setOpen(true)}
            title="Cadastrar / apagar meios de envio"
            className="grid size-7 shrink-0 place-items-center rounded-lg border border-gray-200 text-gray-400 hover:border-brand-300 hover:text-brand-600 transition"
          >
            <Settings2 className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <ManageModal
          methods={methods ?? []}
          onClose={() => setOpen(false)}
          onChanged={async () => {
            await load();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ManageModal({
  methods,
  onClose,
  onChanged,
}: {
  methods: Method[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [list, setList] = useState<Method[]>(methods);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"CORREIOS" | "TRANSPORTADORA">("TRANSPORTADORA");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setList(methods);
  }, [methods]);

  async function add() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/shipping-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, kind }),
    });
    setBusy(false);
    if (r.ok) {
      const d = await r.json();
      setList((prev) => [...prev.filter((m) => m.id !== d.method.id), d.method]);
      setName("");
      await onChanged();
    } else {
      const d = await r.json().catch(() => ({}));
      setMsg(d.error ?? "Não foi possível cadastrar.");
    }
  }

  async function remove(m: Method) {
    setList((prev) => prev.filter((x) => x.id !== m.id));
    await fetch(`/api/shipping-methods/${m.id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
        <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
        <div className="relative flex max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] w-full flex-col rounded-t-2xl bg-white shadow-pop animate-fade-up md:max-w-sm md:rounded-2xl md:max-h-[85dvh]">
          <div className="border-b border-gray-100 p-5 pb-3">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Meios de envio</h3>
              <button onClick={onClose} className="p-1 text-gray-400"><X className="size-5" /></button>
            </div>
            <p className="text-xs leading-snug text-gray-500">Cadastre os Correios e transportadoras que a loja usa (Sedex, Pac, Loggi, Jadlog…).</p>
            {/* cadastrar */}
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {(["CORREIOS", "TRANSPORTADORA"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`rounded-xl border px-3 py-2 text-sm transition ${
                      kind === k ? "border-brand-400 bg-brand-50 font-medium text-brand-700" : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                  placeholder={kind === "CORREIOS" ? "Ex.: Sedex, Pac" : "Ex.: Loggi, Jadlog"}
                  maxLength={40}
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
                <button
                  onClick={add}
                  disabled={busy || !name.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  <Plus className="size-4" /> Adicionar
                </button>
              </div>
              {msg && <p className="text-xs font-medium text-rose-600">{msg}</p>}
            </div>
          </div>

          <div className="thin-scroll flex-1 overflow-y-auto p-5 pt-3">
            {list.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">Nenhum meio de envio cadastrado.</p>
            ) : (
              <div className="space-y-1.5">
                {list.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{m.name}</span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{KIND_LABEL[m.kind] ?? m.kind}</span>
                    <button onClick={() => remove(m)} className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-500" title="Apagar">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
