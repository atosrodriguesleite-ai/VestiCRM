"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  FlaskConical,
  Settings,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { dateShort, timeShort } from "@/lib/format";
import { lerEvento, resumoDoPeriodo } from "@/lib/comm/eventos";
import { Card, Badge, EmptyState } from "@/components/ui";
import { StatTile } from "@/components/charts";

export type CommEventItem = {
  id: string;
  channel: string;
  direction: string;
  type: string;
  status: string;
  payload: string | null;
  response: string | null;
  error: string | null;
  durationMs: number;
  attempts: number;
  createdAt: string;
};

const SCENARIOS: { key: string; label: string }[] = [
  { key: "received_text", label: "📩 Mensagem recebida" },
  { key: "received_image", label: "🖼️ Imagem recebida" },
  { key: "received_audio", label: "🎤 Áudio recebido" },
  { key: "received_document", label: "📎 Documento recebido" },
  { key: "sent_ok", label: "✅ Mensagem enviada" },
  { key: "sent_fail", label: "💥 Erro de envio" },
  { key: "status_delivered", label: "✔✔ Confirmação de entrega" },
  { key: "status_read", label: "👁️ Confirmação de leitura" },
  { key: "webhook_error", label: "⚠️ Webhook com erro" },
];

export function CommCenter({
  events,
  stats,
}: {
  events: CommEventItem[];
  stats: {
    received24: number;
    sent24: number;
    failed24: number;
    sending: number;
    avgLatency: number;
    provider: string;
  };
}) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "IN" | "OUT" | "ERRO">("ALL");

  async function simulate(scenario: string) {
    setRunning(scenario);
    setFeedback("");
    const res = await fetch("/api/comm/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    const data = await res.json().catch(() => ({}));
    setRunning(null);
    setFeedback(
      res.ok
        ? "Cenário executado — veja o evento no log abaixo e o efeito na central de WhatsApp."
        : data.error ?? "Erro ao simular"
    );
    router.refresh();
  }

  const visible = events.filter((e) => {
    if (filter === "ALL") return true;
    if (filter === "ERRO") return e.status === "ERRO";
    return e.direction === filter;
  });

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mb-6">
        <StatTile
          label="Recebidas (24h)"
          value={String(stats.received24)}
          icon={<ArrowDownLeft />}
        />
        <StatTile
          label="Enviadas (24h)"
          value={String(stats.sent24)}
          icon={<ArrowUpRight />}
        />
        <StatTile
          label="Falhas (24h)"
          value={String(stats.failed24)}
          tone={stats.failed24 > 0 ? "bad" : "good"}
        />
        <StatTile
          label="Na fila (enviando)"
          value={String(stats.sending)}
          tone={stats.sending > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Latência média"
          value={`${stats.avgLatency} ms`}
          icon={<Activity />}
        />
      </div>

      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h2 className="font-semibold flex items-center gap-2">
            <FlaskConical className="size-4 text-brand-600" />
            Simulador
          </h2>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Badge color={stats.provider === "MOCK" ? "#64748b" : "#059669"}>
              Provider ativo:{" "}
              {stats.provider === "MOCK"
                ? "Mock (simulado)"
                : stats.provider === "EVOLUTION"
                  ? "WhatsApp sem API oficial"
                  : "Cloud API"}
            </Badge>
            <Link
              href="/configuracoes/comunicacao"
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              <Settings className="size-3.5" />
              Credenciais
            </Link>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Exercita a Communication Engine de ponta a ponta sem nenhuma
          integração real — os mesmos fluxos que a Cloud API vai disparar.
        </p>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.key}
              onClick={() => simulate(s.key)}
              disabled={running !== null}
              className="rounded-xl border border-gray-200 hover:border-brand-300 hover:bg-brand-50 text-gray-700 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              {running === s.key ? "Executando..." : s.label}
            </button>
          ))}
        </div>
        {feedback && (
          <p className="text-xs text-brand-700 bg-brand-50 rounded-lg px-3 py-2 mt-3">
            {feedback}
          </p>
        )}
      </Card>

      {/* RESUMO: responde "está tudo bem?" sem obrigar a ler log nenhum */}
      {(() => {
        const r = resumoDoPeriodo({
          recebidas: stats.received24,
          enviadas: stats.sent24,
          falhas: stats.failed24,
          naFila: stats.sending,
        });
        const tom =
          r.gravidade === "OK"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : r.gravidade === "ATENCAO"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-rose-200 bg-rose-50 text-rose-800";
        return (
          <div className={`mb-4 rounded-2xl border p-4 ${tom}`}>
            <p className="flex items-center gap-2 font-bold">
              {r.gravidade === "OK" ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
              {r.titulo}
            </p>
            <p className="mt-0.5 text-sm">{r.detalhe}</p>
            {r.gravidade === "ERRO" && (
              <button
                onClick={() => setFilter("ERRO")}
                className="mt-2 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
              >
                Ver só as falhas
              </button>
            )}
          </div>
        );
      })()}

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Log de eventos</h2>
        <div className="flex gap-1.5">
          {(["ALL", "IN", "OUT", "ERRO"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition ${
                filter === f
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-gray-200 text-gray-500"
              }`}
            >
              {f === "ALL" ? "Todos" : f === "IN" ? "Recebidos" : f === "OUT" ? "Enviados" : "Erros"}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            icon={<Activity />}
            title="Nenhum evento ainda"
            hint="Use o simulador acima ou envie mensagens pela central de WhatsApp."
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {visible.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition"
                >
                  <span
                    className={`size-2 rounded-full shrink-0 ${
                      e.status === "ERRO" ? "bg-rose-500" : "bg-emerald-500"
                    }`}
                  />
                  {e.direction === "IN" ? (
                    <ArrowDownLeft className="size-3.5 text-sky-500 shrink-0" />
                  ) : (
                    <ArrowUpRight className="size-3.5 text-brand-500 shrink-0" />
                  )}
                  <span className="text-xs font-medium w-52 truncate shrink-0">
                    {lerEvento(e).titulo}
                  </span>
                  <Badge color="#64748b">{e.channel}</Badge>
                  <span
                    className={`text-xs truncate flex-1 ${e.status === "ERRO" ? "text-rose-600 font-medium" : "text-gray-400"}`}
                  >
                    {e.status === "ERRO"
                      ? (lerEvento(e).porque ?? "")
                      : (() => {
                          try {
                            return e.payload ? (JSON.parse(e.payload).preview ?? "") : "";
                          } catch {
                            return "";
                          }
                        })()}
                  </span>
                  <span className="text-[11px] text-gray-400 tabular-nums shrink-0 hidden sm:inline">
                    {e.durationMs} ms
                    {e.attempts > 1 ? ` · ${e.attempts} tentativas` : ""}
                  </span>
                  <span className="text-[11px] text-gray-400 tabular-nums shrink-0">
                    {dateShort(e.createdAt)} {timeShort(e.createdAt)}
                  </span>
                  <ChevronDown
                    className={`size-3.5 text-gray-300 shrink-0 transition ${
                      expanded === e.id ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {expanded === e.id && e.status === "ERRO" && (
                  <div className="px-4 pb-3 animate-fade-in">
                    {(() => {
                      const l = lerEvento(e);
                      return (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                          <p>
                            <b>Onde errou:</b> {l.ondeErrou}
                          </p>
                          <p className="mt-1">
                            <b>Por quê:</b> {l.porque}
                          </p>
                          <p className="mt-1">
                            <b>O que fazer:</b> {l.oQueFazer}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {expanded === e.id && (
                  <div className="px-4 pb-3 grid md:grid-cols-2 gap-2 animate-fade-in">
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">
                        Payload
                      </p>
                      <pre className="text-[11px] bg-gray-50 rounded-xl p-3 overflow-x-auto thin-scroll">
                        {(() => {
                          try {
                            return e.payload ? JSON.stringify(JSON.parse(e.payload), null, 2) : "—";
                          } catch {
                            return e.payload ?? "—";
                          }
                        })()}
                      </pre>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">
                        Resposta / erro
                      </p>
                      <pre
                        className={`text-[11px] rounded-xl p-3 overflow-x-auto thin-scroll ${
                          e.error ? "bg-rose-50 text-rose-700" : "bg-gray-50"
                        }`}
                      >
                        {e.error ??
                          (() => {
                            try {
                              return e.response
                                ? JSON.stringify(JSON.parse(e.response), null, 2)
                                : "OK";
                            } catch {
                              return e.response ?? "OK";
                            }
                          })()}
                      </pre>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
