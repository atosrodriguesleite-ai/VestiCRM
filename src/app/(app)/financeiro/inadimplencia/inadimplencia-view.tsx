"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, MessageCircle, Users } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { brl } from "@/lib/format";
import type { LinhaInadimplencia } from "@/lib/financeiro/visao";
import { formatarDia } from "@/lib/financeiro/dia";

/**
 * INADIMPLÊNCIA (RN-032). O botão de cobrar é o coração da tela: a lojista
 * não precisa sair procurando a conversa — a mensagem entra na Central, na
 * conversa da cliente, e a vendedora vê tudo como sempre viu.
 */
export function InadimplenciaView({
  linhas,
  total,
  clientes,
  truncado,
}: {
  linhas: LinhaInadimplencia[];
  total: number;
  clientes: number;
  /** a lista tem teto; o total NÃO (é somado no banco, período inteiro) */
  truncado: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  async function cobrar(l: LinhaInadimplencia) {
    setEnviando(l.parcelaId);
    setErro("");
    setOk("");
    try {
      const res = await fetch(`/api/financeiro/parcelas/${l.parcelaId}/cobranca`, {
        method: "POST",
      });
      setEnviando(null);
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(d?.error ?? "Não deu certo — tente de novo");
        return;
      }
      setOk(`Cobrança enviada para ${l.clienteNome} 💬`);
      router.refresh();
    } catch {
      setEnviando(null);
      setErro("Sem conexão — confira a internet e tente de novo");
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Inadimplência"
        subtitle="Quem está devendo e há quanto tempo — com a cobrança saindo pelo WhatsApp da loja, sem sair daqui."
        action={
          <Link
            href="/financeiro"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Financeiro
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Total atrasado"
          value={brl(total)}
          icon={<AlertTriangle />}
          tone={total > 0 ? "bad" : "good"}
        />
        <StatTile
          label="Contas atrasadas"
          value={truncado ? `${linhas.length}+` : String(linhas.length)}
          hint={truncado ? "mostrando as mais antigas" : undefined}
        />
        <StatTile
          label="Clientes"
          value={truncado ? `${clientes}+` : String(clientes)}
          icon={<Users />}
        />
      </div>

      {erro && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {erro}
        </div>
      )}
      {ok && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {ok}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Atraso</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 font-medium">Venceu</th>
                <th className="px-4 py-3 text-right font-medium">Falta</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    Nenhuma conta atrasada. 🎉
                  </td>
                </tr>
              )}
              {linhas.map((l) => (
                <tr key={l.parcelaId} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                        l.diasAtraso >= 30
                          ? "bg-rose-50 text-rose-700 ring-rose-200"
                          : l.diasAtraso >= 7
                            ? "bg-amber-50 text-amber-700 ring-amber-200"
                            : "bg-slate-100 text-slate-600 ring-slate-200"
                      }`}
                    >
                      {l.diasAtraso} dia{l.diasAtraso > 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {l.clienteNome}
                    {!l.temWhatsapp && (
                      <span className="ml-2 text-[11px] text-slate-400">
                        sem WhatsApp no cadastro
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/financeiro/lancamentos/${l.lancamentoId}`}
                      className="text-slate-700 hover:text-brand-700 hover:underline"
                    >
                      {l.descricao}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                    {formatarDia(l.vencimento)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold">
                    {brl(l.falta)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.cobradoHoje ? (
                      <span className="text-[11px] text-emerald-700">cobrada hoje ✓</span>
                    ) : l.temWhatsapp ? (
                      <button
                        type="button"
                        disabled={enviando !== null}
                        onClick={() => cobrar(l)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <MessageCircle className="size-3.5" />
                        {enviando === l.parcelaId ? "Enviando…" : "Cobrar no WhatsApp"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                    {l.cobradoEm && !l.cobradoHoje && (
                      <span className="ml-2 block text-[10px] text-slate-400">
                        última cobrança em {formatarDia(l.cobradoEm)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        A mensagem é escrita pelo sistema e enviada pela Central de Atendimento
        da loja, na conversa da cliente — com o ritmo que protege o número da
        loja. A mesma conta não é cobrada duas vezes no mesmo dia.
      </p>
    </div>
  );
}
