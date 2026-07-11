"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Users, X } from "lucide-react";
import type { SegmentFilter } from "@/lib/segments";
import { customerTypeLabel, brl, formatPhone } from "@/lib/format";
import { Card, Badge, EmptyState } from "@/components/ui";

export type CampaignItem = {
  id: string;
  name: string;
  message: string;
  status: "RASCUNHO" | "ATIVA" | "CONCLUIDA";
  filter: SegmentFilter;
  reach: number;
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
  return parts.length ? parts : ["Todos os clientes"];
}

export function CampaignsView({
  campaigns,
  tags,
  interests,
}: {
  campaigns: CampaignItem[];
  tags: string[];
  interests: string[];
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);

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
                <div className="shrink-0 text-center bg-brand-50 rounded-xl px-4 py-3">
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
              </div>
            </Card>
          ))}
        </div>
      )}

      {showNew && (
        <NewCampaignModal
          tags={tags}
          interests={interests}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function NewCampaignModal({
  tags,
  interests,
  onClose,
  onCreated,
}: {
  tags: string[];
  interests: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [filter, setFilter] = useState<SegmentFilter>({});
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
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
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[92dvh] overflow-y-auto thin-scroll p-6 animate-fade-up">
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
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
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
    </div>
  );
}
