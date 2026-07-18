"use client";

/**
 * Simulador de compra — "18 kg desse tecido rendem quantas peças?"
 * Responde na hora com o histórico real da fábrica, sem criar nada.
 */

import { useState } from "react";
import { Calculator, Loader2 } from "lucide-react";
import { Card } from "@/components/ui";

type Resultado = {
  metros: number;
  custoTecido: number | null;
  projecao: { pecas: number; min: number; max: number; base: number } | null;
};

const inputCls =
  "rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

export function SimuladorCompra({
  tecidos,
}: {
  tecidos: { id: string; name: string }[];
}) {
  const [fabricId, setFabricId] = useState(tecidos[0]?.id ?? "");
  const [kg, setKg] = useState("");
  const [modelo, setModelo] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");

  async function simular() {
    const kgNum = parseFloat(kg.replace(",", "."));
    if (!fabricId || !(kgNum > 0)) return;
    setBusy(true);
    setErro("");
    setRes(null);
    const r = await fetch("/api/producao/simulador", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fabricId, kg: kgNum, productName: modelo || null }),
    });
    setBusy(false);
    if (r.ok) setRes(await r.json());
    else setErro("Não foi possível simular.");
  }

  if (tecidos.length === 0) return null;

  return (
    <Card className="p-5 mb-6">
      <h2 className="font-semibold text-sm flex items-center gap-2 mb-1">
        <Calculator className="size-4 text-brand-600" />
        Simulador de compra
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        &quot;Se eu comprar X kg, quantas peças saem?&quot; — resposta com o histórico
        real dos seus cortes, sem registrar nada.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px_1fr_auto] gap-2">
        <select value={fabricId} onChange={(e) => setFabricId(e.target.value)} className={inputCls}>
          {tecidos.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <input
          value={kg}
          onChange={(e) => setKg(e.target.value)}
          inputMode="decimal"
          placeholder="kg (ex.: 18)"
          className={inputCls}
        />
        <input
          value={modelo}
          onChange={(e) => setModelo(e.target.value)}
          placeholder="Modelo (opcional — afina a conta)"
          className={inputCls}
        />
        <button
          onClick={simular}
          disabled={busy || !(parseFloat(kg.replace(",", ".")) > 0)}
          className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin inline" /> : "Simular"}
        </button>
      </div>
      {erro && <p className="text-sm text-rose-600 mt-2">{erro}</p>}
      {res && (
        <div className="mt-3 rounded-xl bg-sky-50 border border-sky-100 p-3.5 text-sm text-sky-900">
          {res.projecao ? (
            <p>
              ✨ Sairiam <b className="text-lg">~{res.projecao.pecas} peças</b>{" "}
              <span className="text-sky-700">
                (entre {res.projecao.min} e {res.projecao.max})
              </span>
              {" "}· {res.metros.toLocaleString("pt-BR")} m de tecido
              {res.custoTecido != null && (
                <> · investimento ~R$ {res.custoTecido.toFixed(2).replace(".", ",")}</>
              )}
              <span className="block text-[11px] text-sky-600 mt-0.5">
                baseado em {res.projecao.base} corte(s) parecido(s) do seu histórico
              </span>
            </p>
          ) : (
            <p className="text-sky-700 text-xs">
              Ainda não há cortes parecidos no histórico pra projetar — feche
              alguns cortes desse tecido{modelo && " com esse modelo"} e o
              simulador aprende. ({res.metros.toLocaleString("pt-BR")} m de tecido
              {res.custoTecido != null && `, ~R$ ${res.custoTecido.toFixed(2).replace(".", ",")}`})
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
