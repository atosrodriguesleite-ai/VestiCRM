"use client";

/**
 * Configurações da Produção: cadastro dos tecidos (a "ficha técnica") e dos
 * rolos físicos, mais as listas da fábrica — mesas, operadores, tipos de
 * ocorrência e custos extras padrão por peça. Tudo configurável.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Shirt, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui";

export type Ajustes = {
  tables: { name: string; lengthM: number }[];
  operators: string[];
  occurrenceTypes: string[];
  costItems: { name: string; value: number }[];
};

export type TecidoRow = {
  id: string;
  name: string;
  code: string | null;
  type: string | null;
  supplier: string | null;
  grammage: number | null;
  composition: string | null;
  widthM: number;
  yieldMPerKg: number;
  active: boolean;
  rolls: {
    id: string;
    color: string;
    lotCode: string | null;
    weightKg: number;
    remainingKg: number;
    pricePerKg: number;
  }[];
};

const inputCls =
  "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

export type FaccaoConfigRow = {
  id: string;
  name: string;
  contact: string | null;
  pricePerPiece: number;
  active: boolean;
};

export function ProducaoConfigView({
  tecidos,
  ajustes,
  faccoes,
}: {
  tecidos: TecidoRow[];
  ajustes: Ajustes;
  faccoes: FaccaoConfigRow[];
}) {
  return (
    <div className="space-y-6">
      <Tecidos tecidos={tecidos} />
      <Faccoes faccoes={faccoes} />
      <Listas ajustes={ajustes} />
    </div>
  );
}

/* ------------------------------------------------------------- facções */

function Faccoes({ faccoes }: { faccoes: FaccaoConfigRow[] }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", contact: "", price: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function criar() {
    setSalvando(true);
    setErro("");
    const res = await fetch("/api/producao/faccoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name.trim(),
        contact: f.contact.trim() || null,
        pricePerPiece: parseFloat(f.price.replace(",", ".")) || 0,
      }),
    });
    setSalvando(false);
    if (res.ok) {
      setF({ name: "", contact: "", price: "" });
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível salvar.");
    }
  }

  async function alterna(fx: FaccaoConfigRow) {
    await fetch(`/api/producao/faccoes/${fx.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !fx.active }),
    });
    router.refresh();
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold mb-1">Facções de costura</h2>
      <p className="text-xs text-gray-400 mb-3">
        Oficinas externas que recebem lotes. O enviado × devolvido de cada uma
        alimenta o ranking no Dashboard.
      </p>
      {faccoes.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {faccoes.map((fx) => (
            <li key={fx.id} className="flex items-center justify-between gap-2 text-sm text-gray-700 flex-wrap">
              <span className={fx.active ? "" : "opacity-40 line-through"}>
                <b>{fx.name}</b>
                {fx.contact && <span className="text-gray-400 text-xs"> · {fx.contact}</span>}
                {fx.pricePerPiece > 0 && (
                  <span className="text-xs text-brand-700"> · R$ {fx.pricePerPiece.toFixed(2).replace(".", ",")}/peça</span>
                )}
              </span>
              <button
                onClick={() => alterna(fx)}
                className="text-[11px] text-gray-400 underline underline-offset-2 hover:text-gray-600"
              >
                {fx.active ? "desativar" : "reativar"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_110px_auto] gap-2">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nome da facção" className={inputCls} />
        <input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="Contato (opcional)" className={inputCls} />
        <input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" placeholder="R$/peça" className={inputCls} />
        <button
          onClick={criar}
          disabled={salvando || !f.name.trim()}
          className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
        >
          {salvando ? <Loader2 className="size-4 animate-spin inline" /> : "Adicionar"}
        </button>
      </div>
      {erro && <p className="text-sm text-rose-600 mt-2">{erro}</p>}
    </Card>
  );
}

/* ------------------------------------------------------- tecidos e rolos */

function Tecidos({ tecidos }: { tecidos: TecidoRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState(tecidos.length === 0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [f, setF] = useState({
    name: "", type: "", supplier: "", grammage: "", composition: "",
    widthM: "", yieldMPerKg: "", code: "",
  });

  async function criarTecido() {
    setSalvando(true);
    setErro("");
    const res = await fetch("/api/producao/tecidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name.trim(),
        code: f.code.trim() || null,
        type: f.type.trim() || null,
        supplier: f.supplier.trim() || null,
        grammage: parseInt(f.grammage, 10) || null,
        composition: f.composition.trim() || null,
        widthM: parseFloat(f.widthM.replace(",", ".")),
        yieldMPerKg: parseFloat(f.yieldMPerKg.replace(",", ".")),
      }),
    });
    setSalvando(false);
    if (res.ok) {
      setF({ name: "", type: "", supplier: "", grammage: "", composition: "", widthM: "", yieldMPerKg: "", code: "" });
      setForm(false);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível salvar.");
    }
  }

  const ok =
    f.name.trim() &&
    parseFloat(f.widthM.replace(",", ".")) > 0 &&
    parseFloat(f.yieldMPerKg.replace(",", ".")) > 0;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Shirt className="size-4 text-brand-600" /> Tecidos e rolos
        </h2>
        <button
          onClick={() => setForm(!form)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition"
        >
          <Plus className="size-3.5" /> Novo tecido
        </button>
      </div>

      {form && (
        <div className="rounded-xl border border-gray-200 p-3.5 mb-4 grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-gray-600 col-span-2">
            Nome do tecido
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Poliamida Premium" className={inputCls + " mt-1"} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Largura (m)
            <input value={f.widthM} onChange={(e) => setF({ ...f, widthM: e.target.value })} inputMode="decimal" placeholder="1,60" className={inputCls + " mt-1"} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Rendimento (m por kg)
            <input value={f.yieldMPerKg} onChange={(e) => setF({ ...f, yieldMPerKg: e.target.value })} inputMode="decimal" placeholder="2,60" className={inputCls + " mt-1"} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Gramatura (g/m²)
            <input value={f.grammage} onChange={(e) => setF({ ...f, grammage: e.target.value })} inputMode="numeric" placeholder="260" className={inputCls + " mt-1"} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Tipo
            <input value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="Malha" className={inputCls + " mt-1"} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Fornecedor
            <input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="Têxtil Sul" className={inputCls + " mt-1"} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Composição
            <input value={f.composition} onChange={(e) => setF({ ...f, composition: e.target.value })} placeholder="90% poliamida 10% elastano" className={inputCls + " mt-1"} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Código interno
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="TEC-001" className={inputCls + " mt-1"} />
          </label>
          {erro && <p className="col-span-2 text-sm text-rose-600">{erro}</p>}
          <button
            onClick={criarTecido}
            disabled={salvando || !ok}
            className="col-span-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
          >
            {salvando ? <Loader2 className="size-4 animate-spin inline" /> : "Salvar tecido"}
          </button>
        </div>
      )}

      {tecidos.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum tecido ainda — cadastre o primeiro acima.</p>
      ) : (
        <div className="space-y-3">
          {tecidos.map((t) => (
            <TecidoCard key={t.id} tecido={t} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TecidoCard({ tecido: t }: { tecido: TecidoRow }) {
  const router = useRouter();
  const [rolo, setRolo] = useState(false);
  const [r, setR] = useState({ color: "", weightKg: "", pricePerKg: "", lotCode: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function criarRolo() {
    setSalvando(true);
    setErro("");
    const res = await fetch("/api/producao/rolos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fabricId: t.id,
        color: r.color.trim(),
        weightKg: parseFloat(r.weightKg.replace(",", ".")),
        pricePerKg: parseFloat(r.pricePerKg.replace(",", ".")),
        lotCode: r.lotCode.trim() || null,
      }),
    });
    setSalvando(false);
    if (res.ok) {
      setR({ color: "", weightKg: "", pricePerKg: "", lotCode: "" });
      setRolo(false);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível salvar o rolo.");
    }
  }

  async function apagarTecido() {
    if (!window.confirm(`Apagar o tecido "${t.name}" e seus rolos?`)) return;
    await fetch(`/api/producao/tecidos/${t.id}`, { method: "DELETE" });
    router.refresh();
  }

  const okRolo =
    r.color.trim() &&
    parseFloat(r.weightKg.replace(",", ".")) > 0 &&
    parseFloat(r.pricePerKg.replace(",", ".")) >= 0;

  return (
    <div className="rounded-xl border border-gray-100 p-3.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">
            {t.name}
            {t.code && <span className="text-[11px] text-gray-400 font-mono"> {t.code}</span>}
          </p>
          <p className="text-[11px] text-gray-500">
            {[
              t.grammage && `${t.grammage} g/m²`,
              `largura ${t.widthM.toLocaleString("pt-BR")} m`,
              `rende ${t.yieldMPerKg.toLocaleString("pt-BR")} m/kg`,
              t.supplier,
              t.composition,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setRolo(!rolo)}
            className="text-xs text-brand-600 font-medium underline underline-offset-2"
          >
            + rolo
          </button>
          <button onClick={apagarTecido} className="text-gray-300 hover:text-rose-500 p-1">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {t.rolls.length > 0 && (
        <ul className="mt-2 space-y-1">
          {t.rolls.map((rl) => (
            <li key={rl.id} className="flex items-center justify-between text-xs text-gray-600">
              <span>
                <b>{rl.color}</b>
                {rl.lotCode && <span className="text-gray-400"> · lote {rl.lotCode}</span>} ·{" "}
                {rl.weightKg.toLocaleString("pt-BR")} kg comprados · R${" "}
                {rl.pricePerKg.toFixed(2).replace(".", ",")}/kg
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  rl.remainingKg > 0.01
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {rl.remainingKg.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg restam
              </span>
            </li>
          ))}
        </ul>
      )}

      {rolo && (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <input value={r.color} onChange={(e) => setR({ ...r, color: e.target.value })} placeholder="Cor" className={inputCls} />
          <input value={r.lotCode} onChange={(e) => setR({ ...r, lotCode: e.target.value })} placeholder="Lote (opcional)" className={inputCls} />
          <input value={r.weightKg} onChange={(e) => setR({ ...r, weightKg: e.target.value })} inputMode="decimal" placeholder="Peso (kg)" className={inputCls} />
          <input value={r.pricePerKg} onChange={(e) => setR({ ...r, pricePerKg: e.target.value })} inputMode="decimal" placeholder="R$ por kg" className={inputCls} />
          {erro && <p className="col-span-2 text-xs text-rose-600">{erro}</p>}
          <button
            onClick={criarRolo}
            disabled={salvando || !okRolo}
            className="col-span-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2 transition disabled:opacity-50"
          >
            Adicionar rolo
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------- listas da fábrica (settings) */

function Listas({ ajustes }: { ajustes: Ajustes }) {
  const router = useRouter();
  const [tables, setTables] = useState(ajustes.tables);
  const [operators, setOperators] = useState(ajustes.operators);
  const [occ, setOcc] = useState(ajustes.occurrenceTypes);
  const [costs, setCosts] = useState(ajustes.costItems);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  async function salvar() {
    setSalvando(true);
    setMsg("");
    const res = await fetch("/api/producao/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tables, operators, occurrenceTypes: occ, costItems: costs }),
    });
    setSalvando(false);
    setMsg(res.ok ? "✅ Configurações salvas." : "Não foi possível salvar.");
    if (res.ok) router.refresh();
  }

  return (
    <Card className="p-5 space-y-5">
      <ListaMesas tables={tables} setTables={setTables} />
      <ListaSimples
        titulo="Operadores"
        placeholder="Nome do operador"
        itens={operators}
        onChange={setOperators}
      />
      <ListaSimples
        titulo="Tipos de ocorrência"
        placeholder="Novo tipo"
        itens={occ}
        onChange={setOcc}
      />
      <ListaCustos costs={costs} setCosts={setCosts} />
      {msg && <p className="text-sm text-brand-700 bg-brand-50 rounded-lg px-3 py-2">{msg}</p>}
      <button
        onClick={salvar}
        disabled={salvando}
        className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
      >
        {salvando ? <Loader2 className="size-4 animate-spin inline" /> : "Salvar configurações"}
      </button>
    </Card>
  );
}

function ListaMesas({
  tables,
  setTables,
}: {
  tables: { name: string; lengthM: number }[];
  setTables: (t: { name: string; lengthM: number }[]) => void;
}) {
  const [nome, setNome] = useState("");
  const [m, setM] = useState("");
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Mesas de corte</h3>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tables.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 text-xs px-3 py-1.5">
            {t.name} · {t.lengthM.toLocaleString("pt-BR")} m
            <button onClick={() => setTables(tables.filter((_, k) => k !== i))} className="text-gray-400 hover:text-rose-500">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Mesa 1" className={inputCls} />
        <input value={m} onChange={(e) => setM(e.target.value)} inputMode="decimal" placeholder="Metros" className={inputCls + " w-24 shrink-0"} />
        <button
          onClick={() => {
            const len = parseFloat(m.replace(",", "."));
            if (!nome.trim() || !(len > 0)) return;
            setTables([...tables, { name: nome.trim(), lengthM: len }]);
            setNome("");
            setM("");
          }}
          className="shrink-0 rounded-xl border border-gray-200 px-3 text-gray-500 hover:border-brand-300"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

function ListaSimples({
  titulo,
  placeholder,
  itens,
  onChange,
}: {
  titulo: string;
  placeholder: string;
  itens: string[];
  onChange: (v: string[]) => void;
}) {
  const [novo, setNovo] = useState("");
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{titulo}</h3>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {itens.map((o, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 text-xs px-3 py-1.5">
            {o}
            <button onClick={() => onChange(itens.filter((_, k) => k !== i))} className="text-gray-400 hover:text-rose-500">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={placeholder} className={inputCls} />
        <button
          onClick={() => {
            if (!novo.trim()) return;
            onChange([...itens, novo.trim()]);
            setNovo("");
          }}
          className="shrink-0 rounded-xl border border-gray-200 px-3 text-gray-500 hover:border-brand-300"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

function ListaCustos({
  costs,
  setCosts,
}: {
  costs: { name: string; value: number }[];
  setCosts: (c: { name: string; value: number }[]) => void;
}) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1">Custos extras padrão (por peça)</h3>
      <p className="text-[11px] text-gray-400 mb-2">
        Entram automaticamente em cada corte fechado — dá pra ajustar corte a corte.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {costs.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 text-xs px-3 py-1.5">
            {c.name} · R$ {c.value.toFixed(2).replace(".", ",")}
            <button onClick={() => setCosts(costs.filter((_, k) => k !== i))} className="text-gray-400 hover:text-rose-500">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Mão de obra" className={inputCls} />
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$/peça" className={inputCls + " w-24 shrink-0"} />
        <button
          onClick={() => {
            const v = parseFloat(valor.replace(",", "."));
            if (!nome.trim() || !(v >= 0)) return;
            setCosts([...costs, { name: nome.trim(), value: v }]);
            setNome("");
            setValor("");
          }}
          className="shrink-0 rounded-xl border border-gray-200 px-3 text-gray-500 hover:border-brand-300"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
