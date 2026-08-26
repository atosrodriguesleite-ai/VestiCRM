"use client";

import { useMemo, useState } from "react";
import { Search, Check, Forward, X, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui";
import { casaCliente } from "@/lib/busca";
import { TETO_DESTINOS } from "@/lib/encaminhar";

/**
 * ENCAMINHAR UMA MENSAGEM para outras conversas — o mesmo gesto do aplicativo
 * (pedido do dono, 26/08/2026): vale para a mensagem que a cliente mandou e
 * para a que a loja mandou.
 *
 * A escolha é MÚLTIPLA porque é assim que a coisa acontece no balcão: chegou
 * a foto da peça nova, ela manda para as cinco clientes que perguntaram.
 *
 * O teto de destinos (`TETO_DESTINOS`) vale aqui e no servidor: cada um é um
 * envio de verdade, em fila, com o ritmo humano anti-bloqueio (RN-017).
 *
 * E ENCAMINHAR É RESPONDER: a conversa de destino passa a ser sua (se não
 * tinha dona), sai da fila e volta a ficar aberta — a mesma regra de quando
 * se escreve para a cliente. O aviso no rodapé diz isso, para ninguém
 * encaminhar achando que não mexeu em nada.
 */

export type DestinoEncaminhar = {
  id: string;
  customer: { id: string; name: string; phone: string; photoUrl?: string | null };
};

export function EncaminharMensagem({
  previa,
  conversas,
  conversaAtualId,
  onFechar,
  onEncaminhar,
}: {
  /** o que está sendo encaminhado, em uma linha */
  previa: string;
  conversas: DestinoEncaminhar[];
  /** a conversa de onde a mensagem saiu não se oferece como destino */
  conversaAtualId: string | null;
  onFechar: () => void;
  onEncaminhar: (ids: string[]) => Promise<void>;
}) {
  const [busca, setBusca] = useState("");
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  const lista = useMemo(
    () =>
      conversas
        .filter((c) => c.id !== conversaAtualId)
        .filter((c) => casaCliente(c.customer, busca))
        .slice(0, 60),
    [conversas, conversaAtualId, busca]
  );

  const alternar = (id: string) =>
    setEscolhidas((atual) =>
      atual.includes(id)
        ? atual.filter((x) => x !== id)
        : atual.length >= TETO_DESTINOS
          ? atual
          : [...atual, id]
    );

  const cheio = escolhidas.length >= TETO_DESTINOS;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 animate-fade-in sm:items-center"
      onClick={onFechar}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">Encaminhar para…</p>
            <p className="mt-0.5 truncate text-[12px] text-gray-400">“{previa}”</p>
          </div>
          <button
            onClick={onFechar}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="relative px-4 pt-3">
          <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente"
            className="w-full rounded-xl border border-gray-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-brand-400"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {lista.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Nenhuma conversa encontrada.
            </p>
          ) : (
            lista.map((c) => {
              const marcada = escolhidas.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!marcada && cheio}
                  onClick={() => alternar(c.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 ${
                    marcada ? "bg-brand-50" : ""
                  }`}
                >
                  <Avatar name={c.customer.name} color="#c4622d" src={c.customer.photoUrl} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                    {c.customer.name}
                  </span>
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-md border ${
                      marcada ? "border-brand-600 bg-brand-600 text-white" : "border-gray-300"
                    }`}
                  >
                    {marcada && <Check className="size-3.5" />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-gray-400">
            {escolhidas.length === 0
              ? "Encaminhar conta como responder: a conversa passa a ser sua."
              : `${escolhidas.length} ${escolhidas.length === 1 ? "conversa" : "conversas"}${
                  cheio ? ` (máximo de ${TETO_DESTINOS} por vez)` : ""
                }`}
          </p>
          <button
            onClick={async () => {
              if (escolhidas.length === 0 || enviando) return;
              setEnviando(true);
              await onEncaminhar(escolhidas);
              setEnviando(false);
            }}
            disabled={escolhidas.length === 0 || enviando}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {enviando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Forward className="size-4" />
            )}
            Encaminhar
          </button>
        </div>
      </div>
    </div>
  );
}
