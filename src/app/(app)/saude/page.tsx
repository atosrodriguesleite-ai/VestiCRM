import { redirect } from "next/navigation";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
  Bug,
  Server,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  XCircle,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { evolutionEnv } from "@/lib/comm/evolution";
import { Card, PageHeader } from "@/components/ui";
import { dateShort, timeShort } from "@/lib/format";
import {
  diagnosticoLoja,
  vereditoGeral,
  taxaDeEntrega,
  silencioLabel,
  MINUTOS_PRESA,
  type NivelSaude,
} from "@/lib/health-wa";

export const dynamic = "force-dynamic";

/**
 * SAÚDE DO SISTEMA (Super Admin).
 *
 * A pergunta que esta tela responde não é "está conectado?" — é "está
 * FUNCIONANDO?". São coisas diferentes: a falha mais perigosa do WhatsApp é a
 * silenciosa, com a conexão de pé e nenhuma mensagem entrando porque o
 * webhook parou. Por isso o centro da tela é o TRÁFEGO REAL de cada loja:
 * quando chegou a última mensagem, quanto entrou e saiu, quanto foi entregue,
 * o que ficou preso e o que falhou.
 */

/** Estatísticas de mensagens por loja, direto do banco (uma consulta só). */
type LinhaTrafego = {
  companyId: string;
  recebidas24: bigint;
  enviadas24: bigint;
  entregues24: bigint;
  falhas24: bigint;
  presas: bigint;
  recebidas7d: bigint;
  ultima_recebida: Date | null;
  ultima_enviada: Date | null;
  total_recebidas: bigint;
};

export default async function HealthPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const agora = new Date();
  const h24 = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  const d7 = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const presaCorte = new Date(agora.getTime() - MINUTOS_PRESA * 60 * 1000);

  const [health, storesRaw, errors, errors24, errosWebhook24, trafego] = await Promise.all([
    db.systemHealth.findUnique({ where: { id: "main" } }),
    db.commSettings.findMany({
      where: { evolutionInstance: { not: null } },
      select: {
        companyId: true,
        evolutionStatus: true,
        evolutionPhone: true,
        evolutionDownSince: true,
      },
    }),
    db.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.errorLog.count({ where: { createdAt: { gte: h24 } } }),
    // erro ao GRAVAR mensagem recebida: o mais grave de todos, porque é
    // conversa de cliente que a loja nunca vai ver
    db.errorLog.count({ where: { source: "wa.webhook", createdAt: { gte: h24 } } }),
    // uma consulta só para o tráfego de todas as lojas (notas internas fora)
    db.$queryRaw<LinhaTrafego[]>`
      SELECT cv."companyId",
        COUNT(*) FILTER (WHERE m.direction = 'IN'  AND m."createdAt" >= ${h24}) AS recebidas24,
        COUNT(*) FILTER (WHERE m.direction = 'OUT' AND m."createdAt" >= ${h24}) AS enviadas24,
        COUNT(*) FILTER (WHERE m.direction = 'OUT' AND m."deliveredAt" IS NOT NULL AND m."createdAt" >= ${h24}) AS entregues24,
        COUNT(*) FILTER (WHERE m.direction = 'OUT' AND m.status = 'FALHOU' AND m."createdAt" >= ${h24}) AS falhas24,
        COUNT(*) FILTER (WHERE m.direction = 'OUT' AND m.status = 'ENVIANDO' AND m."createdAt" < ${presaCorte}) AS presas,
        COUNT(*) FILTER (WHERE m.direction = 'IN'  AND m."createdAt" >= ${d7}) AS recebidas7d,
        MAX(m."createdAt") FILTER (WHERE m.direction = 'IN')  AS ultima_recebida,
        MAX(m."createdAt") FILTER (WHERE m.direction = 'OUT') AS ultima_enviada,
        COUNT(*) FILTER (WHERE m.direction = 'IN') AS total_recebidas
      FROM "Message" m
      JOIN "Conversation" cv ON cv.id = m."conversationId"
      WHERE m.kind <> 'NOTE'
      GROUP BY cv."companyId"
    `,
  ]);

  const companies = await db.company.findMany({
    where: { id: { in: storesRaw.map((s) => s.companyId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const trafegoBy = new Map(trafego.map((t) => [t.companyId, t]));
  const n = (v: bigint | null | undefined) => Number(v ?? 0);

  const lojas = storesRaw
    .map((s) => {
      const t = trafegoBy.get(s.companyId);
      const conectado = s.evolutionStatus === "CONECTADO";
      const ultimaRecebida = t?.ultima_recebida ?? null;
      const diag = diagnosticoLoja(
        {
          conectado,
          ultimaRecebida,
          presas: n(t?.presas),
          falhas24: n(t?.falhas24),
          jaTeveTrafego: n(t?.total_recebidas) > 0,
        },
        agora
      );
      return {
        id: s.companyId,
        nome: nameById.get(s.companyId) ?? s.companyId,
        telefone: s.evolutionPhone,
        conectado,
        status: s.evolutionStatus,
        caiuEm: s.evolutionDownSince,
        recebidas24: n(t?.recebidas24),
        enviadas24: n(t?.enviadas24),
        entregues24: n(t?.entregues24),
        falhas24: n(t?.falhas24),
        presas: n(t?.presas),
        recebidas7d: n(t?.recebidas7d),
        ultimaRecebida,
        ultimaEnviada: t?.ultima_enviada ?? null,
        diag,
      };
    })
    // pior primeiro: quem precisa de ação aparece em cima
    .sort((a, b) => {
      const peso = (x: NivelSaude) => (x === "CRITICO" ? 0 : x === "ATENCAO" ? 1 : 2);
      return peso(a.diag.nivel) - peso(b.diag.nivel) || a.nome.localeCompare(b.nome);
    });

  const serverOk = health ? health.evolutionOk : true;
  const veredito = vereditoGeral({
    servidorOk: serverOk,
    lojas: lojas.map((l) => l.diag),
    errosWebhook24,
  });

  const fmt = (d: Date) => `${dateShort(d.toISOString())} ${timeShort(d.toISOString())}`;
  const desde = (d: Date | null) =>
    d ? silencioLabel((agora.getTime() - d.getTime()) / 3_600_000) : null;

  const tomNivel: Record<NivelSaude, string> = {
    OK: "border-emerald-200 bg-emerald-50 text-emerald-800",
    ATENCAO: "border-amber-200 bg-amber-50 text-amber-800",
    CRITICO: "border-rose-200 bg-rose-50 text-rose-800",
  };
  const pontoNivel: Record<NivelSaude, string> = {
    OK: "bg-emerald-500",
    ATENCAO: "bg-amber-500",
    CRITICO: "bg-rose-500",
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Saúde do sistema"
        subtitle="A pergunta aqui não é “está conectado?”, é “está funcionando?”. O que prova isso é mensagem chegando."
      />

      {/* ---- VEREDITO: a resposta de um olhar ---- */}
      <div className={`mb-6 rounded-2xl border p-4 ${tomNivel[veredito.nivel]}`}>
        <p className="flex items-center gap-2 text-lg font-bold">
          {veredito.nivel === "OK" ? (
            <>
              <CheckCircle2 className="size-5" /> Tudo funcionando
            </>
          ) : veredito.nivel === "ATENCAO" ? (
            <>
              <AlertTriangle className="size-5" /> Precisa de atenção
            </>
          ) : (
            <>
              <XCircle className="size-5" /> Tem coisa quebrada
            </>
          )}
        </p>
        {veredito.problemas.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {veredito.problemas.map((p, i) => (
              <li key={i}>• {p}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm">
            Servidor no ar, lojas conectadas e recebendo mensagens, nenhuma falha registrada.
          </p>
        )}
      </div>

      {/* ---- Números da plataforma ---- */}
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
            <ArrowDownLeft className="size-3" /> Recebidas (24h)
          </p>
          <p className="mt-1 text-lg font-bold text-slate-800">
            {lojas.reduce((s, l) => s + l.recebidas24, 0)}
          </p>
          <p className="text-[11px] text-gray-400">
            {lojas.reduce((s, l) => s + l.recebidas7d, 0)} em 7 dias
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <ArrowUpRight className="size-3" /> Enviadas (24h)
          </p>
          <p className="mt-1 text-lg font-bold text-slate-800">
            {lojas.reduce((s, l) => s + l.enviadas24, 0)}
          </p>
          {(() => {
            const env = lojas.reduce((s, l) => s + l.enviadas24, 0);
            const ent = lojas.reduce((s, l) => s + l.entregues24, 0);
            const taxa = taxaDeEntrega(env, ent);
            return (
              <p className="text-[11px] text-gray-400">
                {taxa === null ? "sem envios no período" : `${taxa}% confirmadas como entregues`}
              </p>
            );
          })()}
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1">
            <Bug className="size-3" /> Erros (24h)
          </p>
          <p
            className={`mt-1 text-lg font-bold ${errors24 > 0 ? "text-amber-600" : "text-emerald-600"}`}
          >
            {errors24}
          </p>
          {errosWebhook24 > 0 ? (
            <p className="text-[11px] font-semibold text-rose-600">
              {errosWebhook24} ao gravar mensagem recebida
            </p>
          ) : (
            health?.watchdogRunAt && (
              <p className="text-[11px] text-gray-400">vigia rodou {fmt(health.watchdogRunAt)}</p>
            )
          )}
        </Card>
      </div>

      {/* ---- O coração: tráfego real de cada loja ---- */}
      <Card className="p-5 mb-6">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <MessageCircle className="size-4 text-emerald-600" />
          WhatsApp loja por loja
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Conexão de pé com nada entrando é o defeito mais perigoso — por isso a última mensagem
          recebida está em destaque.
        </p>
        {lojas.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma loja conectou WhatsApp ainda.</p>
        ) : (
          <div className="space-y-2">
            {lojas.map((l) => {
              const taxa = taxaDeEntrega(l.enviadas24, l.entregues24);
              return (
                <div
                  key={l.id}
                  className={`rounded-xl border p-3.5 ${
                    l.diag.nivel === "OK" ? "border-gray-100" : tomNivel[l.diag.nivel]
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`size-2.5 shrink-0 rounded-full ${pontoNivel[l.diag.nivel]}`} />
                    <p className="font-semibold text-slate-900">{l.nome}</p>
                    <span className="text-xs text-gray-400">{l.telefone ?? "sem número"}</span>
                    <span
                      className={`ml-auto shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        l.conectado
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-rose-200 bg-rose-50 text-rose-600"
                      }`}
                    >
                      {l.conectado
                        ? "Conectado"
                        : l.status === "AGUARDANDO_QR"
                          ? "Aguardando QR"
                          : `Desconectado${l.caiuEm ? ` há ${desde(l.caiuEm)}` : ""}`}
                    </span>
                  </div>

                  {/* números do dia a dia */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">
                        Última recebida
                      </p>
                      <p className="text-sm font-semibold text-slate-800">
                        {l.ultimaRecebida ? `há ${desde(l.ultimaRecebida)}` : "nunca"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">
                        Último envio
                      </p>
                      <p className="text-sm font-semibold text-slate-800">
                        {l.ultimaEnviada ? `há ${desde(l.ultimaEnviada)}` : "nunca"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">
                        Recebidas 24h
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-slate-800">
                        {l.recebidas24}
                        <span className="ml-1 text-[10px] font-normal text-gray-400">
                          {l.recebidas7d} em 7d
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">
                        Enviadas 24h
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-slate-800">
                        {l.enviadas24}
                        {taxa !== null && (
                          <span className="ml-1 text-[10px] font-normal text-gray-400">
                            {taxa}% entregues
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Problemas</p>
                      <p className="text-sm font-semibold tabular-nums">
                        {l.presas + l.falhas24 === 0 ? (
                          <span className="text-emerald-600">nenhum</span>
                        ) : (
                          <span className="text-rose-600">
                            {l.presas > 0 && (
                              <>
                                <Clock className="mr-0.5 inline size-3" />
                                {l.presas} presa(s){" "}
                              </>
                            )}
                            {l.falhas24 > 0 && <>{l.falhas24} falha(s)</>}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* o que fazer */}
                  {l.diag.nivel !== "OK" && (
                    <ul className="mt-2 space-y-0.5 border-t border-black/5 pt-2 text-xs">
                      {l.diag.problemas.map((p, i) => (
                        <li key={i}>• {p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ---- Erros ---- */}
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
                className={`rounded-xl border px-3.5 py-2.5 open:bg-gray-50/60 ${
                  e.source === "wa.webhook" ? "border-rose-200 bg-rose-50/40" : "border-gray-100"
                }`}
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium truncate">{e.message}</p>
                    <span className="shrink-0 text-[11px] text-gray-400">{fmt(e.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {e.source === "wa.webhook" ? (
                      <b className="text-rose-600">mensagem do WhatsApp não gravada</b>
                    ) : (
                      e.source
                    )}
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
