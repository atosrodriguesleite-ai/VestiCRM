"use client";

/**
 * A JANELA "ESTOU CIENTE" DAS PEÇAS EXTRAS (RN-075).
 *
 * Quem faz a conta do extra é o SERVIDOR: a tela manda o pedido como sempre,
 * e quando falta estoque a porta responde 409 com a lista (`extras`). Aqui a
 * pessoa vê, peça por peça, o que sai do estoque e o que vira extra, marca
 * que está ciente e o mesmo envio é refeito com a confirmação. Se o estoque
 * cair de novo no meio, o servidor recusa outra vez e a janela reabre com os
 * números de agora — ninguém confirma extra que não viu.
 *
 * Um só caminho para as quatro telas que oferecem extra (Novo pedido, Editar
 * itens, Restaurar da lista e Mudar status): `useConfirmarExtras().enviar`
 * embrulha o `fetch` de cada uma.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Portal } from "@/components/portal";
import { confirmacaoDosExtras, type ExtraDaPeca } from "@/lib/pedido-extras";

/** Quantas vezes a janela reabre se o estoque continuar caindo no meio. */
const TENTATIVAS = 3;

export function useConfirmarExtras(): {
  enviar: (
    montar: (extrasConfirmados?: Record<string, number>) => Promise<Response>
  ) => Promise<{ res: Response; data: unknown } | null>;
  janela: ReactNode;
} {
  const [pendente, setPendente] = useState<{
    extras: ExtraDaPeca[];
    responder: (ok: boolean) => void;
  } | null>(null);
  // a tela que abriu a janela pode sumir com ela aberta (a lista recarregou):
  // a pergunta é respondida "não" para o envio não ficar preso para sempre
  // — e o botão da tela, "ocupado" (achado da revisão)
  const aberta = useRef<((ok: boolean) => void) | null>(null);
  useEffect(() => () => aberta.current?.(false), []);

  async function enviar(
    montar: (extrasConfirmados?: Record<string, number>) => Promise<Response>
  ) {
    let res = await montar();
    let data: unknown = await res.json().catch(() => null);
    for (let i = 0; i < TENTATIVAS; i++) {
      const extras = (data as { extras?: ExtraDaPeca[] } | null)?.extras;
      if (res.status !== 409 || !Array.isArray(extras) || extras.length === 0) break;
      const ok = await new Promise<boolean>((responder) => {
        aberta.current = responder;
        setPendente({ extras, responder });
      });
      aberta.current = null;
      setPendente(null);
      // voltou sem confirmar: nada foi gravado, a tela segue como estava
      if (!ok) return null;
      res = await montar(confirmacaoDosExtras(extras));
      data = await res.json().catch(() => null);
    }
    return { res, data };
  }

  const janela = pendente ? (
    <JanelaDeExtras
      extras={pendente.extras}
      onConfirmar={() => pendente.responder(true)}
      onVoltar={() => pendente.responder(false)}
    />
  ) : null;

  return { enviar, janela };
}

function JanelaDeExtras({
  extras,
  onConfirmar,
  onVoltar,
}: {
  extras: ExtraDaPeca[];
  onConfirmar: () => void;
  onVoltar: () => void;
}) {
  const [ciente, setCiente] = useState(false);
  const total = extras.reduce((s, e) => s + e.extra, 0);
  return (
    // Portal e acima de tudo: a janela abre por cima do "Novo pedido" e da
    // edição de itens, que já são janelas
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extras-titulo"
        className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onVoltar} />
        <div className="relative w-full max-h-[90dvh] flex flex-col rounded-t-3xl bg-white p-5 shadow-pop animate-scale-in sm:max-w-md sm:rounded-3xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="extras-titulo" className="text-[17px] font-semibold text-slate-900">
                🧵 {total} {total === 1 ? "peça sem estoque" : "peças sem estoque"}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                O que existe no estoque fica separado para a cliente. O resto entra como{" "}
                <b className="text-violet-700">EXTRA</b>: feito para este pedido, sem mexer no
                estoque nem na Nuvemshop.
              </p>
            </div>
            <button
              type="button"
              onClick={onVoltar}
              aria-label="Voltar sem salvar"
              className="grid size-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="size-5" />
            </button>
          </div>

          <ul className="mt-4 space-y-2 overflow-y-auto thin-scroll">
            {extras.map((e) => (
              <li key={e.variantId} className="rounded-2xl border border-violet-100 bg-violet-50/60 px-3.5 py-2.5">
                <p className="text-sm font-medium text-slate-800">{e.label}</p>
                <p className="mt-0.5 text-[13px] text-slate-500 tabular-nums">
                  {e.precisa} {e.precisa === 1 ? "peça" : "peças"} ·{" "}
                  {e.doEstoque > 0 ? `${e.doEstoque} do estoque · ` : "nada no estoque · "}
                  <b className="text-violet-700">
                    {e.extra} {e.extra === 1 ? "extra" : "extras"}
                  </b>
                </p>
              </li>
            ))}
          </ul>

          <label className="mt-4 flex items-start gap-2.5 rounded-2xl border border-slate-200 p-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={ciente}
              onChange={(e) => setCiente(e.target.checked)}
              className="mt-0.5 size-4 accent-violet-600"
            />
            <span className="text-sm text-slate-700">
              Estou ciente: as peças extras serão feitas para este pedido. Fica registrado no
              histórico que fui eu que confirmei.
            </span>
          </label>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onVoltar}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={!ciente}
              className="flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-40"
            >
              Confirmar e salvar
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
