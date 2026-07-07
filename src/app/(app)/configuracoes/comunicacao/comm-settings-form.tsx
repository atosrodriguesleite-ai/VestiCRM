"use client";

import { useEffect, useState } from "react";
import { Lock, ShieldCheck, History } from "lucide-react";
import { Card, Badge, EmptyState } from "@/components/ui";
import { dateShort, timeShort } from "@/lib/format";

type Settings = Record<string, string | number | null>;
type Audit = {
  id: string;
  userName: string;
  action: string;
  fields: string;
  createdAt: string;
};

const GROUPS: {
  title: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string; numeric?: boolean }[];
}[] = [
  {
    title: "Meta / WhatsApp Cloud API",
    fields: [
      { key: "metaAppId", label: "Meta App ID", placeholder: "123456789012345", numeric: true },
      { key: "metaAppSecret", label: "Meta App Secret", secret: true },
      { key: "businessManagerId", label: "Business Manager ID" },
      { key: "phoneNumberId", label: "Phone Number ID", placeholder: "109876543210987", numeric: true },
      { key: "verifyToken", label: "Verify Token (webhook)", secret: true },
      { key: "accessToken", label: "Access Token", secret: true },
      { key: "webhookSecret", label: "Webhook Secret", secret: true },
    ],
  },
  {
    title: "Instagram e Facebook",
    fields: [
      { key: "instagramAccountId", label: "Instagram Account ID" },
      { key: "facebookPageId", label: "Facebook Page ID" },
    ],
  },
  {
    title: "Telegram",
    fields: [{ key: "telegramBotToken", label: "Bot Token", secret: true }],
  },
  {
    title: "E-mail (SMTP)",
    fields: [
      { key: "smtpHost", label: "Servidor SMTP", placeholder: "smtp.sualoja.com.br" },
      { key: "smtpPort", label: "Porta", placeholder: "587", numeric: true },
      { key: "smtpUser", label: "Usuário" },
      { key: "smtpPassword", label: "Senha", secret: true },
    ],
  },
];

export function CommSettingsForm() {
  const [settings, setSettings] = useState<Settings>({});
  const [audits, setAudits] = useState<Audit[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("MOCK");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch("/api/comm/settings");
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings);
      setProvider(data.settings.activeProvider ?? "MOCK");
      setAudits(data.audits);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = { activeProvider: provider };
    for (const [key, value] of Object.entries(edits)) {
      if (value === "") continue;
      body[key] = key === "smtpPort" ? parseInt(value) || null : value;
    }
    const res = await fetch("/api/comm/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setMessage({ ok: true, text: "Credenciais salvas com segurança (criptografadas)." });
      setEdits({});
      load();
    } else {
      setMessage({ ok: false, text: data.error ?? "Erro ao salvar" });
    }
  }

  const input =
    "w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 transition font-mono";

  if (loading) {
    return <Card className="p-8 text-center text-sm text-gray-400">Carregando...</Card>;
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <h2 className="font-semibold">Provider ativo do WhatsApp</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Troque para Cloud API quando as credenciais oficiais estiverem
              preenchidas. Nenhuma tela precisa mudar.
            </p>
          </div>
          <div className="flex gap-1.5">
            {(["MOCK", "CLOUD_API"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                  provider === p
                    ? "bg-brand-600 text-white"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
                }`}
              >
                {p === "MOCK" ? "Mock (simulado)" : "WhatsApp Cloud API"}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {GROUPS.map((group) => (
        <Card key={group.title} className="p-5">
          <h2 className="font-semibold mb-4">{group.title}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {group.fields.map((f) => {
              const stored = settings[f.key];
              return (
                <div key={f.key}>
                  <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
                    {f.secret && <Lock className="size-3 text-gray-400" />}
                    {f.label}
                    {stored && (
                      <Badge color="#059669">preenchido</Badge>
                    )}
                  </label>
                  <input
                    value={edits[f.key] ?? ""}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={
                      stored ? String(stored) : (f.placeholder ?? "Não configurado")
                    }
                    inputMode={f.numeric ? "numeric" : undefined}
                    type={f.secret ? "password" : "text"}
                    autoComplete="off"
                    className={input}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      {message && (
        <p
          className={`text-sm rounded-xl px-4 py-2.5 ${
            message.ok
              ? "text-emerald-700 bg-emerald-50"
              : "text-rose-600 bg-rose-50"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-6 py-2.5 transition disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar credenciais"}
        </button>
        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-emerald-600" />
          Valores sensíveis são criptografados (AES-256-GCM) e nunca voltam
          inteiros ao navegador.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <History className="size-4 text-brand-600" />
          Auditoria de credenciais
        </h2>
        {audits.length === 0 ? (
          <EmptyState title="Nenhuma alteração registrada" />
        ) : (
          <ul className="divide-y divide-gray-50">
            {audits.map((a) => (
              <li key={a.id} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="font-medium shrink-0">{a.userName}</span>
                <span className="text-gray-500 flex-1 truncate">
                  {a.action} — <span className="font-mono text-xs">{a.fields}</span>
                </span>
                <span className="text-xs text-gray-400 tabular-nums shrink-0">
                  {dateShort(a.createdAt)} {timeShort(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
