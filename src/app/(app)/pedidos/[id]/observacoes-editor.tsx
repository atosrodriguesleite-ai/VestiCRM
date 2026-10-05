"use client";

/**
 * OBSERVAÇÕES DO PEDIDO — o bilhete que anda junto com a venda.
 *
 * O texto sempre existiu, mas era SÓ LEITURA na tela: dava para o sistema
 * escrever e não dava para a loja corrigir. Isso incomodava justamente no
 * caso mais comum — quando o "Colar pedido do WhatsApp" anota o que ficou de
 * fora ("⚠️ 2 linha(s) da mensagem não entraram…"). Resolvida a falta, o
 * aviso continuava lá dizendo uma coisa que não era mais verdade.
 *
 * SÓ O RECADO DA VENDEDORA FICA NO CAMPO (pedido do dono, 05/10/2026): a
 * nota gravada é uma sacola — o catálogo escreve Nome, Telefone e CEP, o
 * sistema escreve avisos — e tudo aparecia dentro de "Observações", tirando
 * o foco do que a vendedora de fato anotou. A régua que separa mora em
 * `lib/nota-do-pedido.ts` (a MESMA do romaneio): aqui o que o sistema
 * escreveu aparece num bloco cinza próprio, e o campo editável mostra e
 * grava só a observação da pessoa — salvar REMONTA a nota com os dados do
 * sistema no lugar, então limpar a observação não apaga o que o catálogo
 * informou. O aviso velho continua tendo saída: o × ao lado dele o tira da
 * nota (é o motivo pelo qual este editor nasceu).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2, X, StickyNote, Info } from "lucide-react";
import { montarNota, removerLinhaDoSistema, separarNotaDoPedido } from "@/lib/nota-do-pedido";

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
  const nota = separarNotaDoPedido(notes);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(nota.observacao);
  const [salvando, setSalvando] = useState(false);
  const [ocultando, setOcultando] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  async function gravar(notesNovo: string) {
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notesNovo }),
    });
    if (res.ok) return true;
    const d = await res.json().catch(() => ({}));
    setErro(d.error ?? "Não foi possível salvar a observação.");
    return false;
  }

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro("");
    // string vazia = apagar SÓ a observação; o que o sistema escreveu fica
    const ok = await gravar(montarNota(notes, texto));
    setSalvando(false);
    if (ok) {
      setEditando(false);
      router.refresh();
    }
  }

  async function ocultarAviso(linha: string) {
    if (ocultando) return;
    setOcultando(linha);
    setErro("");
    const ok = await gravar(removerLinhaDoSistema(notes, linha));
    setOcultando(null);
    if (ok) router.refresh();
  }

  function cancelar() {
    setTexto(nota.observacao);
    setEditando(false);
    setErro("");
  }

  const temSistema = nota.dados.length > 0 || nota.avisos.length > 0;

  // o bloco do sistema: dados em cinza, avisos com o × de "já resolvi"
  const blocoDoSistema = temSistema ? (
    <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <Info className="size-3" /> Registrado pelo sistema
      </p>
      {nota.dados.length > 0 && (
        <ul className="space-y-0.5 text-xs text-gray-500">
          {nota.dados.map((linha, i) => (
            <li key={`d-${i}`} className="break-words">{linha}</li>
          ))}
        </ul>
      )}
      {nota.avisos.length > 0 && (
        <ul className={`space-y-1 text-xs text-amber-900 ${nota.dados.length ? "mt-1.5" : ""}`}>
          {nota.avisos.map((linha, i) => (
            <li key={`a-${i}`} className="flex items-start gap-2">
              <span className="flex-1 break-words">{linha}</span>
              {!bloqueado && (
                <button
                  type="button"
                  onClick={() => ocultarAviso(linha)}
                  disabled={ocultando !== null}
                  title="Já resolvido — tirar este aviso do pedido"
                  aria-label="Tirar este aviso do pedido"
                  className="-mr-1 shrink-0 rounded-md p-0.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50"
                >
                  {ocultando === linha ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {erro && !editando && <p className="mt-1 text-xs font-medium text-rose-600">{erro}</p>}
    </div>
  ) : null;

  if (editando) {
    return (
      <>
        {blocoDoSistema}
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
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
      </>
    );
  }

  // sem observação e sem poder editar: o campo não ocupa espaço na tela
  if (!nota.observacao && bloqueado) return blocoDoSistema;

  if (!nota.observacao) {
    return (
      <>
        {blocoDoSistema}
        <button
          onClick={() => setEditando(true)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 transition hover:text-amber-700"
        >
          <StickyNote className="size-3.5" />
          Adicionar observação
        </button>
      </>
    );
  }

  return (
    <>
      {blocoDoSistema}
      <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          <StickyNote className="size-3" /> Observações do pedido
        </p>
        <div className="flex items-start gap-2">
          <p className="flex-1 whitespace-pre-wrap text-sm text-gray-800">{nota.observacao}</p>
          {!bloqueado && (
            <button
              onClick={() => setEditando(true)}
              title="Editar observação"
              className="-mr-1 shrink-0 rounded-lg p-1 text-amber-500 transition hover:bg-amber-100 hover:text-amber-700"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
