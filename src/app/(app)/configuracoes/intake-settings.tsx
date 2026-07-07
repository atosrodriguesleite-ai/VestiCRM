"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import { originLabel } from "@/lib/format";
import { Card } from "@/components/ui";
import type { Origin } from "@prisma/client";

type Props = {
  canEdit: boolean;
  sellers: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  initial: {
    distribution: string;
    defaultUserId: string | null;
    slaMinutes: number;
    oppPolicy: string;
    rules: Partial<Record<Origin, string | null>>;
  };
};

const ORIGINS = Object.keys(originLabel) as Origin[];

/** Configuração da Central de Entrada de Leads (Lead Intake Engine). */
export function IntakeSettings({ canEdit, sellers, stages, initial }: Props) {
  const router = useRouter();
  const [distribution, setDistribution] = useState(initial.distribution);
  const [defaultUserId, setDefaultUserId] = useState(initial.defaultUserId ?? "");
  const [slaMinutes, setSlaMinutes] = useState(String(initial.slaMinutes));
  const [oppPolicy, setOppPolicy] = useState(initial.oppPolicy);
  const [rules, setRules] = useState<Partial<Record<Origin, string | null>>>(
    initial.rules
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/intake-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        distribution,
        defaultUserId: distribution === "FIXED" ? defaultUserId || null : null,
        slaMinutes: parseInt(slaMinutes) || 60,
        oppPolicy,
        rules: ORIGINS.map((origin) => ({
          origin,
          stageId: rules[origin] ?? null,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    }
  }

  const select =
    "w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white outline-none focus:border-brand-400 transition disabled:bg-gray-50 disabled:text-gray-400";
  const label = "block text-sm font-medium mb-1.5";

  return (
    <Card className="p-5">
      <p className="text-sm text-gray-500 flex items-start gap-2 mb-5">
        <Inbox className="size-4 text-brand-600 shrink-0 mt-0.5" />
        Todo novo contato — WhatsApp, catálogo, Instagram, site, ERP ou
        cadastro manual — passa pela mesma central: cria/reaproveita o
        cliente, abre a conversa, gera a oportunidade e a tarefa de primeiro
        atendimento. Nenhum lead se perde.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div>
          <label className={label}>Distribuição de novos leads</label>
          <select
            disabled={!canEdit}
            value={distribution}
            onChange={(e) => setDistribution(e.target.value)}
            className={select}
          >
            <option value="ROUND_ROBIN">Rodízio entre vendedores</option>
            <option value="FIXED">Vendedor fixo</option>
          </select>
        </div>
        <div>
          <label className={label}>Vendedor fixo</label>
          <select
            disabled={!canEdit || distribution !== "FIXED"}
            value={defaultUserId}
            onChange={(e) => setDefaultUserId(e.target.value)}
            className={select}
          >
            <option value="">Selecione...</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>SLA do 1º atendimento (min)</label>
          <input
            disabled={!canEdit}
            value={slaMinutes}
            onChange={(e) => setSlaMinutes(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            className={select}
          />
        </div>
        <div>
          <label className={label}>Nova oportunidade</label>
          <select
            disabled={!canEdit}
            value={oppPolicy}
            onChange={(e) => setOppPolicy(e.target.value)}
            className={select}
          >
            <option value="SE_NAO_HOUVER_ABERTA">
              Só se não houver negociação aberta
            </option>
            <option value="SEMPRE">Sempre criar</option>
            <option value="NUNCA">Nunca criar automaticamente</option>
          </select>
        </div>
      </div>

      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Etapa inicial do funil por origem
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {ORIGINS.map((origin) => (
          <div
            key={origin}
            className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2"
          >
            <span className="text-xs font-medium flex-1 truncate">
              {originLabel[origin]}
            </span>
            <select
              disabled={!canEdit}
              value={rules[origin] ?? ""}
              onChange={(e) =>
                setRules((r) => ({ ...r, [origin]: e.target.value || null }))
              }
              className="text-xs rounded-lg border border-gray-200 px-2 py-1.5 bg-white outline-none max-w-36 disabled:bg-gray-50"
            >
              <option value="">1ª etapa (padrão)</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {canEdit && (
        <button
          onClick={save}
          disabled={saving}
          className="mt-5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60"
        >
          {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar entrada de leads"}
        </button>
      )}
    </Card>
  );
}
