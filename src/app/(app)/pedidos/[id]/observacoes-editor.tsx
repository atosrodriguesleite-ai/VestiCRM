"use client";

/**
 * OBSERVAÇÕES DO PEDIDO — o bilhete que anda junto com a venda.
 *
 * O texto sempre existiu, mas era SÓ LEITURA na tela: dava para o sistema
 * escrever e não dava para a loja corrigir. Isso incomodava justamente no
 * caso mais comum — quando o "Colar pedido do WhatsApp" anota o que ficou de
 * fora ("Está faltando ao pedido: baby look café · M…"). Resolvida a falta, o
 * aviso continuava lá dizendo uma coisa que não era mais verdade.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2, X, StickyNote } from "lucide-react";

const LIMITE = 1000;

export function ObservacoesEditor({
  orderId,
  notes,
  bloqueado = false,
}: {
  orderId: string;
  notes: string | null;
  bloqueado?: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(notes ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro("");
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // string vazia = apagar a observação (é como a loja limpa o aviso velho)
      body: JSON.stringify({ notes: texto.trim() }),
    });
    setSalvando(false);
    if (res.ok) {
      setEditando(false);
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErro(d.error ?? "Não foi possível salvar a observação.");
    }
  }

  function cancelar() {
    setTexto(notes ?? "");
    setEditando(false);
    setErro("");
  }

  if (editando) {
    return (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
          <StickyNote className="size-3.5" /> Observações do pedido
        </p>
        <textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={LIMITE}
          rows={3}
          placeholder="Ex.: cliente pediu para separar só na sexta · falta acertar o frete"
          className="w-full resize-y rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-amber-400"
        />
        {erro && <p className="mt-1 text-xs font-medium text-rose-600">{erro}</p>}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500">
            {texto.length}/{LIMITE} · deixe vazio para apagar
          </span>
          <div className="flex gap-2">
            <button
              onClick={cancelar}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
            >
              Cancelar
            </button>
            <button
              onClick={salvar}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {salvando && <Loader2 className="size-3 animate-spin" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // sem observação e sem poder editar: não ocupa espaço na tela
  if (!notes && bloqueado) return null;

  if (!notes) {
    return (
      <button
        onClick={() => setEditando(true)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 transition hover:text-amber-700"
      >
        <StickyNote className="size-3.5" />
        Adicionar observação
      </button>
    );
  }

  return (
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
      <p className="flex-1 whitespace-pre-wrap text-xs text-gray-600">{notes}</p>
      {!bloqueado && (
        <button
          onClick={() => setEditando(true)}
          title="Editar observação"
          className="-mr-1 shrink-0 rounded-lg p-1 text-amber-500 transition hover:bg-amber-100 hover:text-amber-700"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      {bloqueado && <X className="mt-0.5 size-3.5 shrink-0 text-transparent" />}
    </div>
  );
}
