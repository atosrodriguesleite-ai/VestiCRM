"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Phone,
  Mail,
  MapPin,
  Copy,
  Check,
  Download,
  ExternalLink,
} from "lucide-react";
import { Card } from "@/components/ui";
import { dateShort, formatPhone } from "@/lib/format";
import { casaTexto, casaTelefone } from "@/lib/busca";
import { waLink } from "@/lib/bio";
import { copiarTexto } from "@/lib/copiar";
import { canalLeadLabel, type CanalDeLead } from "@/lib/gestao";
import type { LeadContato } from "./gestao-view";

/**
 * CONTATOS DOS LEADS DA PLATAFORMA.
 *
 * Contar lead não fecha venda: o dono precisa do TELEFONE para ligar (pedido
 * de 24/08/2026). A tela mostrava só os números por canal, e para descobrir
 * quem eram as pessoas era preciso sair do painel e caçar no funil.
 *
 * Três coisas que esta lista precisa deixar óbvias:
 *  1. como falar com a pessoa — telefone no WhatsApp em um toque, e-mail e
 *     Instagram clicáveis;
 *  2. de onde ela veio — inclusive QUAL loja indicou (o boca a boca do
 *     produto é o canal mais valioso);
 *  3. em que pé está — o estágio no funil, para não ligar duas vezes para
 *     quem já virou cliente nem esquecer quem está parado em "Novo Lead".
 */

type Periodo = "MES" | "DIAS30" | "TUDO";

const PERIODOS: [Periodo, string][] = [
  ["MES", "Este mês"],
  ["DIAS30", "30 dias"],
  ["TUDO", "Tudo"],
];

/** Cor da etiqueta de situação: verde = ganho, vermelho = perdido. */
function tomDaSituacao(status: string | null): string {
  if (status === "WON") return "bg-emerald-50 text-emerald-700";
  if (status === "LOST") return "bg-rose-50 text-rose-600";
  return "bg-slate-100 text-slate-600";
}

export function ContatosDosLeads({
  leads,
  ocultos,
  inicioMes,
  dias30,
}: {
  leads: LeadContato[];
  ocultos: number;
  /** limites do período, calculados no servidor (fuso de São Paulo) */
  inicioMes: string;
  dias30: string;
}) {
  const [busca, setBusca] = useState("");
  const [canal, setCanal] = useState<CanalDeLead | "TODOS">("TODOS");
  const [periodo, setPeriodo] = useState<Periodo>("TUDO");
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(id: string, texto: string) {
    if (await copiarTexto(texto)) {
      setCopiado(id);
      setTimeout(() => setCopiado((c) => (c === id ? null : c)), 1500);
    }
  }

  const lista = useMemo(() => {
    const corte =
      periodo === "MES" ? inicioMes : periodo === "DIAS30" ? dias30 : null;
    const termo = busca.trim();
    return leads.filter((l) => {
      if (corte && l.criadoEm < corte) return false;
      if (canal !== "TODOS" && l.canal !== canal) return false;
      if (!termo) return true;
      // nome, cidade, loja que indicou, e-mail OU telefone (o telefone só
      // entra na conta com 3+ dígitos, senão "11" casaria com meio mundo)
      return (
        casaTexto(l.nome, termo) ||
        casaTexto(l.cidade, termo) ||
        casaTexto(l.loja, termo) ||
        casaTexto(l.email, termo) ||
        casaTelefone(l.telefone, termo)
      );
    });
  }, [leads, busca, canal, periodo, inicioMes, dias30]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            Contatos dos leads
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-slate-500">
            Todo mundo que chegou até a plataforma — a maioria pedindo
            demonstração. Toque no número para abrir o WhatsApp.
          </p>
        </div>
        <a
          href="/api/gestao/leads/export"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-700"
        >
          <Download className="size-3.5" />
          Baixar planilha
        </a>
      </div>

      {/* filtros: período, canal e busca */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PERIODOS.map(([p, rotulo]) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriodo(p)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              periodo === p
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(["TODOS", ...(Object.keys(canalLeadLabel) as CanalDeLead[])] as const).map(
          (c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCanal(c as CanalDeLead | "TODOS")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                canal === c
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {c === "TODOS" ? "Todos os canais" : canalLeadLabel[c as CanalDeLead]}
            </button>
          )
        )}
      </div>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, cidade, loja que indicou, e-mail ou telefone"
          className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-brand-400"
        />
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        <b className="tabular-nums text-slate-600">{lista.length}</b>{" "}
        {lista.length === 1 ? "lead" : "leads"} nesta seleção.
      </p>

      {lista.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          Nenhum lead com esses filtros.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-slate-100">
          {lista.map((l) => {
            const wa = waLink(l.telefone);
            return (
              <div key={l.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    href={`/clientes/${l.id}`}
                    className="min-w-0 truncate text-sm font-semibold text-slate-800 hover:text-brand-700"
                  >
                    {l.nome}
                  </Link>
                  <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                    {canalLeadLabel[l.canal]}
                  </span>
                  {l.loja && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      via {l.loja}
                    </span>
                  )}
                  {l.situacao && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tomDaSituacao(l.situacaoStatus)}`}
                    >
                      {l.situacao}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-400">
                    {dateShort(l.criadoEm)}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
                  {wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
                    >
                      <Phone className="size-3.5" />
                      {formatPhone(l.telefone)}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <Phone className="size-3.5" />
                      sem telefone
                    </span>
                  )}
                  {l.telefone && (
                    <button
                      type="button"
                      onClick={() => copiar(l.id, l.telefone)}
                      className="inline-flex items-center gap-1 text-slate-400 transition hover:text-brand-700"
                      title="Copiar telefone"
                    >
                      {copiado === l.id ? (
                        <>
                          <Check className="size-3.5" />
                          copiado
                        </>
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  )}
                  {l.email && (
                    <a
                      href={`mailto:${l.email}`}
                      className="inline-flex min-w-0 items-center gap-1 hover:text-brand-700"
                    >
                      <Mail className="size-3.5 shrink-0" />
                      <span className="truncate">{l.email}</span>
                    </a>
                  )}
                  {(l.cidade || l.uf) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" />
                      {[l.cidade, l.uf].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {l.instagram && (
                    <a
                      href={`https://instagram.com/${l.instagram.replace(/^@+/, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-brand-700"
                    >
                      <ExternalLink className="size-3.5" />
                      {l.instagram}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ocultos > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-snug text-slate-400">
          A lista mostra os <b>{leads.length}</b> mais recentes. Outros{" "}
          <b className="tabular-nums">{ocultos}</b> leads mais antigos estão na
          planilha — clique em <b>Baixar planilha</b> para a base completa.
        </p>
      )}
    </Card>
  );
}
