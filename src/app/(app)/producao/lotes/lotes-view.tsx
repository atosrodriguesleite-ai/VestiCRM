"use client";

/**
 * Lotes de costura — o romaneio rastreável: peças saem do estoque de
 * costura pra costura interna ou facção, com etiqueta (A4/térmica) e
 * conferência de volta (parcial): boas → estoque real; defeito → estoque
 * de defeitos; faltante fica na conta da facção.
 */

import { useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Package, Printer, Plus, X } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";

export type PoolSku = {
  productName: string;
  color: string | null;
  size: string | null;
  disponivel: number;
};
export type FaccaoRow = { id: string; name: string; pricePerPiece: number };
export type DefeitoRow = {
  id: string;
  productName: string;
  color: string | null;
  size: string | null;
  pieces: number;
  status: string;
};
export type LoteRow = {
  id: string;
  code: number;
  kind: string;
  destination: string;
  factionName: string | null;
  status: string;
  sentAt: string;
  closedAt: string | null;
  notes: string | null;
  factionId: string | null;
  sentBy: string | null;
  receivedBy: string | null;
  dueBackDate: string | null;
  paymentStatus: string;
  dueDate: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  paymentNotes: string | null;
  valores: {
    previsto: number;
    aPagar: number;
    pago: number;
    saldo: number;
    pecasBoas: number;
    pecasEnviadas: number;
  };
  atrasado: boolean;
  pagamentoVencido: boolean;
  items: {
    id: string;
    productName: string;
    color: string | null;
    size: string | null;
    sent: number;
    good: number;
    defect: number;
    pricePerPiece: number;
  }[];
};

const fmtLote = (n: number) => `L-${String(n).padStart(6, "0")}`;
const fmtR$ = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
/** ISO → "aaaa-mm-dd" pro <input type="date"> (respeita o fuso local). */
const paraInputData = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};
/** "aaaa-mm-dd" → ISO no meio-dia local (evita virar o dia por fuso). */
const dataParaIso = (v: string) =>
  v ? new Date(`${v}T12:00:00`).toISOString() : null;
const STATUS: Record<string, { label: string; cls: string }> = {
  ENVIADO: { label: "Fora (enviado)", cls: "bg-sky-50 border-sky-200 text-sky-700" },
  PARCIAL: { label: "Voltando (parcial)", cls: "bg-amber-50 border-amber-200 text-amber-700" },
  FECHADO: { label: "Fechado", cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
};
const inputCls =
  "rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200";

export function LotesView({
  lotes,
  pool,
  faccoes,
  defeitos,
}: {
  lotes: LoteRow[];
  pool: PoolSku[];
  faccoes: FaccaoRow[];
  defeitos: DefeitoRow[];
}) {
  const [montar, setMontar] = useState(false);
  const [aberto, setAberto] = useState<LoteRow | null>(null);

  // painel de controle: o que se deve às facções e o que está atrasado
  const aPagar = lotes.reduce((a, l) => a + l.valores.saldo, 0);
  const pago = lotes.reduce((a, l) => a + l.valores.pago, 0);
  const atrasados = lotes.filter((l) => l.atrasado).length;
  const vencidos = lotes.filter((l) => l.pagamentoVencido).length;
  const temFinanceiro = aPagar > 0 || pago > 0 || atrasados > 0 || vencidos > 0;

  return (
    <div>
      {temFinanceiro && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
          <ResumoBox
            titulo="A pagar às facções"
            valor={fmtR$(aPagar)}
            dica="peças boas que voltaram e ainda não foram pagas"
            cor={aPagar > 0 ? "text-amber-700" : "text-emerald-700"}
          />
          <ResumoBox titulo="Já pago" valor={fmtR$(pago)} dica="lotes quitados" cor="text-emerald-700" />
          <ResumoBox
            titulo="Lotes atrasados"
            valor={String(atrasados)}
            dica="passaram do prazo combinado de volta"
            cor={atrasados > 0 ? "text-rose-600" : "text-gray-400"}
          />
          <ResumoBox
            titulo="Pagamentos vencidos"
            valor={String(vencidos)}
            dica="a previsão de pagamento já passou"
            cor={vencidos > 0 ? "text-rose-600" : "text-gray-400"}
          />
        </div>
      )}

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setMontar(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
        >
          <Plus className="size-4" />
          Montar lote
        </button>
      </div>

      {lotes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package />}
            title="Nenhum lote ainda"
            hint="Monte um lote com as peças do estoque de costura e envie pra costura interna ou facção."
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {lotes.map((l) => {
            const st = STATUS[l.status] ?? STATUS.ENVIADO;
            const enviadas = l.items.reduce((a, i) => a + i.sent, 0);
            const boas = l.items.reduce((a, i) => a + i.good, 0);
            const def = l.items.reduce((a, i) => a + i.defect, 0);
            const fora = enviadas - boas - def;
            return (
              <button
                key={l.id}
                onClick={() => setAberto(l)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 hover:border-brand-200 shadow-sm p-4 transition"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-sm text-gray-800">{fmtLote(l.code)}</span>
                    {l.kind === "CONSERTO" && (
                      <span className="rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-[11px] font-semibold px-2.5 py-0.5">
                        conserto
                      </span>
                    )}
                    <span className={`rounded-full border text-[11px] font-semibold px-2.5 py-0.5 ${st.cls}`}>
                      {st.label}
                    </span>
                    {l.atrasado && (
                      <span className="rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-semibold px-2.5 py-0.5">
                        atrasado
                      </span>
                    )}
                    {l.destination === "FACCAO" && l.valores.aPagar > 0 && (
                      <span
                        className={`rounded-full border text-[11px] font-semibold px-2.5 py-0.5 ${
                          l.paymentStatus === "PAGO"
                            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                            : l.pagamentoVencido
                              ? "bg-rose-50 border-rose-200 text-rose-700"
                              : "bg-amber-50 border-amber-200 text-amber-700"
                        }`}
                      >
                        {l.paymentStatus === "PAGO"
                          ? `pago ${fmtR$(l.valores.pago)}`
                          : `a pagar ${fmtR$(l.valores.saldo)}`}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(l.sentAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-1.5">
                  {l.destination === "FACCAO" ? (
                    <>Facção: <b>{l.factionName}</b></>
                  ) : (
                    <b>Costura interna</b>
                  )}
                </p>
                <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 mt-1">
                  <span>Enviadas: <b className="text-gray-700">{enviadas}</b></span>
                  <span>Boas: <b className="text-emerald-700">{boas}</b></span>
                  {def > 0 && <span>Defeito: <b className="text-amber-700">{def}</b></span>}
                  {l.status === "FECHADO" && fora > 0 ? (
                    <span className="text-rose-600 font-semibold">Faltaram: {fora}</span>
                  ) : (
                    fora > 0 && <span>Ainda fora: <b>{fora}</b></span>
                  )}
                </div>
                {(l.sentBy || l.receivedBy || l.dueBackDate) && (
                  <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-400 mt-1">
                    {l.sentBy && <span>Enviou: {l.sentBy}</span>}
                    {l.receivedBy && <span>Recebeu: {l.receivedBy}</span>}
                    {l.dueBackDate && l.status !== "FECHADO" && (
                      <span className={l.atrasado ? "text-rose-600 font-semibold" : ""}>
                        Volta prevista: {fmtData(l.dueBackDate)}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* peças com defeito */}
      {defeitos.length > 0 && (
        <DefeitosCard defeitos={defeitos} />
      )}

      {montar && <MontarLoteModal pool={pool} faccoes={faccoes} defeitos={defeitos} onClose={() => setMontar(false)} />}
      {aberto && <LoteModal lote={aberto} faccoes={faccoes} onClose={() => setAberto(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------ defeitos */

function DefeitosCard({ defeitos }: { defeitos: DefeitoRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  async function marca(id: string, status: string) {
    setBusyId(id);
    await fetch(`/api/producao/defeitos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId("");
    router.refresh();
  }
  return (
    <Card className="p-4 mt-6">
      <h3 className="text-sm font-semibold mb-2">🩹 Peças com defeito</h3>
      <div className="space-y-1.5">
        {defeitos.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 text-xs text-gray-600 flex-wrap">
            <span>
              <b>{d.productName}</b>
              {d.color && ` · ${d.color}`}
              {d.size && ` · ${d.size}`} — {d.pieces} peça(s) ·{" "}
              {d.status === "EM_CONSERTO" ? (
                <span className="text-purple-700 font-semibold">em conserto</span>
              ) : (
                <span className="text-amber-700 font-semibold">aguardando decisão</span>
              )}
            </span>
            {d.status === "AGUARDANDO" && (
              <span className="flex gap-1.5">
                <button
                  onClick={() => marca(d.id, "DESCARTADA")}
                  disabled={busyId === d.id}
                  className="rounded-lg border border-gray-200 hover:border-rose-300 hover:text-rose-600 px-2 py-1 transition disabled:opacity-50"
                >
                  Descartar
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10.5px] text-gray-400 mt-2">
        Pra consertar: monte um lote do tipo <b>conserto</b> — ele puxa daqui e,
        quando voltar boa, a peça entra no estoque real.
      </p>
    </Card>
  );
}

/* --------------------------------------------------------- montar lote */

function MontarLoteModal({
  pool,
  faccoes,
  defeitos,
  onClose,
}: {
  pool: PoolSku[];
  faccoes: FaccaoRow[];
  defeitos: DefeitoRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"COSTURA" | "CONSERTO">("COSTURA");
  const [destino, setDestino] = useState<"INTERNA" | "FACCAO">(faccoes.length ? "FACCAO" : "INTERNA");
  const [factionId, setFactionId] = useState(faccoes[0]?.id ?? "");
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [sentBy, setSentBy] = useState("");
  const [dueBack, setDueBack] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // fonte: pool da costura ou defeitos aguardando (conserto)
  const fonte: PoolSku[] =
    kind === "COSTURA"
      ? pool
      : Object.values(
          defeitos
            .filter((d) => d.status === "AGUARDANDO")
            .reduce((acc, d) => {
              const k = `${d.productName}|${d.color}|${d.size}`;
              acc[k] = acc[k] ?? { productName: d.productName, color: d.color, size: d.size, disponivel: 0 };
              acc[k].disponivel += d.pieces;
              return acc;
            }, {} as Record<string, PoolSku>)
        );

  const itens = fonte
    .map((p, i) => ({ ...p, pieces: parseInt(qtd[String(i)] ?? "", 10) || 0 }))
    .filter((p) => p.pieces > 0);
  const total = itens.reduce((a, i) => a + i.pieces, 0);

  async function salvar() {
    setSalvando(true);
    setErro("");
    const res = await fetch("/api/producao/lotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        destination: destino,
        factionId: destino === "FACCAO" ? factionId : null,
        notes: obs || null,
        sentBy: sentBy.trim() || null,
        dueBackDate: dataParaIso(dueBack),
        items: itens.map((i) => ({
          productName: i.productName,
          color: i.color,
          size: i.size,
          pieces: i.pieces,
        })),
      }),
    });
    setSalvando(false);
    if (res.ok) {
      const d = await res.json();
      onClose();
      router.refresh();
      // abre a etiqueta já na sequência (impressão em 1 toque)
      window.open(`/etiqueta/lote/${d.id}`, "_blank");
    } else {
      const d = await res.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível montar o lote.");
    }
  }

  return (
    <ModalBase titulo="Montar lote" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-gray-600">
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value as "COSTURA" | "CONSERTO")} className={inputCls + " w-full mt-1"}>
              <option value="COSTURA">Costura</option>
              <option value="CONSERTO">Conserto (defeitos)</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Destino
            <select
              value={destino === "FACCAO" ? factionId : "INTERNA"}
              onChange={(e) => {
                if (e.target.value === "INTERNA") setDestino("INTERNA");
                else {
                  setDestino("FACCAO");
                  setFactionId(e.target.value);
                }
              }}
              className={inputCls + " w-full mt-1"}
            >
              <option value="INTERNA">Costura interna</option>
              {faccoes.map((f) => (
                <option key={f.id} value={f.id}>
                  Facção: {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {faccoes.length === 0 && (
          <p className="text-[11px] text-gray-400">
            Facções são cadastradas em Configurações da Produção.
          </p>
        )}

        <div>
          <p className="text-xs font-medium text-gray-600 mb-1.5">
            {kind === "COSTURA" ? "Peças do estoque de costura" : "Peças com defeito aguardando"}
          </p>
          {fonte.length === 0 ? (
            <p className="text-xs text-gray-400">Nada disponível nesta fonte.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto thin-scroll">
              {fonte.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                  <span className="min-w-0 truncate">
                    <b>{p.productName}</b>
                    {p.color && ` · ${p.color}`}
                    {p.size && ` · ${p.size}`}
                    <span className="text-gray-400"> — {p.disponivel} disp.</span>
                  </span>
                  <input
                    value={qtd[String(i)] ?? ""}
                    onChange={(e) => setQtd((q) => ({ ...q, [String(i)]: e.target.value }))}
                    inputMode="numeric"
                    placeholder="0"
                    className={inputCls + " w-20 shrink-0"}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Campo label="Responsável pelo envio">
            <input
              value={sentBy}
              onChange={(e) => setSentBy(e.target.value)}
              placeholder="quem está levando"
              className={inputCls + " w-full"}
            />
          </Campo>
          <Campo label="Volta combinada pra" dica="avisa quando atrasar">
            <input
              type="date"
              value={dueBack}
              onChange={(e) => setDueBack(e.target.value)}
              className={inputCls + " w-full"}
            />
          </Campo>
        </div>

        <input
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Observações (opcional)"
          className={inputCls + " w-full"}
        />
        {erro && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{erro}</p>}
        <button
          onClick={salvar}
          disabled={salvando || total === 0 || (destino === "FACCAO" && !factionId)}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
        >
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
          Enviar lote ({total} peça{total === 1 ? "" : "s"}) e abrir etiqueta
        </button>
      </div>
    </ModalBase>
  );
}

/* ------------------------------------------------------- detalhe do lote */

function LoteModal({
  lote: l,
  faccoes,
  onClose,
}: {
  lote: LoteRow;
  faccoes: FaccaoRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [volta, setVolta] = useState<Record<string, { good: string; defect: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function registrarVolta() {
    const items = l.items
      .map((i) => ({
        itemId: i.id,
        good: parseInt(volta[i.id]?.good ?? "", 10) || 0,
        defect: parseInt(volta[i.id]?.defect ?? "", 10) || 0,
      }))
      .filter((i) => i.good + i.defect > 0);
    if (items.length === 0) return;
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/producao/lotes/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "volta", items }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setMsg(d.error ?? "Não foi possível registrar a volta.");
    }
  }

  async function fechar() {
    const fora = l.items.reduce((a, i) => a + (i.sent - i.good - i.defect), 0);
    if (
      fora > 0 &&
      !window.confirm(`${fora} peça(s) não voltaram — fechar o lote e registrar como faltantes?`)
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/producao/lotes/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fechar" }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onClose();
    }
  }

  const st = STATUS[l.status] ?? STATUS.ENVIADO;

  return (
    <ModalBase
      titulo={`Lote ${fmtLote(l.code)}`}
      extra={
        <span className={`rounded-full border text-[11px] font-semibold px-2.5 py-0.5 ${st.cls}`}>
          {st.label}
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-3.5">
        <p className="text-sm text-gray-700">
          {l.destination === "FACCAO" ? <>Facção: <b>{l.factionName}</b></> : <b>Costura interna</b>}
          <span className="text-xs text-gray-400">
            {"  "}· enviado {fmtData(l.sentAt)}
            {l.closedAt && ` · recebido ${fmtData(l.closedAt)}`}
          </span>
        </p>

        <ControleLote lote={l} faccoes={faccoes} />

        <div className="flex gap-2">
          <a
            href={`/etiqueta/lote/${l.id}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition"
          >
            <Printer className="size-3.5" /> Etiqueta A4
          </a>
          <a
            href={`/etiqueta/lote/${l.id}?f=termica`}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition"
          >
            <Printer className="size-3.5" /> Etiqueta térmica 10×15
          </a>
        </div>

        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[10.5px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="text-left px-3 py-2">SKU</th>
                <th className="px-1.5 py-2">Env.</th>
                <th className="px-1.5 py-2">Boas</th>
                <th className="px-1.5 py-2">Def.</th>
                {l.status !== "FECHADO" && <th className="px-1.5 py-2">+Boas</th>}
                {l.status !== "FECHADO" && <th className="px-1.5 py-2 pr-3">+Def.</th>}
              </tr>
            </thead>
            <tbody>
              {l.items.map((i) => {
                const fora = i.sent - i.good - i.defect;
                return (
                  <tr key={i.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-700">
                      <b>{i.productName}</b>
                      {i.color && ` · ${i.color}`}
                      {i.size && ` · ${i.size}`}
                      {l.status === "FECHADO" && fora > 0 && (
                        <span className="text-rose-600 font-semibold"> · faltaram {fora}</span>
                      )}
                    </td>
                    <td className="text-center py-2 tabular-nums">{i.sent}</td>
                    <td className="text-center py-2 tabular-nums text-emerald-700">{i.good}</td>
                    <td className="text-center py-2 tabular-nums text-amber-700">{i.defect}</td>
                    {l.status !== "FECHADO" && (
                      <td className="text-center py-1.5">
                        <input
                          value={volta[i.id]?.good ?? ""}
                          onChange={(e) =>
                            setVolta((v) => ({ ...v, [i.id]: { good: e.target.value, defect: v[i.id]?.defect ?? "" } }))
                          }
                          inputMode="numeric"
                          placeholder={String(fora)}
                          className="w-12 rounded-lg border border-gray-200 px-1.5 py-1 text-center"
                        />
                      </td>
                    )}
                    {l.status !== "FECHADO" && (
                      <td className="text-center py-1.5 pr-2">
                        <input
                          value={volta[i.id]?.defect ?? ""}
                          onChange={(e) =>
                            setVolta((v) => ({ ...v, [i.id]: { good: v[i.id]?.good ?? "", defect: e.target.value } }))
                          }
                          inputMode="numeric"
                          placeholder="0"
                          className="w-12 rounded-lg border border-gray-200 px-1.5 py-1 text-center"
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {msg && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{msg}</p>}

        {l.status !== "FECHADO" && (
          <div className="flex gap-2">
            <button
              onClick={registrarVolta}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Registrar volta (boas entram no estoque)
            </button>
            <button
              onClick={fechar}
              disabled={busy}
              className="rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              Fechar lote
            </button>
          </div>
        )}
      </div>
    </ModalBase>
  );
}

/* ------------------------------------------- controle/edição do lote */

/**
 * Painel de controle do lote: datas de envio e recebimento, responsáveis,
 * prazo de devolução, custo por peça de CADA modelo (preço histórico deste
 * lote) e o pagamento da facção. Nada aqui mexe em peça ou estoque —
 * quantidade só muda registrando a volta.
 */
function ControleLote({ lote: l, faccoes }: { lote: LoteRow; faccoes: FaccaoRow[] }) {
  const router = useRouter();
  const [abrir, setAbrir] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  const [sentAt, setSentAt] = useState(paraInputData(l.sentAt));
  const [closedAt, setClosedAt] = useState(paraInputData(l.closedAt));
  const [sentBy, setSentBy] = useState(l.sentBy ?? "");
  const [receivedBy, setReceivedBy] = useState(l.receivedBy ?? "");
  const [dueBack, setDueBack] = useState(paraInputData(l.dueBackDate));
  const [factionId, setFactionId] = useState(l.factionId ?? "");
  const [pago, setPago] = useState(l.paymentStatus === "PAGO");
  const [dueDate, setDueDate] = useState(paraInputData(l.dueDate));
  const [paidAt, setPaidAt] = useState(paraInputData(l.paidAt));
  const [paidAmount, setPaidAmount] = useState(
    l.paidAmount != null ? String(l.paidAmount).replace(".", ",") : ""
  );
  const [payNotes, setPayNotes] = useState(l.paymentNotes ?? "");
  const [precos, setPrecos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      l.items.map((i) => [i.id, i.pricePerPiece > 0 ? String(i.pricePerPiece).replace(".", ",") : ""])
    )
  );

  const numero = (v: string) => parseFloat(v.replace(",", ".")) || 0;
  // prévia ao vivo do valor do lote com os preços digitados
  const aPagarPrevia = l.items.reduce((a, i) => a + i.good * numero(precos[i.id] ?? ""), 0);
  const previstoPrevia = l.items.reduce((a, i) => a + i.sent * numero(precos[i.id] ?? ""), 0);

  async function salvar() {
    setSalvando(true);
    setMsg("");
    const res = await fetch(`/api/producao/lotes/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "editar",
        sentAt: dataParaIso(sentAt),
        closedAt: dataParaIso(closedAt),
        sentBy: sentBy.trim() || null,
        receivedBy: receivedBy.trim() || null,
        dueBackDate: dataParaIso(dueBack),
        ...(l.destination === "FACCAO" ? { factionId: factionId || null } : {}),
        paymentStatus: pago ? "PAGO" : "PENDENTE",
        dueDate: dataParaIso(dueDate),
        paidAt: dataParaIso(paidAt),
        paidAmount: paidAmount.trim() ? numero(paidAmount) : null,
        paymentNotes: payNotes.trim() || null,
        precos: l.items.map((i) => ({
          itemId: i.id,
          pricePerPiece: numero(precos[i.id] ?? ""),
        })),
      }),
    });
    setSalvando(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      router.refresh();
      setAbrir(false);
    } else {
      setMsg(d.error ?? "Não foi possível salvar.");
    }
  }

  if (!abrir) {
    return (
      <div className="rounded-xl border border-gray-200 p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-gray-500 space-y-0.5">
            <p>
              Enviou: <b className="text-gray-700">{l.sentBy || "—"}</b> ·{" "}
              Recebeu: <b className="text-gray-700">{l.receivedBy || "—"}</b>
            </p>
            {l.destination === "FACCAO" && (
              <p>
                A pagar: <b className="text-amber-700">{fmtR$(l.valores.saldo)}</b>
                {l.valores.pago > 0 && (
                  <> · Pago: <b className="text-emerald-700">{fmtR$(l.valores.pago)}</b>
                    {l.paidAt && ` em ${fmtData(l.paidAt)}`}</>
                )}
                {l.paymentStatus !== "PAGO" && l.dueDate && (
                  <span className={l.pagamentoVencido ? "text-rose-600 font-semibold" : ""}>
                    {" "}· previsão {fmtData(l.dueDate)}
                  </span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={() => setAbrir(true)}
            className="rounded-xl border border-gray-200 hover:border-brand-300 hover:text-brand-700 text-gray-600 text-xs font-medium px-3 py-1.5 transition"
          >
            Editar controle
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-3.5 space-y-3">
      <p className="text-xs font-semibold text-gray-600">Controle do lote</p>

      <div className="grid grid-cols-2 gap-2.5">
        <Campo label="Data do envio">
          <input type="date" value={sentAt} onChange={(e) => setSentAt(e.target.value)} className={`${inputCls} w-full`} />
        </Campo>
        <Campo label="Data do recebimento">
          <input type="date" value={closedAt} onChange={(e) => setClosedAt(e.target.value)} className={`${inputCls} w-full`} />
        </Campo>
        <Campo label="Responsável pelo envio">
          <input value={sentBy} onChange={(e) => setSentBy(e.target.value)} placeholder="quem levou" className={`${inputCls} w-full`} />
        </Campo>
        <Campo label="Responsável pelo recebimento">
          <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="quem conferiu" className={`${inputCls} w-full`} />
        </Campo>
        <Campo label="Volta combinada pra" dica="usado no alerta de atraso">
          <input type="date" value={dueBack} onChange={(e) => setDueBack(e.target.value)} className={`${inputCls} w-full`} />
        </Campo>
        {l.destination === "FACCAO" && faccoes.length > 0 && (
          <Campo label="Facção">
            <select value={factionId} onChange={(e) => setFactionId(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">—</option>
              {faccoes.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </Campo>
        )}
      </div>

      {/* custo por peça de cada modelo */}
      <div>
        <p className="text-[11px] font-semibold text-gray-600 mb-1.5">
          Custo de costura por peça (deste lote)
        </p>
        <div className="space-y-1.5">
          {l.items.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-600 min-w-0 truncate">
                <b>{i.productName}</b>
                {i.color && ` · ${i.color}`}
                {i.size && ` · ${i.size}`}
                <span className="text-gray-400"> ({i.good}/{i.sent} boas)</span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-[11px] text-gray-400">R$</span>
                <input
                  value={precos[i.id] ?? ""}
                  onChange={(e) => setPrecos((p) => ({ ...p, [i.id]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right"
                />
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-1.5">
          Previsto (enviadas): <b>{fmtR$(previstoPrevia)}</b> · A pagar (boas):{" "}
          <b className="text-amber-700">{fmtR$(aPagarPrevia)}</b>
        </p>
      </div>

      {/* pagamento */}
      {l.destination === "FACCAO" && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={pago} onChange={(e) => setPago(e.target.checked)} className="size-4 accent-emerald-600" />
            <span className="text-sm font-medium text-gray-700">Facção já foi paga</span>
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            {pago ? (
              <>
                <Campo label="Data do pagamento">
                  <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={`${inputCls} w-full`} />
                </Campo>
                <Campo label="Valor pago" dica={`calculado: ${fmtR$(aPagarPrevia)}`}>
                  <input value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} inputMode="decimal" placeholder={aPagarPrevia.toFixed(2).replace(".", ",")} className={`${inputCls} w-full`} />
                </Campo>
              </>
            ) : (
              <Campo label="Previsão de pagamento">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} w-full`} />
              </Campo>
            )}
          </div>
          <Campo label="Observação do pagamento">
            <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Pix, dinheiro, parcelado..." className={`${inputCls} w-full`} />
          </Campo>
        </div>
      )}

      {msg && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{msg}</p>}

      <div className="flex gap-2">
        <button
          onClick={salvar}
          disabled={salvando}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2.5 transition disabled:opacity-50"
        >
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Salvar controle
        </button>
        <button
          onClick={() => setAbrir(false)}
          className="rounded-xl border border-gray-200 hover:border-gray-300 text-gray-500 text-xs font-medium px-3 py-2 transition"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Campo({
  label,
  dica,
  children,
}: {
  label: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-500 mb-1">{label}</span>
      {children}
      {dica && <span className="block text-[10.5px] text-gray-400 mt-0.5">{dica}</span>}
    </label>
  );
}

function ResumoBox({
  titulo,
  valor,
  dica,
  cor,
}: {
  titulo: string;
  valor: string;
  dica: string;
  cor: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{titulo}</p>
      <p className={`text-lg font-bold tabular-nums ${cor}`}>{valor}</p>
      <p className="text-[10.5px] text-gray-400 leading-tight mt-0.5">{dica}</p>
    </div>
  );
}

function ModalBase({
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
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-lg max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] md:max-h-[85dvh] flex flex-col">
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
    </div></Portal>
  );
}
