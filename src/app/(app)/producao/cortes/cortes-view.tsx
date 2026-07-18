"use client";

/**
 * Cortes — coração do módulo Produção.
 * Fluxo: criar corte (reserva o peso no rolo, calcula enfesto ao vivo) →
 * registrar produção (parcial vira PROJEÇÃO do motor) → fechar (previsto ×
 * real × erro) → custos por peça. Ocorrências viram sobras reaproveitáveis.
 * Pensado pra celular: quem registra está do lado da mesa de corte.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Card, EmptyState } from "@/components/ui";

export type ProdSettings = {
  tables: { name: string; lengthM: number }[];
  operators: string[];
  occurrenceTypes: string[];
  costItems: { name: string; value: number }[];
};

export type RollOption = {
  id: string;
  fabricName: string;
  color: string;
  remainingKg: number;
  yieldMPerKg: number;
  pricePerKg: number;
};

export type CorteRow = {
  id: string;
  code: number;
  status: string;
  date: string;
  operator: string | null;
  tableName: string | null;
  tableLengthM: number | null;
  plannedKg: number;
  usedKg: number;
  planName: string | null;
  productName: string | null;
  gradeInfo: string | null;
  lengthM: number | null;
  sheets: number | null;
  piecesFirst: number | null;
  predictedTotal: number | null;
  predictedMin: number | null;
  predictedMax: number | null;
  predictedBasis: number;
  piecesRest: number | null;
  piecesTotal: number | null;
  errorPieces: number | null;
  fabricCost: number;
  costItems: { name: string; value: number }[];
  costPerPiece: number | null;
  notes: string | null;
  fabricName: string;
  fabricColor: string;
  yieldMPerKg: number;
  occurrences: { id: string; type: string; description: string | null; lostKg: number }[];
  sobras: number;
};

const fmtCode = (n: number) => `#${String(n).padStart(6, "0")}`;
const fmtKg = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
const fmtM = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m`;
const fmtR$ = (n: number) =>
  `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ABERTO: { label: "Na mesa", cls: "bg-amber-50 border-amber-200 text-amber-700" },
  PARCIAL: { label: "Parcial · projeção", cls: "bg-sky-50 border-sky-200 text-sky-700" },
  FECHADO: { label: "Fechado", cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
};

const inputCls =
  "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

export function CortesView({
  cortes,
  rolls,
  settings,
}: {
  cortes: CorteRow[];
  rolls: RollOption[];
  settings: ProdSettings;
}) {
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<CorteRow | null>(null);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setNovo(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
        >
          <Plus className="size-4" />
          Novo corte
        </button>
      </div>

      {cortes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Scissors />}
            title="Nenhum corte registrado"
            hint="Cadastre um tecido e um rolo em Configurações e crie o primeiro corte."
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {cortes.map((c) => {
            const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.ABERTO;
            return (
              <button
                key={c.id}
                onClick={() => setAberto(c)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 hover:border-brand-200 shadow-sm p-4 transition"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono font-bold text-sm text-gray-800">
                      {fmtCode(c.code)}
                    </span>
                    <span
                      className={`rounded-full border text-[11px] font-semibold px-2.5 py-0.5 ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(c.date).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-1.5 truncate">
                  <b>{c.fabricName}</b> · {c.fabricColor}
                  {c.productName && <> → {c.productName}</>}
                </p>
                <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mt-1">
                  <span>{fmtKg(c.plannedKg)} destinados</span>
                  {c.lengthM != null && <span>{fmtM(c.lengthM)}</span>}
                  {c.sheets != null && c.sheets > 0 && <span>{c.sheets} folhas</span>}
                  {c.status === "PARCIAL" && c.predictedTotal != null && (
                    <span className="text-sky-700 font-semibold">
                      ✨ projeção: {Math.round(c.predictedTotal)} peças
                    </span>
                  )}
                  {c.status === "FECHADO" && c.piecesTotal != null && (
                    <span className="text-emerald-700 font-semibold">
                      {c.piecesTotal} peças
                      {c.costPerPiece != null && ` · ${fmtR$(c.costPerPiece)}/peça`}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {novo && (
        <NovoCorteModal rolls={rolls} settings={settings} onClose={() => setNovo(false)} />
      )}
      {aberto && (
        <CorteModal corte={aberto} settings={settings} onClose={() => setAberto(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- novo corte */

function NovoCorteModal({
  rolls,
  settings,
  onClose,
}: {
  rolls: RollOption[];
  settings: ProdSettings;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rollId, setRollId] = useState(rolls[0]?.id ?? "");
  const [kg, setKg] = useState("");
  const [mesa, setMesa] = useState(settings.tables[0]?.name ?? "");
  const [mesaM, setMesaM] = useState(
    settings.tables[0] ? String(settings.tables[0].lengthM) : ""
  );
  const [operador, setOperador] = useState(settings.operators[0] ?? "");
  const [modelo, setModelo] = useState("");
  const [grade, setGrade] = useState("");
  const [plano, setPlano] = useState("");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const roll = rolls.find((r) => r.id === rollId);
  const kgNum = parseFloat(kg.replace(",", "."));
  const mesaNum = parseFloat(mesaM.replace(",", "."));
  // enfesto ao vivo enquanto digita — o operador confere na hora
  const metros = roll && kgNum > 0 ? kgNum * roll.yieldMPerKg : 0;
  const folhas = metros > 0 && mesaNum > 0 ? Math.floor(metros / mesaNum) : 0;

  async function salvar() {
    if (!roll || !(kgNum > 0)) return;
    setSalvando(true);
    setErro("");
    const res = await fetch("/api/producao/cortes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rollId,
        plannedKg: kgNum,
        tableName: mesa || null,
        tableLengthM: mesaNum > 0 ? mesaNum : null,
        operator: operador || null,
        productName: modelo || null,
        gradeInfo: grade || null,
        planName: plano || null,
        notes: obs || null,
      }),
    });
    setSalvando(false);
    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível criar o corte.");
    }
  }

  return (
    <Modal titulo="Novo corte" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-600">
          Rolo de tecido
          <select
            value={rollId}
            onChange={(e) => setRollId(e.target.value)}
            className={inputCls + " mt-1"}
          >
            {rolls.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fabricName} — {r.color} · {r.remainingKg.toFixed(2).replace(".", ",")} kg disponíveis
              </option>
            ))}
          </select>
          {rolls.length === 0 && (
            <span className="text-[11px] text-amber-700">
              Nenhum rolo com saldo — cadastre em Configurações.
            </span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-gray-600">
            Peso destinado (kg)
            <input
              value={kg}
              onChange={(e) => setKg(e.target.value)}
              inputMode="decimal"
              placeholder="13"
              className={inputCls + " mt-1"}
            />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Operador
            <input
              value={operador}
              onChange={(e) => setOperador(e.target.value)}
              list="ops-list"
              placeholder="Quem corta"
              className={inputCls + " mt-1"}
            />
            <datalist id="ops-list">
              {settings.operators.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Mesa
            <input
              value={mesa}
              onChange={(e) => {
                setMesa(e.target.value);
                const t = settings.tables.find((x) => x.name === e.target.value);
                if (t) setMesaM(String(t.lengthM));
              }}
              list="mesas-list"
              placeholder="Mesa 1"
              className={inputCls + " mt-1"}
            />
            <datalist id="mesas-list">
              {settings.tables.map((t) => (
                <option key={t.name} value={t.name} />
              ))}
            </datalist>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Comprimento da mesa (m)
            <input
              value={mesaM}
              onChange={(e) => setMesaM(e.target.value)}
              inputMode="decimal"
              placeholder="5"
              className={inputCls + " mt-1"}
            />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Modelo produzido
            <input
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder="Baby Look"
              className={inputCls + " mt-1"}
            />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Grade
            <input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="P2 M2 G2 GG1"
              className={inputCls + " mt-1"}
            />
          </label>
        </div>

        <label className="block text-xs font-medium text-gray-600">
          Plano de corte
          <input
            value={plano}
            onChange={(e) => setPlano(e.target.value)}
            placeholder="Encaixe padrão 6 folhas"
            className={inputCls + " mt-1"}
          />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Observações
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className={inputCls + " mt-1"}
          />
        </label>

        {roll && kgNum > 0 && (
          <div className="rounded-xl bg-brand-50 border border-brand-100 p-3 text-sm text-brand-800">
            <b>{fmtKg(kgNum)}</b> × {roll.yieldMPerKg.toLocaleString("pt-BR")} m/kg ={" "}
            <b>{fmtM(metros)}</b>
            {mesaNum > 0 && (
              <>
                {" "}→ mesa de {mesaNum.toLocaleString("pt-BR")} m ={" "}
                <b>{folhas} folha{folhas === 1 ? "" : "s"} completa{folhas === 1 ? "" : "s"}</b>
              </>
            )}
          </div>
        )}
        {erro && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{erro}</p>}

        <button
          onClick={salvar}
          disabled={salvando || !roll || !(kgNum > 0)}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-3 transition disabled:opacity-50"
        >
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
          Criar corte
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- detalhe/ciclo */

function CorteModal({
  corte: c,
  settings,
  onClose,
}: {
  corte: CorteRow;
  settings: ProdSettings;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function acao(body: Record<string, unknown>, done?: string) {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/producao/cortes/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      if (done) setMsg(done);
      router.refresh();
      onClose();
    } else {
      setMsg(d.error ?? "Não foi possível salvar.");
    }
  }

  async function apagar() {
    if (!window.confirm("Apagar este corte? O peso volta pro rolo.")) return;
    setBusy(true);
    const res = await fetch(`/api/producao/cortes/${c.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "Não foi possível apagar.");
    }
  }

  const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.ABERTO;

  return (
    <Modal
      titulo={`Corte ${fmtCode(c.code)}`}
      extra={
        <span className={`rounded-full border text-[11px] font-semibold px-2.5 py-0.5 ${badge.cls}`}>
          {badge.label}
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* ficha */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Info k="Tecido" v={`${c.fabricName} · ${c.fabricColor}`} />
          <Info k="Data" v={new Date(c.date).toLocaleDateString("pt-BR")} />
          <Info k="Peso destinado" v={fmtKg(c.plannedKg)} />
          <Info k="Operador" v={c.operator ?? "—"} />
          <Info
            k="Mesa"
            v={c.tableName ? `${c.tableName}${c.tableLengthM ? ` (${c.tableLengthM} m)` : ""}` : "—"}
          />
          <Info
            k="Enfesto"
            v={
              c.lengthM != null
                ? `${fmtM(c.lengthM)}${c.sheets ? ` · ${c.sheets} folhas` : ""}`
                : "—"
            }
          />
          {c.productName && <Info k="Modelo" v={c.productName} />}
          {c.gradeInfo && <Info k="Grade" v={c.gradeInfo} />}
          {c.planName && <Info k="Plano" v={c.planName} />}
        </div>

        {/* etapa: registrar produção */}
        {c.status === "ABERTO" && (
          <FormProducao
            plannedKg={c.plannedKg}
            busy={busy}
            onSubmit={(usedKg, pieces, wasteKg) =>
              acao({ action: "producao", usedKg, pieces, ...(wasteKg ? { wasteKg } : {}) })
            }
          />
        )}

        {/* etapa: parcial com projeção */}
        {c.status === "PARCIAL" && (
          <>
            <div className="rounded-xl bg-sky-50 border border-sky-200 p-3.5">
              <p className="text-xs font-bold text-sky-800 flex items-center gap-1.5 mb-1">
                <Sparkles className="size-3.5" />
                PROJEÇÃO do motor
              </p>
              <p className="text-sm text-sky-900">
                Cortados <b>{fmtKg(c.usedKg)}</b> → <b>{c.piecesFirst}</b> peças. Restam{" "}
                <b>{fmtKg(Math.max(0, c.plannedKg - c.usedKg))}</b>.
              </p>
              {c.predictedTotal != null ? (
                <p className="text-sm text-sky-900 mt-1">
                  Produção total prevista:{" "}
                  <b className="text-base">{Math.round(c.predictedTotal)} peças</b>
                  {c.predictedMin != null && c.predictedMax != null && (
                    <span className="text-sky-700">
                      {" "}(entre {Math.round(c.predictedMin)} e {Math.round(c.predictedMax)})
                    </span>
                  )}
                  <span className="block text-[11px] text-sky-600 mt-0.5">
                    {c.predictedBasis > 0
                      ? `baseado em ${c.predictedBasis} corte(s) parecido(s) + o rendimento deste corte`
                      : "baseado no rendimento medido neste próprio corte"}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-sky-700 mt-1">Sem base pra projetar ainda.</p>
              )}
            </div>
            <FormFechar
              busy={busy}
              onSubmit={(pieces, wasteKg) =>
                acao({ action: "fechar", pieces, ...(wasteKg ? { wasteKg } : {}) })
              }
            />
          </>
        )}

        {/* fechado: resultado + custo */}
        {c.status === "FECHADO" && (
          <>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-sm text-emerald-900">
              <p className="font-bold text-xs text-emerald-800 mb-1 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" /> Resultado
              </p>
              <div className="flex items-center gap-4 flex-wrap">
                {c.predictedTotal != null && (
                  <span>Previsto: <b>{Math.round(c.predictedTotal)}</b></span>
                )}
                <span>Produzido: <b className="text-base">{c.piecesTotal}</b> peças</span>
                {c.errorPieces != null && (
                  <span className={Math.abs(c.errorPieces) <= 2 ? "text-emerald-700" : "text-amber-700"}>
                    Erro: <b>{c.errorPieces > 0 ? "+" : ""}{Math.round(c.errorPieces)}</b> peça(s) → o motor aprendeu
                  </span>
                )}
              </div>
            </div>
            <Custos corte={c} busy={busy} onSave={(items) => acao({ action: "custos", items }, "Custos salvos")} />
          </>
        )}

        {/* ocorrências + sobra manual (enquanto não fechado) */}
        <Ocorrencias corte={c} settings={settings} busy={busy} onAdd={(o) => acao({ action: "ocorrencia", ...o })} />
        {c.status !== "FECHADO" && (
          <SobraManual busy={busy} onAdd={(s) => acao({ action: "sobra", ...s })} />
        )}

        {msg && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{msg}</p>}

        {c.status === "ABERTO" && (
          <button
            onClick={apagar}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-rose-600 transition"
          >
            <Trash2 className="size-3.5" /> Apagar corte (devolve o peso ao rolo)
          </button>
        )}
      </div>
    </Modal>
  );
}

function FormProducao({
  plannedKg,
  busy,
  onSubmit,
}: {
  plannedKg: number;
  busy: boolean;
  onSubmit: (usedKg: number, pieces: number, wasteKg: number) => void;
}) {
  const [kg, setKg] = useState(String(plannedKg).replace(".", ","));
  const [pecas, setPecas] = useState("");
  const [aparas, setAparas] = useState("");
  const kgNum = parseFloat(kg.replace(",", "."));
  const pecasNum = parseInt(pecas, 10);
  const aparasNum = parseFloat(aparas.replace(",", ".")) || 0;
  const parcial = kgNum > 0 && kgNum < plannedKg - 0.01;
  return (
    <div className="rounded-xl border border-gray-200 p-3.5">
      <p className="text-xs font-bold text-gray-700 mb-2">Registrar produção</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-600">
          Peso cortado (kg)
          <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal" className={inputCls + " mt-1"} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Peças produzidas
          <input value={pecas} onChange={(e) => setPecas(e.target.value)} inputMode="numeric" className={inputCls + " mt-1"} />
        </label>
      </div>
      <p className="text-[10.5px] text-gray-400 mt-1.5 leading-snug">
        Peso cortado = o que saiu do rolo pra mesa, COM as aparas jogadas fora.
        Se guardou uma ponta, pese-a e desconte (ela vira o restante do corte).
      </p>
      <label className="block text-xs font-medium text-gray-600 mt-2">
        Aparas jogadas fora (kg) — opcional
        <input
          value={aparas}
          onChange={(e) => setAparas(e.target.value)}
          inputMode="decimal"
          placeholder="Retalhos minúsculos, sem aproveitamento"
          className={inputCls + " mt-1"}
        />
      </label>
      {parcial && (
        <p className="text-[11px] text-sky-700 mt-2">
          Corte parcial: sobram {(plannedKg - kgNum).toFixed(2).replace(".", ",")} kg — o motor vai projetar o restante.
        </p>
      )}
      <button
        onClick={() => onSubmit(kgNum, pecasNum, aparasNum)}
        disabled={busy || !(kgNum > 0) || !(pecasNum >= 0)}
        className="mt-3 w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
      >
        {parcial ? "Registrar produção parcial" : "Registrar e fechar corte"}
      </button>
    </div>
  );
}

function FormFechar({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (pieces: number, wasteKg: number) => void;
}) {
  const [pecas, setPecas] = useState("");
  const [aparas, setAparas] = useState("");
  const n = parseInt(pecas, 10);
  const aparasNum = parseFloat(aparas.replace(",", ".")) || 0;
  return (
    <div className="rounded-xl border border-gray-200 p-3.5">
      <p className="text-xs font-bold text-gray-700 mb-2">Usou o restante? Feche o corte</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-600">
          Peças produzidas com o restante
          <input value={pecas} onChange={(e) => setPecas(e.target.value)} inputMode="numeric" className={inputCls + " mt-1"} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Aparas jogadas fora (kg)
          <input value={aparas} onChange={(e) => setAparas(e.target.value)} inputMode="decimal" placeholder="opcional" className={inputCls + " mt-1"} />
        </label>
      </div>
      <button
        onClick={() => onSubmit(n, aparasNum)}
        disabled={busy || !(n >= 0)}
        className="mt-3 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
      >
        Fechar corte (compara previsto × real)
      </button>
    </div>
  );
}

function Custos({
  corte: c,
  busy,
  onSave,
}: {
  corte: CorteRow;
  busy: boolean;
  onSave: (items: { name: string; value: number }[]) => void;
}) {
  const [items, setItems] = useState(c.costItems);
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const tecidoPorPeca = c.piecesTotal ? c.fabricCost / c.piecesTotal : 0;
  const extras = items.reduce((a, i) => a + i.value, 0);
  return (
    <div className="rounded-xl border border-gray-200 p-3.5">
      <p className="text-xs font-bold text-gray-700 mb-2">Custo por peça</p>
      <div className="text-sm text-gray-700 space-y-1">
        <p>
          Tecido: {fmtR$(c.fabricCost)} ÷ {c.piecesTotal} peças ={" "}
          <b>{fmtR$(tecidoPorPeca)}</b>/peça
        </p>
        {items.map((i, idx) => (
          <p key={idx} className="flex items-center justify-between text-xs text-gray-600">
            <span>+ {i.name}: {fmtR$(i.value)}/peça</span>
            <button
              onClick={() => setItems(items.filter((_, k) => k !== idx))}
              className="text-gray-300 hover:text-rose-500"
            >
              <X className="size-3.5" />
            </button>
          </p>
        ))}
        <p className="pt-1 border-t border-gray-100">
          Custo industrial:{" "}
          <b className="text-base text-brand-700">{fmtR$(tecidoPorPeca + extras)}</b>/peça
        </p>
      </div>
      <div className="flex gap-2 mt-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Mão de obra" className={inputCls} />
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$/peça" className={inputCls + " w-24 shrink-0"} />
        <button
          onClick={() => {
            const v = parseFloat(valor.replace(",", "."));
            if (!nome.trim() || !(v >= 0)) return;
            setItems([...items, { name: nome.trim(), value: v }]);
            setNome("");
            setValor("");
          }}
          className="shrink-0 rounded-xl border border-gray-200 px-3 text-gray-500 hover:border-brand-300"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <button
        onClick={() => onSave(items)}
        disabled={busy}
        className="mt-3 w-full rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium py-2.5 transition disabled:opacity-50"
      >
        Salvar custos
      </button>
    </div>
  );
}

function Ocorrencias({
  corte: c,
  settings,
  busy,
  onAdd,
}: {
  corte: CorteRow;
  settings: ProdSettings;
  busy: boolean;
  onAdd: (o: { type: string; description: string | null; lostKg: number }) => void;
}) {
  const [tipo, setTipo] = useState(settings.occurrenceTypes[0] ?? "Furo");
  const [desc, setDesc] = useState("");
  const [kg, setKg] = useState("");
  const [form, setForm] = useState(false);
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" />
          Ocorrências ({c.occurrences.length})
        </p>
        {c.status !== "FECHADO" && (
          <button onClick={() => setForm(!form)} className="text-xs text-amber-700 font-medium underline underline-offset-2">
            {form ? "fechar" : "+ registrar"}
          </button>
        )}
      </div>
      {c.occurrences.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {c.occurrences.map((o) => (
            <li key={o.id} className="text-xs text-amber-900">
              • <b>{o.type}</b>
              {o.lostKg > 0 && ` — ${o.lostKg.toLocaleString("pt-BR")} kg (virou sobra reaproveitável)`}
              {o.description && ` · ${o.description}`}
            </li>
          ))}
        </ul>
      )}
      {form && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
              {settings.occurrenceTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal" placeholder="Peso perdido (kg)" className={inputCls} />
          </div>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (opcional)" className={inputCls} />
          <button
            onClick={() => onAdd({ type: tipo, description: desc || null, lostKg: parseFloat(kg.replace(",", ".")) || 0 })}
            disabled={busy}
            className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium py-2 transition disabled:opacity-50"
          >
            Registrar ocorrência
          </button>
          <p className="text-[10.5px] text-amber-700 leading-snug">
            O material NÃO vira perda: entra no Estoque de Sobras como disponível.
          </p>
        </div>
      )}
    </div>
  );
}

function SobraManual({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (s: { weightKg: number; geometry: string | null }) => void;
}) {
  const [kg, setKg] = useState("");
  const [geo, setGeo] = useState("FAIXA");
  const n = parseFloat(kg.replace(",", "."));
  return (
    <div className="rounded-xl border border-gray-200 p-3.5">
      <p className="text-xs font-bold text-gray-700 mb-2">Registrar sobra (ponta do rolo, retalho...)</p>
      <div className="grid grid-cols-2 gap-2">
        <input value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal" placeholder="Peso (kg)" className={inputCls} />
        <select value={geo} onChange={(e) => setGeo(e.target.value)} className={inputCls}>
          <option value="FAIXA">Faixa longa</option>
          <option value="RETANGULO">Retângulo</option>
          <option value="IRREGULAR">Irregular</option>
          <option value="RETALHOS">Retalhos pequenos</option>
        </select>
      </div>
      <button
        onClick={() => onAdd({ weightKg: n, geometry: geo })}
        disabled={busy || !(n > 0)}
        className="mt-2 w-full rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium py-2 transition disabled:opacity-50"
      >
        Guardar no Estoque de Sobras
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ base */

function Info({ k, v }: { k: string; v: string }) {
  return (
    <p className="text-gray-700">
      <span className="block text-[10.5px] uppercase tracking-wide text-gray-400">{k}</span>
      {v}
    </p>
  );
}

function Modal({
  titulo,
  extra,
  children,
  onClose,
}: {
  titulo: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-lg max-h-[92dvh] md:max-h-[85dvh] flex flex-col">
        <div className="flex items-center justify-between gap-2 p-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <h3 className="font-semibold text-lg">{titulo}</h3>
            {extra}
          </div>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll p-5 pt-4">{children}</div>
      </div>
    </div>
  );
}
