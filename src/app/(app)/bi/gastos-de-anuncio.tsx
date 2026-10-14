"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { Card } from "@/components/ui";
import { numeroBR } from "@/lib/numero-br";
// SÓ o rótulo (lib pura) e o TIPO: o motor `lib/bi/anuncios.ts` fala com o
// banco e não pode chegar ao navegador (o defeito do deploy de 17/08/2026)
import { rotuloDoCanal } from "@/lib/canais-de-anuncio";
import type { CampanhaLeve } from "@/lib/bi/anuncios";

type Props = {
  meses: string[];
  campanhas: CampanhaLeve[];
  gastos: { campanhaId: string; mes: string; valor: number }[];
};

const rotuloDoMes = (m: string) => {
  const [ano, mes] = m.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mes) - 1]}/${ano.slice(2)}`;
};

/** o número gravado, escrito como a loja escreve ("1234,50") — reler "1234.5" multiplicaria por mil */
const emTexto = (v: number) => v.toFixed(2).replace(".", ",");

/**
 * O GASTO POR MÊS (RN-085): uma linha por campanha, uma coluna por mês do
 * período. Campo em branco (ou zero) = sem gasto naquele mês. O salvar manda
 * SÓ as células que a pessoa MUDOU, cada uma com o valor que ela VIU (a
 * régua do ajuste de estoque, RN-050): a grade inteira apagava o que outra
 * aba ou outra gerente tinha gravado, sem ninguém ver (achado da revisão).
 */
export function GastosDeAnuncio({ meses, campanhas, gastos }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const chave = (c: string, m: string) => `${c}|${m}`;
  const [gravado] = useState<Record<string, number>>(
    Object.fromEntries(gastos.map((g) => [chave(g.campanhaId, g.mes), g.valor]))
  );
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(gastos.map((g) => [chave(g.campanhaId, g.mes), emTexto(g.valor)]))
  );
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setErro("");
    const lista: { campanhaId: string; mes: string; valor: number | null; visto: number | null }[] = [];
    for (const c of campanhas) {
      for (const m of meses) {
        const k = chave(c.id, m);
        const texto = (valores[k] ?? "").trim();
        const visto = gravado[k] ?? null;
        let valor: number | null = null;
        if (texto) {
          const n = numeroBR(texto);
          if (n === null || n < 0) {
            setErro(`"${texto}" não é um valor (${c.name}, ${rotuloDoMes(m)}).`);
            return;
          }
          valor = n;
        }
        // só o que MUDOU viaja (zero e branco são o mesmo "sem gasto")
        if ((valor || null) === (visto || null)) continue;
        lista.push({ campanhaId: c.id, mes: m, valor, visto });
      }
    }
    if (!lista.length) {
      setEditando(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/bi/anuncios/gastos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gastos: lista }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(json.error ?? "Não foi possível salvar.");
        return;
      }
      setEditando(false);
      router.refresh();
    } catch {
      setErro("Sem conexão — confira a internet e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <Coins className="size-4 text-brand-600" />
          Gasto por mês
        </h2>
        {campanhas.length > 0 && (
          <button type="button" onClick={() => setEditando((e) => !e)} className="text-xs text-brand-700 hover:underline">
            {editando ? "Fechar" : gastos.length ? "Editar gasto" : "Informar gasto"}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Quanto a loja gastou em cada campanha de anúncio, mês a mês. É o que faz o retorno virar conta de verdade.
        As campanhas são as da tela Marketing.
      </p>
      {campanhas.length === 0 && (
        <p className="text-sm text-gray-500">
          Nenhuma campanha de anúncio cadastrada. Crie em Marketing → Suas campanhas e cole o link do anúncio: as
          clientes que chegarem por ele entram sozinhas.
        </p>
      )}
      {campanhas.length > 0 && !editando && gastos.length === 0 && (
        <p className="text-sm text-gray-500">Nenhum gasto informado nos meses do período. Sem gasto, não há retorno a calcular.</p>
      )}
      {editando && (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase">
                <th className="pr-3 py-1">Campanha</th>
                {meses.map((m) => (
                  <th key={m} className="px-1 py-1 text-right">{rotuloDoMes(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => (
                <tr key={c.id}>
                  <td className="pr-3 py-1 whitespace-nowrap">
                    {c.name}
                    <span className="text-gray-400 text-xs"> · {rotuloDoCanal(c.channel)}{c.active ? "" : " · parada"}</span>
                  </td>
                  {meses.map((m) => (
                    <td key={m} className="px-1 py-1">
                      <input
                        inputMode="decimal"
                        value={valores[chave(c.id, m)] ?? ""}
                        onChange={(e) => setValores((v) => ({ ...v, [chave(c.id, m)]: e.target.value }))}
                        placeholder="R$"
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right bg-white outline-none focus:border-brand-400"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={salvar}
              disabled={saving}
              className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Salvar gasto"}
            </button>
            <span className="text-xs text-gray-400">Em branco = sem gasto naquele mês.</span>
          </div>
        </div>
      )}
    </Card>
  );
}
