"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Store,
  Plus,
  UserRound,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  X,
  KeyRound,
  LogIn,
} from "lucide-react";
import { Button, Card, Field, inputCls, EmptyState, Badge } from "@/components/ui";

export type Loja = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  admin: { name: string; email: string } | null;
  users: number;
  customers: number;
  orders: number;
  // WhatsApp sem API: comprovante do aceite do termo + estado da conexão
  waConsent: {
    userName: string;
    userEmail: string;
    acceptedAt: string;
    ip: string;
    termVersion: string;
  } | null;
  waStatus: string;
  waPhone: string | null;
  productionEnabled: boolean;
};

type Created = {
  companyName: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
};

function genPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function LojasView({ initial, catalogDomain }: { initial: Loja[]; catalogDomain: string | null }) {
  const router = useRouter();
  const [lojas, setLojas] = useState<Loja[]>(initial);
  const [showForm, setShowForm] = useState(initial.length === 0);
  const [created, setCreated] = useState<Created | null>(null);

  function onCreated(loja: Loja, cred: Created) {
    setLojas((l) => [loja, ...l]);
    setCreated(cred);
    setShowForm(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {created && <CredentialsPanel cred={created} catalogDomain={catalogDomain} onClose={() => setCreated(null)} />}

      {!showForm && (
        <div className="flex justify-end">
          <Button onClick={() => setShowForm(true)}>
            <Plus className="size-4" />
            Nova loja
          </Button>
        </div>
      )}

      {showForm && (
        <NewLojaForm
          onCancel={initial.length === 0 && lojas.length === 0 ? undefined : () => setShowForm(false)}
          onCreated={onCreated}
        />
      )}

      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Lojas cadastradas
          </h2>
          <Badge>{lojas.length}</Badge>
        </div>

        {lojas.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Store />}
              title="Nenhuma loja cadastrada ainda"
              hint="Use o formulário acima para provisionar sua primeira loja cliente."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {lojas.map((l) => (
              <LojaCard key={l.id} loja={l} catalogDomain={catalogDomain} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------- formulário nova loja */

function NewLojaForm({
  onCreated,
  onCancel,
}: {
  onCreated: (loja: Loja, cred: Created) => void;
  onCancel?: () => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState(genPassword());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const valid =
    companyName.trim().length >= 2 &&
    adminName.trim().length >= 2 &&
    /^\S+@\S+\.\S+$/.test(adminEmail) &&
    adminPassword.length >= 6;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          tagline,
          whatsapp,
          adminName,
          adminEmail,
          adminPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível cadastrar a loja.");
        return;
      }
      onCreated(
        {
          id: data.companyId,
          name: companyName.trim(),
          slug: data.slug,
          createdAt: new Date().toISOString(),
          admin: { name: adminName.trim(), email: data.adminEmail },
          users: 1,
          customers: 0,
          orders: 0,
          waConsent: null,
          waStatus: "DESCONECTADO",
          waPhone: null,
          productionEnabled: false,
        },
        {
          companyName: companyName.trim(),
          slug: data.slug,
          adminEmail: data.adminEmail,
          adminPassword,
        }
      );
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <Store className="size-5" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">
                Nova loja
              </h3>
              <p className="text-xs text-slate-500">
                Cria a loja com funil, cores e tamanhos padrão + login de admin.
              </p>
            </div>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cancelar"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Nome da loja">
              <input
                className={inputCls}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex.: Bella Moda"
                autoFocus
              />
            </Field>
          </div>
          <Field label="Slogan (opcional)" hint="Aparece no catálogo geral.">
            <input
              className={inputCls}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Moda que veste sua história"
            />
          </Field>
          <Field label="WhatsApp da loja (opcional)" hint="Número do catálogo geral.">
            <input
              className={inputCls}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 99999-9999"
              inputMode="tel"
            />
          </Field>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <div className="mb-3 flex items-center gap-2 text-slate-700">
            <UserRound className="size-4 text-brand-500" />
            <span className="text-sm font-medium">Administrador da loja</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do responsável">
              <input
                className={inputCls}
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Ex.: Ana Souza"
              />
            </Field>
            <Field label="E-mail de acesso">
              <input
                className={inputCls}
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="ana@bellamoda.com.br"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Senha inicial" hint="Entregue à loja; ela poderá alterar depois.">
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAdminPassword(genPassword())}
                    title="Gerar senha"
                  >
                    <RefreshCw className="size-4" />
                    Gerar
                  </Button>
                </div>
              </Field>
            </div>
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={!valid || saving}>
            {saving ? "Criando…" : "Criar loja"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ---------------------------------------------------- painel de credenciais */

function CredentialsPanel({
  cred,
  catalogDomain,
  onClose,
}: {
  cred: Created;
  catalogDomain: string | null;
  onClose: () => void;
}) {
  const loginUrl =
    typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  const summary = `Loja: ${cred.companyName}
Acesso: ${loginUrl}
E-mail: ${cred.adminEmail}
Senha: ${cred.adminPassword}`;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 sm:p-6 shadow-card animate-scale-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200">
            <Check className="size-5" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-emerald-900">
              Loja “{cred.companyName}” criada!
            </h3>
            <p className="text-xs text-emerald-700/80">
              Entregue estas credenciais ao responsável. Guarde a senha: ela não
              será exibida novamente.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="grid size-8 place-items-center rounded-lg text-emerald-600/70 hover:bg-emerald-100"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <CredItem label="Acesso" value={loginUrl} mono />
        <CredItem label="E-mail" value={cred.adminEmail} mono />
        <CredItem
          label="Senha inicial"
          value={cred.adminPassword}
          mono
          icon={<KeyRound className="size-3.5" />}
        />
        <CredItem label="Catálogo geral" value={catalogDomain ? `${catalogDomain}/${cred.slug}` : `/catalogo/${cred.slug}`} mono />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <CopyButton text={summary} label="Copiar credenciais" />
        <a
          href="/login"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
        >
          <ExternalLink className="size-3.5" />
          Abrir tela de login
        </a>
      </div>
    </div>
  );
}

function CredItem({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white px-3.5 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-emerald-600/80">
        {icon}
        {label}
      </p>
      <p className={`mt-0.5 truncate text-sm text-slate-800 ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      /* clipboard indisponível */
    }
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copiado!" : label}
    </button>
  );
}

/* ---------------------------------------------------- card de loja */

function LojaCard({ loja, catalogDomain }: { loja: Loja; catalogDomain: string | null }) {
  const router = useRouter();
  const [accessing, setAccessing] = useState(false);
  const [producao, setProducao] = useState(loja.productionEnabled);
  const [togglingProd, setTogglingProd] = useState(false);

  // módulo Produção (pago à parte): o Super Admin liga/desliga por loja
  async function toggleProducao() {
    setTogglingProd(true);
    const res = await fetch("/api/companies/production", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: loja.id, enabled: !producao }),
    });
    setTogglingProd(false);
    if (res.ok) {
      setProducao(!producao);
      router.refresh();
    }
  }

  async function access() {
    setAccessing(true);
    try {
      const res = await fetch("/api/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: loja.id }),
      });
      if (!res.ok) {
        setAccessing(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setAccessing(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-white">
            <Store className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{loja.name}</p>
            <p className="truncate text-xs text-slate-400">{catalogDomain ? `${catalogDomain}/${loja.slug}` : `/${loja.slug}`}</p>
          </div>
        </div>
        <a
          href={catalogDomain ? `https://${catalogDomain}/${loja.slug}` : `/catalogo/${loja.slug}`}
          target="_blank"
          rel="noreferrer"
          title="Ver catálogo geral"
          className="shrink-0 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      {loja.admin && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-slate-500">
          <span className="truncate">
            <span className="text-slate-400">Admin:</span> {loja.admin.email}
          </span>
          <button
            type="button"
            onClick={async () => {
              const login = window.prompt(
                `Novo login de acesso do admin da ${loja.name}\n(e-mail ou usuário simples, ex.: maria):`,
                loja.admin?.email ?? ""
              );
              if (!login?.trim()) return;
              const password =
                window.prompt(
                  "Nova senha (opcional — deixe em branco para manter a atual):"
                ) || undefined;
              const res = await fetch("/api/companies/admin-login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId: loja.id, login: login.trim(), password }),
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok) {
                window.alert(
                  `Login atualizado: ${data.login}${data.passwordChanged ? " (senha alterada)" : ""}\nInforme o lojista.`
                );
                router.refresh();
              } else {
                window.alert(data.error ?? "Não foi possível alterar o login.");
              }
            }}
            className="shrink-0 text-[11px] font-medium text-brand-600 hover:text-brand-700 underline underline-offset-2"
          >
            Trocar login
          </button>
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span><b className="text-slate-700 tabular-nums">{loja.users}</b> usuários</span>
        <span><b className="text-slate-700 tabular-nums">{loja.customers}</b> clientes</span>
        <span><b className="text-slate-700 tabular-nums">{loja.orders}</b> pedidos</span>
      </div>

      {/* comprovante do termo do WhatsApp sem API (registro permanente) */}
      <p
        className="mt-2 text-[11px] leading-snug text-slate-400"
        title={
          loja.waConsent
            ? `IP ${loja.waConsent.ip} · termo v${loja.waConsent.termVersion} · ${loja.waConsent.userEmail}`
            : undefined
        }
      >
        WhatsApp sem API:{" "}
        {loja.waConsent ? (
          <>
            <span className={loja.waStatus === "CONECTADO" ? "text-emerald-600 font-semibold" : "text-slate-500"}>
              {loja.waStatus === "CONECTADO"
                ? `conectado${loja.waPhone ? ` (${loja.waPhone})` : ""}`
                : "desconectado"}
            </span>{" "}
            · termo aceito por {loja.waConsent.userName} em{" "}
            {new Date(loja.waConsent.acceptedAt).toLocaleString("pt-BR", {
              day: "2-digit", month: "2-digit", year: "2-digit",
              hour: "2-digit", minute: "2-digit",
            })}
          </>
        ) : (
          "termo não aceito"
        )}
      </p>

      {/* módulo Produção (pago à parte) */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-400">
          Módulo Produção:{" "}
          <b className={producao ? "text-emerald-600" : "text-slate-500"}>
            {producao ? "ativado" : "desativado"}
          </b>
        </span>
        <button
          type="button"
          onClick={toggleProducao}
          disabled={togglingProd}
          className={`rounded-full px-2.5 py-1 font-semibold border transition disabled:opacity-50 ${
            producao
              ? "border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600"
              : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
        >
          {togglingProd ? "..." : producao ? "Desativar" : "Ativar Produção"}
        </button>
      </div>

      <Button
        onClick={access}
        disabled={accessing}
        size="sm"
        className="mt-4 w-full"
      >
        <LogIn className="size-4" />
        {accessing ? "Entrando…" : "Acessar loja"}
      </Button>
    </Card>
  );
}
