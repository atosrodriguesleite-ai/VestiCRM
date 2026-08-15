"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Package,
  Power,
  ShieldAlert,
  Truck,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui";
import { brl } from "@/lib/format";

/**
 * Conexão do módulo Envios (Melhor Envio) na tela Configurações.
 * Só aparece para loja com o módulo contratado (Company.shippingEnabled) —
 * a API devolve enabled=false e o card some sozinho.
 */

type Settings = {
  fromName: string | null;
  fromCpf: string | null;
  fromCnpj: string | null;
  fromPhone: string | null;
  fromEmail: string | null;
  fromZip: string | null;
  fromStreet: string | null;
  fromNumber: string | null;
  fromComplement: string | null;
  fromDistrict: string | null;
  fromCity: string | null;
  fromState: string | null;
  defaultWeightGrams: number;
  boxWidthCm: number;
  boxHeightCm: number;
  boxLengthCm: number;
  categoryWeights: string;
};
type Estado = {
  enabled: boolean;
  platformReady: boolean;
  connected: boolean;
  balance: number | null;
  settings: Settings | null;
};

const input =
  "w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 transition";
const label = "block text-xs font-medium text-gray-500 mb-1";

export function MelhorEnvioConnect({ categories }: { categories: string[] }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [busy, setBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pesosCat, setPesosCat] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    const res = await fetch("/api/melhorenvio");
    if (!res.ok) return;
    const d = (await res.json()) as Estado;
    setEstado(d);
    if (d.settings) {
      const s = d.settings;
      setForm({
        fromName: s.fromName ?? "",
        fromCpf: s.fromCpf ?? "",
        fromCnpj: s.fromCnpj ?? "",
        fromPhone: s.fromPhone ?? "",
        fromEmail: s.fromEmail ?? "",
        fromZip: s.fromZip ?? "",
        fromStreet: s.fromStreet ?? "",
        fromNumber: s.fromNumber ?? "",
        fromComplement: s.fromComplement ?? "",
        fromDistrict: s.fromDistrict ?? "",
        fromCity: s.fromCity ?? "",
        fromState: s.fromState ?? "",
        defaultWeightGrams: String(s.defaultWeightGrams),
        boxWidthCm: String(s.boxWidthCm),
        boxHeightCm: String(s.boxHeightCm),
        boxLengthCm: String(s.boxLengthCm),
      });
      try {
        const cw = s.categoryWeights ? JSON.parse(s.categoryWeights) : {};
        setPesosCat(
          Object.fromEntries(
            Object.entries(cw).map(([k, v]) => [k, String(v)])
          )
        );
      } catch {
        setPesosCat({});
      }
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function salvar() {
    setSalvando(true);
    setSalvo(false);
    const categoryWeights: Record<string, number> = {};
    for (const [cat, v] of Object.entries(pesosCat)) {
      const n = parseInt(v);
      if (n > 0) categoryWeights[cat] = n;
    }
    const res = await fetch("/api/melhorenvio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromName: form.fromName,
        fromCpf: form.fromCpf,
        fromCnpj: form.fromCnpj,
        fromPhone: form.fromPhone,
        fromEmail: form.fromEmail,
        fromZip: form.fromZip,
        fromStreet: form.fromStreet,
        fromNumber: form.fromNumber,
        fromComplement: form.fromComplement,
        fromDistrict: form.fromDistrict,
        fromCity: form.fromCity,
        fromState: form.fromState.toUpperCase().slice(0, 2),
        defaultWeightGrams: parseInt(form.defaultWeightGrams) || 300,
        boxWidthCm: parseInt(form.boxWidthCm) || 30,
        boxHeightCm: parseInt(form.boxHeightCm) || 15,
        boxLengthCm: parseInt(form.boxLengthCm) || 40,
        categoryWeights,
      }),
    });
    setSalvando(false);
    if (res.ok) {
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Não foi possível salvar.");
    }
  }

  async function desconectar() {
    if (
      !window.confirm(
        "Desconectar o Melhor Envio? Cotação e compra de etiquetas param até conectar de novo."
      )
    )
      return;
    setBusy(true);
    await fetch("/api/melhorenvio/disconnect", { method: "POST" });
    setBusy(false);
    carregar();
  }

  // módulo não contratado: o card não existe para esta loja
  if (estado && !estado.enabled) return null;

  return (
    <Card className="p-5 mb-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <Truck className="size-4 text-orange-600" />
          Melhor Envio — frete e etiquetas
        </h2>
        {estado?.connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1">
            <CheckCircle2 className="size-3.5" />
            Conectado
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-3">
        Cote o frete (Correios, Jadlog e outras), compre a etiqueta e acompanhe
        o rastreio direto na tela do pedido. A conta Melhor Envio é <b>da loja</b>{" "}
        — a etiqueta é paga com o saldo da carteira dela.
      </p>
      {!estado ? (
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </p>
      ) : !estado.platformReady ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm p-3">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          Envios ainda não ativados pela plataforma. Assim que forem, o botão
          de conectar aparece aqui.
        </p>
      ) : !estado.connected ? (
        <a
          href="/api/melhorenvio/connect"
          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-5 py-2.5 transition"
        >
          <Truck className="size-4" />
          Conectar Melhor Envio
        </a>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {estado.balance != null && (
              <p className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                <Wallet className="size-4 text-orange-600" />
                Saldo da carteira: <b>{brl(estado.balance)}</b>
                <span className="text-xs text-gray-400">
                  (as etiquetas são pagas daí)
                </span>
              </p>
            )}
            <button
              onClick={desconectar}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              <Power className="size-3.5" />
              Desconectar
            </button>
          </div>

          {/* Remetente da etiqueta */}
          <details className="rounded-xl border border-gray-100 open:pb-4" open={!form.fromZip}>
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
              📮 Remetente da etiqueta{" "}
              {!form.fromZip && (
                <span className="text-amber-600 font-normal">— complete para poder cotar</span>
              )}
            </summary>
            <div className="px-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className={label}>Nome / Razão social</label>
                <input value={form.fromName ?? ""} onChange={set("fromName")} className={input} />
              </div>
              {/* CPF e CNPJ separados: a transportadora tem um campo para
                  cada um, e algumas exigem os dois (CNPJ da loja + CPF do
                  titular) */}
              <div>
                <label className={label}>CPF</label>
                <input value={form.fromCpf ?? ""} onChange={set("fromCpf")} className={input} inputMode="numeric" placeholder="000.000.000-00" />
              </div>
              <div>
                <label className={label}>CNPJ</label>
                <input value={form.fromCnpj ?? ""} onChange={set("fromCnpj")} className={input} inputMode="numeric" placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <label className={label}>Telefone</label>
                <input value={form.fromPhone ?? ""} onChange={set("fromPhone")} className={input} inputMode="tel" />
              </div>
              <div className="col-span-2">
                <label className={label}>E-mail</label>
                <input value={form.fromEmail ?? ""} onChange={set("fromEmail")} className={input} inputMode="email" />
              </div>
              <div>
                <label className={label}>CEP</label>
                <input value={form.fromZip ?? ""} onChange={set("fromZip")} className={input} inputMode="numeric" placeholder="00000-000" />
              </div>
              <div className="col-span-2">
                <label className={label}>Rua</label>
                <input value={form.fromStreet ?? ""} onChange={set("fromStreet")} className={input} />
              </div>
              <div>
                <label className={label}>Número</label>
                <input value={form.fromNumber ?? ""} onChange={set("fromNumber")} className={input} />
              </div>
              <div>
                <label className={label}>Complemento</label>
                <input value={form.fromComplement ?? ""} onChange={set("fromComplement")} className={input} />
              </div>
              <div>
                <label className={label}>Bairro</label>
                <input value={form.fromDistrict ?? ""} onChange={set("fromDistrict")} className={input} />
              </div>
              <div className="col-span-2">
                <label className={label}>Cidade</label>
                <input value={form.fromCity ?? ""} onChange={set("fromCity")} className={input} />
              </div>
              <div>
                <label className={label}>UF</label>
                <input value={form.fromState ?? ""} onChange={set("fromState")} className={input} maxLength={2} placeholder="MG" />
              </div>
            </div>
          </details>

          {/* Padrões de embalagem */}
          <details className="rounded-xl border border-gray-100 open:pb-4">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
              📦 Caixa e pesos padrão
            </summary>
            <div className="px-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className={label}>Peso por peça sem cadastro (g)</label>
                  <input value={form.defaultWeightGrams ?? ""} onChange={set("defaultWeightGrams")} className={input} inputMode="numeric" />
                </div>
                <div>
                  <label className={label}>Caixa — comprimento (cm)</label>
                  <input value={form.boxLengthCm ?? ""} onChange={set("boxLengthCm")} className={input} inputMode="numeric" />
                </div>
                <div>
                  <label className={label}>Caixa — largura (cm)</label>
                  <input value={form.boxWidthCm ?? ""} onChange={set("boxWidthCm")} className={input} inputMode="numeric" />
                </div>
                <div>
                  <label className={label}>Caixa — altura (cm)</label>
                  <input value={form.boxHeightCm ?? ""} onChange={set("boxHeightCm")} className={input} inputMode="numeric" />
                </div>
              </div>
              {categories.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">
                    <Package className="inline size-3.5 mr-1 text-gray-400" />
                    Peso padrão <b>por categoria</b> (g) — usado quando a peça
                    não tem peso próprio. Vazio = usa o peso padrão acima.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {categories.map((cat) => (
                      <div key={cat} className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 truncate text-xs text-gray-600">{cat}</span>
                        <input
                          value={pesosCat[cat] ?? ""}
                          onChange={(e) =>
                            setPesosCat((p) => ({ ...p, [cat]: e.target.value }))
                          }
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400"
                          inputMode="numeric"
                          placeholder="g"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>

          <div className="flex items-center gap-3">
            <button
              onClick={salvar}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-50"
            >
              {salvando ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Salvar configurações de envio
            </button>
            {salvo && <span className="text-sm text-emerald-600 font-medium">Salvo ✅</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
