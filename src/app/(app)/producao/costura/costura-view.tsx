"use client";

/**
 * Estoque de Costura — agrupado por SKU (modelo · cor · tamanho), do jeito
 * que a reposição trabalha: conta as peças prontas do dia, digita o TOTAL e
 * o sistema baixa dos lotes automaticamente (corte mais antigo primeiro) e
 * dá entrada no estoque real.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PackagePlus, Shirt, X } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";

export type CosturaRow = {
  id: string;
  cutCode: number | null;
  productName: string;
  color: string | null;
  size: string | null;
  cutPieces: number;
  donePieces: number;
  createdAt: string;
};

type Grupo = {
  key: string;
  productName: string;
  color: string | null;
  size: string | null;
  cortadas: number;
  montadas: number;
  restantes: number;
  lotes: { cutCode: number | null; restantes: number }[];
};

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const inputCls =
  "rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

export function CosturaView({ itens }: { itens: CosturaRow[] }) {
  const router = useRouter();
  const [aba, setAba] = useState<"PENDENTES" | "CONCLUIDAS">("PENDENTES");
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [msg, setMsg] = useState<{ key: string; texto: string; tom: "ok" | "aviso" } | null>(null);

  // agrupa por SKU: modelo · cor · tamanho (independente do corte de origem)
  const grupos = useMemo(() => {
    const map = new Map<string, Grupo>();
    for (const i of itens) {
      const key = `${norm(i.productName)}|${norm(i.color)}|${norm(i.size)}`;
      const g =
        map.get(key) ??
        ({
          key,
          productName: i.productName,
          color: i.color,
          size: i.size,
          cortadas: 0,
          montadas: 0,
          restantes: 0,
          lotes: [],
        } as Grupo);
      g.cortadas += i.cutPieces;
      g.montadas += i.donePieces;
      const r = i.cutPieces - i.donePieces;
      g.restantes += r;
      if (r > 0) g.lotes.push({ cutCode: i.cutCode, restantes: r });
      map.set(key, g);
    }
    return [...map.values()];
  }, [itens]);

  const pendentes = grupos.filter((g) => g.restantes > 0);
  const concluidas = grupos.filter((g) => g.restantes === 0);
  const lista = aba === "PENDENTES" ? pendentes : concluidas;

  async function lancar(g: Grupo) {
    const n = parseInt(qtd[g.key] ?? "", 10);
    if (!(n > 0)) return;
    setBusyKey(g.key);
    setMsg(null);
    const res = await fetch("/api/producao/costura/lancar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: g.productName,
        color: g.color,
        size: g.size,
        pieces: n,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusyKey("");
    if (res.ok) {
      setMsg({
        key: g.key,
        texto: d.destino
          ? `✅ ${d.lancadas} peça(s) no estoque de ${d.destino} — restam ${d.restamNaCostura} na costura. Loja online atualizada junto.`
          : `⚠️ ${d.aviso}`,
        tom: d.destino ? "ok" : "aviso",
      });
      setQtd((q) => ({ ...q, [g.key]: "" }));
      router.refresh();
    } else {
      setMsg({ key: g.key, texto: d.error ?? "Não foi possível lançar.", tom: "aviso" });
    }
  }

  const [saldoAberto, setSaldoAberto] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-1.5">
          {(["PENDENTES", "CONCLUIDAS"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setAba(t)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition ${
                aba === t
                  ? "bg-brand-600 border-brand-600 text-white"
                  : "bg-white border-gray-200 text-gray-500 hover:border-brand-300"
              }`}
            >
              {t === "PENDENTES"
                ? `Aguardando montagem (${pendentes.length})`
                : `Concluídos (${concluidas.length})`}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSaldoAberto(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition"
          title="Lote que não veio de um corte registrado (implantação, facção, corte sem registro...)"
        >
          <PackagePlus className="size-3.5" />
          Lançar lote avulso
        </button>
      </div>

      {saldoAberto && <SaldoAntigoModal onClose={() => setSaldoAberto(false)} />}

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Shirt />}
            title={aba === "PENDENTES" ? "Nada aguardando montagem" : "Nenhum SKU concluído ainda"}
            hint="As peças chegam aqui automaticamente quando um corte registra produção."
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {lista.map((g) => (
            <div key={g.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold text-gray-800">
                  {g.productName}
                  {g.color && <span className="text-gray-500 font-normal"> · {g.color}</span>}
                  {g.size && <span className="text-gray-500 font-normal"> · {g.size}</span>}
                </p>
                {g.restantes > 0 ? (
                  <span className="rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold px-3 py-1">
                    {g.restantes} na costura
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold px-3 py-1">
                    concluído ✓
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mt-1">
                <span>Cortadas: <b className="text-gray-700">{g.cortadas}</b></span>
                <span>Montadas: <b className="text-emerald-700">{g.montadas}</b></span>
                {g.lotes.length > 0 && (
                  <span className="text-gray-400">
                    {g.lotes
                      .map(
                        (l) =>
                          `${l.cutCode != null ? `corte #${String(l.cutCode).padStart(6, "0")}` : "lote avulso"} ×${l.restantes}`
                      )
                      .join(" · ")}
                  </span>
                )}
              </div>
              {g.restantes > 0 && (
                <div className="flex items-center gap-2 mt-2.5">
                  <input
                    value={qtd[g.key] ?? ""}
                    onChange={(e) => setQtd((q) => ({ ...q, [g.key]: e.target.value }))}
                    inputMode="numeric"
                    placeholder="Qtd do dia"
                    className={inputCls + " w-28"}
                  />
                  <button
                    onClick={() => lancar(g)}
                    disabled={busyKey === g.key}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3.5 py-2 transition disabled:opacity-50"
                  >
                    {busyKey === g.key ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    Lançar prontas no estoque
                  </button>
                </div>
              )}
              {msg?.key === g.key && (
                <p
                  className={`text-xs rounded-lg px-3 py-2 mt-2 ${
                    msg.tom === "ok" ? "text-emerald-700 bg-emerald-50" : "text-amber-800 bg-amber-50"
                  }`}
                >
                  {msg.texto}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Lote avulso: peças que não vieram de um corte registrado (implantação,
 * facção, corte sem registro) entram aqui e seguem o fluxo normal.
 */
function SaldoAntigoModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ productName: "", color: "", size: "", pieces: "" });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");
  const [adicionados, setAdicionados] = useState<string[]>([]);

  const n = parseInt(f.pieces, 10);
  const ok = f.productName.trim() && n > 0;

  async function salvar() {
    setSalvando(true);
    setMsg("");
    const res = await fetch("/api/producao/costura", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: f.productName.trim(),
        color: f.color.trim() || null,
        size: f.size.trim() || null,
        pieces: n,
      }),
    });
    setSalvando(false);
    if (res.ok) {
      setAdicionados((a) => [
        ...a,
        `${f.productName.trim()}${f.color ? ` · ${f.color.trim()}` : ""}${f.size ? ` · ${f.size.trim()}` : ""} ×${n}`,
      ]);
      // mantém modelo/cor pra facilitar o lançamento em série (só troca tam/qtd)
      setF((x) => ({ ...x, size: "", pieces: "" }));
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error ?? "Não foi possível salvar.");
    }
  }

  const cls =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] flex flex-col">
        <div className="flex items-center justify-between p-5 pb-3 border-b border-gray-100">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <PackagePlus className="size-5 text-brand-600" />
            Lote avulso na costura
          </h3>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll p-5 pt-4 space-y-3">
          <p className="text-xs text-gray-500 leading-snug">
            Lote que <b>não veio de um corte registrado</b> — implantação, peças
            de facção/terceirizada ou corte feito sem registro. Entra no
            estoque de costura e segue o fluxo normal: montou e conferiu, é
            só lançar.
          </p>
          <label className="block text-xs font-medium text-gray-600">
            Modelo
            <input value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} placeholder="Baby Look" className={cls + " mt-1"} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-gray-600">
              Cor
              <input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} placeholder="Branco" className={cls + " mt-1"} />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Tamanho
              <input value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder="P" className={cls + " mt-1"} />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Quantidade
              <input value={f.pieces} onChange={(e) => setF({ ...f, pieces: e.target.value })} inputMode="numeric" placeholder="30" className={cls + " mt-1"} />
            </label>
          </div>
          {adicionados.length > 0 && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2.5">
              <p className="text-[11px] font-bold text-emerald-800 mb-1">Adicionados agora:</p>
              <ul className="text-xs text-emerald-900 space-y-0.5">
                {adicionados.map((a, i) => (
                  <li key={i}>✓ {a}</li>
                ))}
              </ul>
            </div>
          )}
          {msg && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{msg}</p>}
          <button
            onClick={salvar}
            disabled={salvando || !ok}
            className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
          >
            {salvando ? <Loader2 className="size-4 animate-spin inline" /> : "Lançar na costura"}
          </button>
          <p className="text-[10.5px] text-gray-400 text-center">
            O formulário continua aberto pra você lançar vários tamanhos em sequência.
          </p>
        </div>
      </div>
    </div>
  );
}
