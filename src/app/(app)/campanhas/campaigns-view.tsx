"use client";

import { useEffect, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Users, X, Send, Check, MessageCircle } from "lucide-react";
import type { SegmentFilter } from "@/lib/segments";
import { customerTypeLabel, brl, formatPhone } from "@/lib/format";
import { normalizePhone } from "@/lib/telefone";
import { personalizarCampanha } from "@/lib/campanha-mensagem";
import { GRUPOS_RFM, ehGrupoRfm, grupoRfm, modeloDeCampanhaDoGrupo, type GrupoRfm } from "@/lib/bi/rfm-regra";
import { Card, Badge, EmptyState } from "@/components/ui";

export type CampaignItem = {
  id: string;
  name: string;
  message: string;
  status: "RASCUNHO" | "ATIVA" | "CONCLUIDA";
  filter: SegmentFilter;
  /** null = o público não é mostrado (ver `bloqueio`) */
  reach: number | null;
  /** RN-098: "papel"/"bi" = campanha pelo grupo do RFM fechada para quem vê; "ilegivel" = o filtro salvo não se lê */
  bloqueio: null | "papel" | "bi" | "ilegivel";
  createdAt: string;
};

const statusColor: Record<CampaignItem["status"], string> = {
  RASCUNHO: "#64748b",
  ATIVA: "#059669",
  CONCLUIDA: "#c4622d",
};
const statusLabel: Record<CampaignItem["status"], string> = {
  RASCUNHO: "Rascunho",
  ATIVA: "Ativa",
  CONCLUIDA: "Concluída",
};

function describeFilter(f: SegmentFilter): string[] {
  const parts: string[] = [];
  if (f.inactiveDays) parts.push(`Sem compra há ${f.inactiveDays}+ dias`);
  if (f.type) parts.push(customerTypeLabel[f.type]);
  if (f.city) parts.push(`Cidade: ${f.city}`);
  if (f.minSpent) parts.push(`Gastou ${brl(f.minSpent)}+`);
  if (f.interest) parts.push(`Interesse: ${f.interest}`);
  if (f.tag) parts.push(`Tag: ${f.tag}`);
  if (f.lostDeals) parts.push("Abandonou negociação");
  if (ehGrupoRfm(f.rfmGrupo)) {
    const g = grupoRfm(f.rfmGrupo);
    parts.push(`RFM: ${g.emoji} ${g.rotulo}`);
  }
  return parts.length ? parts : ["Todos os clientes"];
}

export function CampaignsView({
  campaigns,
  tags,
  interests,
  rfmLiberado,
  abrirComRfm,
  linkDoCatalogo,
}: {
  campaigns: CampaignItem[];
  tags: string[];
  interests: string[];
  rfmLiberado: boolean;
  /** o atalho do BI (RN-098): abre a janela com este grupo já escolhido */
  abrirComRfm: GrupoRfm | null;
  linkDoCatalogo: string;
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(abrirComRfm != null);
  const [sending, setSending] = useState<CampaignItem | null>(null);

  return (
    <>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
        >
          <Plus className="size-4" />
          Nova campanha
        </button>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Megaphone />}
            title="Nenhuma campanha ainda"
            hint="Crie uma campanha para reativar clientes inativos ou divulgar lançamentos."
            action={
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
              >
                <Plus className="size-4" />
                Criar primeira campanha
              </button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold">{c.name}</h3>
                    <Badge color={statusColor[c.status]}>
                      {statusLabel[c.status]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {describeFilter(c.filter).map((p) => (
                      <span
                        key={p}
                        className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-3 py-2 italic">
                    &ldquo;{c.message}&rdquo;
                  </p>
                </div>
                <div className="shrink-0 flex sm:flex-col items-center gap-2">
                  {c.reach == null ? (
                    <div className="text-center bg-gray-50 rounded-xl px-4 py-3 max-w-[11rem]">
                      <p className="text-[11px] text-gray-500 leading-snug">
                        {c.bloqueio === "ilegivel"
                          ? "O filtro desta campanha não se lê — crie a campanha de novo."
                          : c.bloqueio === "bi"
                            ? "Usa o grupo do RFM, e o BI de Vendas está desligado nesta loja."
                            : "Usa o grupo do RFM — só a gerência vê o público e dispara."}
                      </p>
                    </div>
                  ) : (
                  <div className="text-center bg-brand-50 rounded-xl px-4 py-3">
                    <p className="flex items-center gap-1 justify-center text-brand-700">
                      <Users className="size-4" />
                      <span className="text-xl font-semibold tabular-nums">
                        {c.reach}
                      </span>
                    </p>
                    <p className="text-[11px] text-brand-600">
                      cliente{c.reach === 1 ? "" : "s"} no alvo
                    </p>
                  </div>
                  )}
                  {c.status !== "CONCLUIDA" && c.reach != null && c.reach > 0 && (
                    <button
                      onClick={() => setSending(c)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 transition"
                    >
                      <Send className="size-3.5" />
                      Disparar
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {sending && (
        <SendCampaignModal
          campaign={sending}
          onClose={() => {
            setSending(null);
            router.refresh();
          }}
        />
      )}

      {showNew && (
        <NewCampaignModal
          tags={tags}
          interests={interests}
          rfmLiberado={rfmLiberado}
          grupoInicial={abrirComRfm}
          linkDoCatalogo={linkDoCatalogo}
          onClose={() => {
            setShowNew(false);
            // o atalho do BI não reabre a janela num recarregar
            if (abrirComRfm) router.replace("/campanhas", { scroll: false });
          }}
          onCreated={() => {
            setShowNew(false);
            // trocar o endereço já traz a lista nova; recarregar de novo
            // refaria o público de toda campanha duas vezes
            if (abrirComRfm) router.replace("/campanhas", { scroll: false });
            else router.refresh();
          }}
        />
      )}
    </>
  );
}

function NewCampaignModal({
  tags,
  interests,
  rfmLiberado,
  grupoInicial,
  linkDoCatalogo,
  onClose,
  onCreated,
}: {
  tags: string[];
  interests: string[];
  rfmLiberado: boolean;
  grupoInicial: GrupoRfm | null;
  linkDoCatalogo: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [filter, setFilter] = useState<SegmentFilter>(grupoInicial ? { rfmGrupo: grupoInicial } : {});
  const nomeDoGrupo = (g: GrupoRfm) => `RFM · ${grupoRfm(g).rotulo}`;
  const [name, setName] = useState(grupoInicial ? nomeDoGrupo(grupoInicial) : "");
  const [message, setMessage] = useState(grupoInicial ? modeloDeCampanhaDoGrupo(grupoInicial, linkDoCatalogo) : "");
  // a mensagem pronta do grupo só entra enquanto ninguém mexeu no texto
  const [mensagemDoGrupo, setMensagemDoGrupo] = useState(grupoInicial != null);
  const [erro, setErro] = useState<string | null>(null);

  function escolherGrupo(g: GrupoRfm | undefined) {
    setFilter((f) => ({ ...f, rfmGrupo: g }));
    // o nome sugerido acompanha o grupo (o digitado pela pessoa fica)
    if (!name.trim() || GRUPOS_RFM.some((x) => name === nomeDoGrupo(x.id))) setName(g ? nomeDoGrupo(g) : "");
    if (mensagemDoGrupo || !message.trim()) {
      setMessage(g ? modeloDeCampanhaDoGrupo(g, linkDoCatalogo) : "");
      setMensagemDoGrupo(g != null);
    }
  }
  const [preview, setPreview] = useState<{
    count: number;
    sample: { id: string; name: string; phone: string; totalSpent: number }[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // pré-visualização ao vivo do alcance do filtro
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch("/api/campaigns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filter),
      });
      if (res.ok) setPreview(await res.json());
      else setPreview({ count: 0, sample: [] });
    }, 300);
    return () => clearTimeout(t);
  }, [filter]);

  async function submit(status: "RASCUNHO" | "ATIVA") {
    if (!name || !message) return;
    setSaving(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, message, filter, status }),
    });
    setSaving(false);
    if (res.ok) onCreated();
    else setErro((await res.json().catch(() => null))?.error ?? "Não deu para salvar a campanha.");
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)] translate-y-[var(--kbtop,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-6 animate-fade-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-lg">Nova campanha</h3>
          <button type="button" onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div>
              <label className={label}>Nome da campanha *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={input}
                placeholder="Ex.: Reativação 60 dias"
              />
            </div>

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1">
              Filtros de segmentação
            </p>

            {rfmLiberado && (
              <div>
                <label className={label}>Grupo do RFM</label>
                <select
                  value={filter.rfmGrupo ?? ""}
                  onChange={(e) => escolherGrupo((e.target.value || undefined) as GrupoRfm | undefined)}
                  className={`${input} bg-white`}
                >
                  <option value="">Qualquer grupo</option>
                  {GRUPOS_RFM.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.emoji} {g.rotulo}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  O grupo é o de HOJE, como no BI: quem muda de grupo entra ou sai do público sozinha.
                  {filter.rfmGrupo && <> Ação sugerida: {grupoRfm(filter.rfmGrupo).acao}.</>}
                </p>
              </div>
            )}

            <div>
              <label className={label}>Sem compra há</label>
              <div className="flex gap-1.5">
                {[undefined, 30, 60, 90].map((d) => (
                  <button
                    key={d ?? "all"}
                    type="button"
                    onClick={() => setFilter((f) => ({ ...f, inactiveDays: d }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      filter.inactiveDays === d
                        ? "bg-brand-600 text-white"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {d ? `${d}+ dias` : "Qualquer"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Tipo de cliente</label>
                <select
                  value={filter.type ?? ""}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      type: (e.target.value || undefined) as SegmentFilter["type"],
                    }))
                  }
                  className={`${input} bg-white`}
                >
                  <option value="">Todos</option>
                  {Object.entries(customerTypeLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Cidade</label>
                <input
                  value={filter.city ?? ""}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      city: e.target.value || undefined,
                    }))
                  }
                  className={input}
                  placeholder="Qualquer"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Interesse</label>
                <select
                  value={filter.interest ?? ""}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      interest: e.target.value || undefined,
                    }))
                  }
                  className={`${input} bg-white`}
                >
                  <option value="">Qualquer</option>
                  {interests.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>Tag</label>
                <select
                  value={filter.tag ?? ""}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      tag: e.target.value || undefined,
                    }))
                  }
                  className={`${input} bg-white`}
                >
                  <option value="">Qualquer</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Gastou pelo menos (R$)</label>
                <input
                  inputMode="numeric"
                  value={filter.minSpent ?? ""}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      minSpent: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    }))
                  }
                  className={input}
                  placeholder="Qualquer valor"
                />
              </div>
              <label className="flex items-end gap-2 pb-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={filter.lostDeals ?? false}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      lostDeals: e.target.checked || undefined,
                    }))
                  }
                  className="size-4 accent-brand-600"
                />
                Abandonou negociação
              </label>
            </div>

            <div>
              <label className={label}>Mensagem da campanha *</label>
              <textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setMensagemDoGrupo(false);
                }}
                rows={filter.rfmGrupo ? 6 : 3}
                className={input}
                placeholder="Oi {{nome}}, sentimos sua falta! ..."
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Use {"{{nome}}"} para personalizar com o nome do cliente.
              </p>
            </div>
          </div>

          {/* preview do alcance */}
          <div className="rounded-2xl bg-gray-50 p-4 flex flex-col">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Alcance da campanha
            </p>
            <p className="text-3xl font-semibold text-brand-700 tabular-nums">
              {preview?.count ?? "—"}
            </p>
            <p className="text-xs text-gray-500 mb-4">clientes atingidos</p>
            <div className="flex-1 space-y-2 overflow-y-auto thin-scroll">
              {preview?.sample.map((c) => (
                <div
                  key={c.id}
                  className="bg-white rounded-xl px-3 py-2 text-xs flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-gray-400">{formatPhone(c.phone)}</p>
                  </div>
                  <span className="text-emerald-600 font-medium tabular-nums shrink-0">
                    {brl(c.totalSpent)}
                  </span>
                </div>
              ))}
              {preview && preview.count > preview.sample.length && (
                <p className="text-[11px] text-gray-400 text-center">
                  + {preview.count - preview.sample.length} outros
                </p>
              )}
            </div>
            {erro && <p className="text-xs text-red-600 mt-3">{erro}</p>}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => submit("RASCUNHO")}
                disabled={saving || !name || !message}
                className="flex-1 rounded-xl border border-gray-200 bg-white hover:border-brand-300 text-gray-600 text-xs font-medium py-2.5 transition disabled:opacity-50"
              >
                Salvar rascunho
              </button>
              <button
                onClick={() => submit("ATIVA")}
                disabled={saving || !name || !message}
                className="flex-1 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium py-2.5 transition disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Ativar campanha"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div></Portal>
  );
}

/* ============================================================
   Disparo da campanha: lista o público-alvo, abre o WhatsApp com a
   mensagem personalizada ({{nome}} → primeiro nome) e marca quem já
   recebeu. Quando todos recebem, a campanha vira Concluída sozinha.
   ============================================================ */

type AudienceRow = { id: string; name: string; phone: string; sent: boolean };

function SendCampaignModal({
  campaign,
  onClose,
}: {
  campaign: CampaignItem;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AudienceRow[]>([]);
  const [message, setMessage] = useState(campaign.message);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/campaigns/${campaign.id}/audience`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.customers);
        setMessage(data.message);
      }
      setLoading(false);
    })();
  }, [campaign.id]);

  // "Oi {{nome}}!" vira "Oi Maria!" — ou "Oi!" para o crachá provisório
  const personalize = (name: string) => personalizarCampanha(message, name);

  // o número com o DDI pela régua da casa: número de fora não ganha 55 (RN-096)
  const waLink = (r: AudienceRow) =>
    `https://wa.me/${normalizePhone(r.phone)}?text=${encodeURIComponent(personalize(r.name))}`;

  async function markSent(r: AudienceRow) {
    setRows((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, sent: true } : x))
    );
    await fetch(`/api/campaigns/${campaign.id}/audience`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: r.id }),
    });
  }

  const sent = rows.filter((r) => r.sent).length;
  const pending = rows.filter((r) => !r.sent);
  const done = rows.length > 0 && sent === rows.length;

  return (
    <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)] translate-y-[var(--kbtop,0px)]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-lg p-6 animate-fade-up max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-lg">{campaign.name}</h3>
          <button onClick={onClose} className="text-gray-400 p-1">
            <X className="size-5" />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Toque no botão verde: o WhatsApp abre com a mensagem pronta (com o
          nome da pessoa) e o cliente fica marcado como enviado.
        </p>

        {/* progresso */}
        <div className="mb-4">
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className={`font-semibold ${done ? "text-emerald-600" : "text-gray-600"}`}>
              {done ? "🎉 Campanha concluída!" : `${sent} de ${rows.length} enviados`}
            </span>
            <span className="text-gray-400 tabular-nums">
              {rows.length ? Math.round((sent / rows.length) * 100) : 0}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${rows.length ? (sent / rows.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll -mx-2 px-2">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Carregando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Nenhum cliente no alvo desta campanha.
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {[...pending, ...rows.filter((r) => r.sent)].map((r) => {
                const noPhone = r.phone.replace(/\D/g, "").length < 10;
                return (
                  <li key={r.id} className="py-2.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium truncate ${r.sent ? "text-gray-400 line-through" : ""}`}>
                        {r.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {noPhone ? "sem telefone cadastrado" : formatPhone(r.phone)}
                      </p>
                    </div>
                    {r.sent ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <Check className="size-3.5" /> enviado
                      </span>
                    ) : (
                      <a
                        href={noPhone ? undefined : waLink(r)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => !noPhone && markSent(r)}
                        aria-disabled={noPhone}
                        className={`inline-flex items-center gap-1.5 rounded-xl text-xs font-semibold px-3 py-2 transition ${
                          noPhone
                            ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                            : "bg-emerald-600 hover:bg-emerald-700 text-white"
                        }`}
                      >
                        <MessageCircle className="size-3.5" />
                        Enviar
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div></Portal>
  );
}
