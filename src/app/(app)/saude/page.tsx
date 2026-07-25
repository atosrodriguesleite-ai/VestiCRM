import { redirect } from "next/navigation";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
  Bug,
  Server,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { evolutionEnv } from "@/lib/comm/evolution";
import { Card, PageHeader } from "@/components/ui";
import { dateShort, timeShort } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Saúde do sistema (só Super Admin): servidor de WhatsApp, conexão de cada
 * loja e os últimos erros de produção capturados pelo vigia.
 */
export default async function HealthPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const h24 = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [health, storesRaw, errors, errors24] = await Promise.all([
    db.systemHealth.findUnique({ where: { id: "main" } }),
    db.commSettings.findMany({
      where: { evolutionInstance: { not: null } },
      select: {
        companyId: true,
        evolutionStatus: true,
        evolutionPhone: true,
        evolutionDownSince: true,
      },
      orderBy: { companyId: "asc" },
    }),
    db.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.errorLog.count({ where: { createdAt: { gte: h24 } } }),
  ]);
  const companies = await db.company.findMany({
    where: { id: { in: storesRaw.map((s) => s.companyId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const stores = storesRaw.map((s) => ({
    ...s,
    companyName: nameById.get(s.companyId) ?? s.companyId,
  }));

  const serverOk = health ? health.evolutionOk : true;
  const conectadas = stores.filter((s) => s.evolutionStatus === "CONECTADO").length;
  const caidas = stores.filter((s) => s.evolutionStatus !== "CONECTADO").length;

  const fmt = (d: Date) => `${dateShort(d.toISOString())} ${timeShort(d.toISOString())}`;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Saúde do sistema"
        subtitle="Vigia da plataforma: servidor de WhatsApp, conexões das lojas e erros de produção."
      />

      {/* visão geral */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <Server className="size-3" /> Servidor WhatsApp
          </p>
          <p
            className={`mt-1 text-lg font-bold flex items-center gap-1.5 ${
              serverOk ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {serverOk ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
            {serverOk ? "No ar" : "FORA DO AR"}
          </p>
          {!serverOk && health?.evolutionDownSince && (
            <p className="text-xs text-rose-500 mt-0.5">desde {fmt(health.evolutionDownSince)}</p>
          )}
          {!evolutionEnv().configured && (
            <p className="text-xs text-amber-600 mt-0.5">EVOLUTION_URL/KEY não configurados</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <MessageCircle className="size-3" /> Lojas conectadas
          </p>
          <p className="mt-1 text-lg font-bold text-emerald-600">{conectadas}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <AlertTriangle className="size-3" /> Lojas desconectadas
          </p>
          <p className={`mt-1 text-lg font-bold ${caidas > 0 ? "text-rose-600" : "text-gray-400"}`}>
            {caidas}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <Bug className="size-3" /> Erros (24h)
          </p>
          <p className={`mt-1 text-lg font-bold ${errors24 > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            {errors24}
          </p>
          {health?.watchdogRunAt && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              vigia rodou {fmt(health.watchdogRunAt)}
            </p>
          )}
        </Card>
      </div>

      {/* conexões por loja */}
      <Card className="p-5 mb-6">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <MessageCircle className="size-4 text-emerald-600" />
          WhatsApp por loja
        </h2>
        {stores.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma loja conectou WhatsApp ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {stores.map((s) => {
              const ok = s.evolutionStatus === "CONECTADO";
              return (
                <div
                  key={s.companyId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{s.companyName}</p>
                    <p className="text-xs text-gray-400">
                      {s.evolutionPhone ?? "—"}
                      {!ok && s.evolutionDownSince ? ` · caiu ${fmt(s.evolutionDownSince)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-full text-xs font-semibold px-3 py-1 ${
                      ok
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-rose-50 text-rose-600 border border-rose-200"
                    }`}
                  >
                    {ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                    {ok ? "Conectado" : s.evolutionStatus === "AGUARDANDO_QR" ? "Aguardando QR" : "Desconectado"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* últimos erros */}
      <Card className="p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Activity className="size-4 text-brand-600" />
          Últimos erros de produção
        </h2>
        {errors.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
            <CheckCircle2 className="size-4" />
            Nenhum erro registrado. Céu limpo! ☀️
          </p>
        ) : (
          <div className="space-y-1.5">
            {errors.map((e) => (
              <details
                key={e.id}
                className="rounded-xl border border-gray-100 px-3.5 py-2.5 open:bg-gray-50/60"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium truncate">{e.message}</p>
                    <span className="shrink-0 text-[11px] text-gray-400">{fmt(e.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {e.source}
                    {e.path ? ` · ${e.path}` : ""}
                  </p>
                </summary>
                {e.detail && (
                  <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-gray-900 text-gray-100 text-[11px] p-3 max-h-48 overflow-y-auto thin-scroll">
                    {e.detail}
                  </pre>
                )}
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
