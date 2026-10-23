import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { porteiraBiTela } from "@/lib/bi/gate";
import { lerFiltro, montarLista } from "@/lib/bi/listas";
import { Chamar } from "./chamar";

export const dynamic = "force-dynamic";

/**
 * A LISTA POR TRÁS DO NÚMERO (RN-086): quem está esperando, quem ficou sem
 * resposta, quem chegou, quem comprou, quem está em cada grupo do RFM.
 * Cada linha leva ao lugar de sempre (conversa, ficha da cliente, pedido);
 * a do RFM tem também o botão de chamar com a mensagem do grupo (RN-092).
 */
export default async function ListaDoBiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await porteiraBiTela();
  const filtro = lerFiltro(await searchParams);
  const voltar = filtro
    ? `/bi?${[filtro.aba && filtro.aba !== "painel" ? `aba=${filtro.aba}` : "", filtro.de ? `de=${filtro.de}` : "", filtro.ate ? `ate=${filtro.ate}` : ""].filter(Boolean).join("&")}`
    : "/bi";
  const lista = filtro ? await montarLista(user, filtro) : null;
  const tom = (t?: string) => (t === "bad" ? "text-rose-600" : t === "warn" ? "text-amber-600" : "text-slate-700");

  return (
    <div className="max-w-3xl mx-auto">
      <Link href={voltar} className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline mb-2">
        <ArrowLeft className="size-4" /> Voltar ao BI
      </Link>
      {!lista ? (
        <Card className="p-5">
          <EmptyState title="Lista não encontrada" hint="O endereço veio torto. Volte ao BI e clique no número de novo." />
        </Card>
      ) : (
        <>
          <PageHeader
            title={lista.titulo}
            subtitle={`${lista.descricao}${lista.periodo ? ` Período: ${lista.periodo.de.split("-").reverse().join("/")} a ${lista.periodo.ate.split("-").reverse().join("/")}.` : ""}`}
          />
          <p className="text-xs text-gray-400 mb-3">
            {lista.cortou ? `Mostrando as primeiras ${lista.linhas.length} de ${lista.total}. Encurte o período para ver todas.` : `${lista.total} ${lista.total === 1 ? "linha" : "linhas"}.`}
            {lista.periodo && (
              <>
                {" "}
                O número do BI é dos fatos do dia (o passado fica congelado); esta lista é de agora — o que mudou depois
                (uma resposta de ontem, um cancelamento de hoje) está no número e não aqui.
              </>
            )}
          </p>
          {lista.linhas.length === 0 ? (
            <Card className="p-5">
              <EmptyState title="Ninguém aqui 🎉" hint="Nenhuma linha para este número no recorte escolhido." />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {lista.linhas.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 pr-3 hover:bg-gray-50 transition">
                    <Link href={l.href} className="flex flex-1 min-w-0 items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{l.titulo}</p>
                        {l.subtitulo && <p className="text-xs text-gray-400 line-clamp-2 sm:truncate">{l.subtitulo}</p>}
                      </div>
                      {l.destaque && <span className={`text-sm font-semibold tabular-nums shrink-0 ${tom(l.tom)}`}>{l.destaque}</span>}
                    </Link>
                    {l.chamar && <Chamar customerId={l.chamar.customerId} mensagem={l.chamar.mensagem} />}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
