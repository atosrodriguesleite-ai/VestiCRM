"use client";

/**
 * Estoque de Sobras — cada pedaço de tecido guardado, com peso, valor parado,
 * GEOMETRIA (o formato importa tanto quanto o peso pro reaproveitamento) e o
 * ciclo de status: disponível → reservada → consumida / descartada / perda.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";

export type SobraRow = {
  id: string;
  fabricName: string;
  color: string | null;
  grammage: number | null;
  widthM: number | null;
  weightKg: number;
  estimatedM: number | null;
  value: number;
  geometry: string | null;
  quality: string | null;
  status: string;
  corteCode: number | null;
  notes: string | null;
  createdAt: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  DISPONIVEL: { label: "Disponível", cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  RESERVADA: { label: "Reservada", cls: "bg-sky-50 border-sky-200 text-sky-700" },
  CONSUMIDA: { label: "Consumida", cls: "bg-gray-100 border-gray-200 text-gray-500" },
  DESCARTADA: { label: "Descartada", cls: "bg-gray-100 border-gray-200 text-gray-500" },
  PERDA: { label: "Perda definitiva", cls: "bg-rose-50 border-rose-200 text-rose-600" },
};

const GEOMETRIA: Record<string, string> = {
  FAIXA: "Faixa longa",
  RETANGULO: "Retângulo",
  IRREGULAR: "Irregular",
  RETALHOS: "Retalhos",
};

const selectCls =
  "rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-200 bg-white";

export function SobrasView({ sobras }: { sobras: SobraRow[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState("DISPONIVEL");
  const [busyId, setBusyId] = useState("");

  const filtradas = useMemo(
    () => (filtro === "TODAS" ? sobras : sobras.filter((s) => s.status === filtro)),
    [sobras, filtro]
  );

  async function atualiza(id: string, data: Record<string, unknown>) {
    setBusyId(id);
    await fetch(`/api/producao/sobras/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setBusyId("");
    router.refresh();
  }

  const chips = ["DISPONIVEL", "RESERVADA", "CONSUMIDA", "DESCARTADA", "PERDA", "TODAS"];

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => setFiltro(c)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
              filtro === c
                ? "bg-brand-600 border-brand-600 text-white"
                : "bg-white border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {c === "TODAS" ? "Todas" : STATUS[c].label}
            {c !== "TODAS" && (
              <span className="ml-1 opacity-70">
                {sobras.filter((s) => s.status === c).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtradas.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers />}
            title="Nenhuma sobra aqui"
            hint="Sobras nascem das ocorrências e pontas registradas nos cortes."
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtradas.map((s) => {
            const st = STATUS[s.status] ?? STATUS.DISPONIVEL;
            return (
              <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {s.fabricName}
                    {s.color && <span className="text-gray-500 font-normal"> · {s.color}</span>}
                    {s.corteCode != null && (
                      <span className="text-[11px] text-gray-400 font-mono font-normal">
                        {"  "}corte #{String(s.corteCode).padStart(6, "0")}
                      </span>
                    )}
                  </p>
                  <span className={`rounded-full border text-[11px] font-semibold px-2.5 py-0.5 ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mt-1.5">
                  <span><b className="text-gray-700">{s.weightKg.toLocaleString("pt-BR")}</b> kg</span>
                  {s.estimatedM != null && <span>~{s.estimatedM.toLocaleString("pt-BR")} m</span>}
                  {s.grammage && <span>{s.grammage} g/m²</span>}
                  <span className="text-brand-700 font-semibold">
                    R$ {s.value.toFixed(2).replace(".", ",")}
                  </span>
                  {s.notes && <span className="text-gray-400 truncate max-w-[220px]">{s.notes}</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-2.5">
                  <select
                    value={s.geometry ?? ""}
                    disabled={busyId === s.id}
                    onChange={(e) => atualiza(s.id, { geometry: e.target.value || null })}
                    className={selectCls}
                    title="Formato da sobra — o motor usa isso nas projeções"
                  >
                    <option value="">Formato?</option>
                    {Object.entries(GEOMETRIA).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <select
                    value={s.quality ?? ""}
                    disabled={busyId === s.id}
                    onChange={(e) => atualiza(s.id, { quality: e.target.value || null })}
                    className={selectCls}
                  >
                    <option value="">Qualidade?</option>
                    <option value="BOA">Boa</option>
                    <option value="REGULAR">Regular</option>
                    <option value="RUIM">Ruim</option>
                  </select>
                  <select
                    value={s.status}
                    disabled={busyId === s.id}
                    onChange={(e) => atualiza(s.id, { status: e.target.value })}
                    className={selectCls}
                  >
                    {Object.entries(STATUS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
