"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ScanBarcode, Search, User } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { casaTexto } from "@/lib/busca";
import { dateShort, timeShort } from "@/lib/format";

export type LinhaDaFila = {
  id: string;
  numero: string;
  cliente: string;
  vendedora: string | null;
  pecas: number;
  status: string;
  pagoEm: string | null;
  emAndamento: { quem: string; desde: string } | null;
  separadoEm: string | null;
};

/**
 * ABA SEPARAÇÃO (RN-060): a fila de pedidos pagos que ainda não foram
 * separados, do mais antigo para o mais novo, e os separados nos últimos
 * dias. Quem está separando aparece na linha — duas pessoas não pegam o
 * mesmo pedido sem saber. Toda a equipe entra; a tela mostra só os pedidos
 * que a pessoa enxerga (RN-007).
 */
export function SeparacaoView({ aSeparar, separados, cortada }: { aSeparar: LinhaDaFila[]; separados: LinhaDaFila[]; cortada: boolean }) {
  const [q, setQ] = useState("");
  const filtro = (l: LinhaDaFila) => {
    const t = q.trim();
    if (!t) return true;
    return casaTexto(`${l.numero} ${l.cliente} ${l.vendedora ?? ""}`, t);
  };
  const fila = useMemo(() => aSeparar.filter(filtro), [aSeparar, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const feitos = useMemo(() => separados.filter(filtro), [separados, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const primeiro = fila[0];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="size-4 text-gray-400 absolute left-3 top-2.5" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Número do pedido ou nome da cliente"
              className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </div>
          {primeiro && (
            <Link
              href={`/separacao/${primeiro.id}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
            >
              <ScanBarcode className="size-4" />
              Separar o próximo ({primeiro.numero})
            </Link>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Só entra pedido <b>pago</b> que ainda está na loja. Abra o pedido, bipe cada peça com o leitor e conclua — o pedido vira
          &ldquo;Separação&rdquo; e fica registrado quem separou.
        </p>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-sm">A separar</h2>
          <span className="text-xs text-gray-500">
            {fila.length} pedido{fila.length === 1 ? "" : "s"}
            {cortada && <span className="text-amber-700"> · mostrando só os {aSeparar.length} mais antigos</span>}
          </span>
        </div>
        {fila.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 />}
            title={q ? "Nenhum pedido bate com a busca." : "Nada para separar agora."}
            hint={q ? undefined : "Todo pedido pago que ainda não foi separado aparece aqui, do mais antigo para o mais novo."}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {fila.map((l) => (
              <li key={l.id}>
                <Link href={`/separacao/${l.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{l.numero}</span>
                      <span className="text-sm text-gray-700 truncate">{l.cliente}</span>
                      <span className="text-[11px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{l.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{l.pecas} peça{l.pecas === 1 ? "" : "s"}</span>
                      {l.pagoEm && <span>· pago em {dateShort(l.pagoEm)}</span>}
                      {l.vendedora && <span>· {l.vendedora}</span>}
                      {l.emAndamento && (
                        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                          <User className="size-3" /> em separação por {l.emAndamento.quem} desde {timeShort(l.emAndamento.desde)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ScanBarcode className="size-5 text-brand-600 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {feitos.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-sm">Separados nos últimos 7 dias</h2>
            <span className="text-xs text-gray-500">{feitos.length}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {feitos.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-semibold">{l.numero}</span> <span className="text-gray-700">{l.cliente}</span>
                  <span className="text-xs text-gray-500"> · {l.pecas} peça{l.pecas === 1 ? "" : "s"} · separado em {dateShort(l.separadoEm!)} {timeShort(l.separadoEm!)}</span>
                </div>
                <Link href={`/pedidos/${l.id}`} className="text-xs text-brand-700 hover:underline shrink-0">ver pedido</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
