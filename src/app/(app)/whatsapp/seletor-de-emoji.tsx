"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { EMOJI_GROUPS, buscarEmojis } from "@/lib/emojis";

/**
 * O SELETOR DE EMOJI DA CENTRAL — com barra de pesquisa.
 *
 * Pedido do dono (03/09/2026): "tenho que ficar procurando o emoji". A
 * grade por grupo continua (roupas, dinheiro, festa — organizada para
 * venda de moda), e em cima dela uma caixinha de busca: digitou "caixa",
 * aparece o 📦; apagou, volta a grade inteira. É o MESMO seletor no
 * compositor e na edição de mensagem, para o gesto ser um só.
 *
 * `className` posiciona o painel (quem chama sabe onde ele abre).
 */
export function SeletorDeEmoji({
  onEscolher,
  className = "",
  autoFoco = true,
}: {
  onEscolher: (emoji: string) => void;
  className?: string;
  /** dá foco à busca ao abrir (no computador; no celular abriria o teclado em cima da grade) */
  autoFoco?: boolean;
}) {
  const [termo, setTermo] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const achados = useMemo(() => buscarEmojis(termo), [termo]);

  useEffect(() => {
    if (!autoFoco) return;
    // só no computador: no celular o teclado subiria por cima da grade
    if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [autoFoco]);

  const botao = (e: string) => (
    <button
      key={e}
      type="button"
      onClick={() => onEscolher(e)}
      className="size-9 grid place-items-center text-[22px] rounded-lg hover:bg-brand-50 transition"
      title={e}
    >
      {e}
    </button>
  );

  return (
    <div
      className={`bg-white rounded-xl border border-gray-100 shadow-pop z-20 flex flex-col ${className}`}
    >
      <div className="relative p-2 pb-1 shrink-0">
        <Search className="size-3.5 text-gray-300 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          ref={inputRef}
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            // Enter escolhe o primeiro achado: "cora" + Enter manda o ❤️
            if (e.key === "Enter" && achados?.length) {
              e.preventDefault();
              onEscolher(achados[0]);
            }
          }}
          placeholder="Pesquisar emoji (ex.: coração, caixa, feliz)"
          aria-label="Pesquisar emoji"
          className="w-full rounded-lg bg-gray-50 border border-transparent focus:border-brand-300 focus:bg-white pl-8 pr-7 py-1.5 text-xs outline-none transition"
        />
        {termo && (
          <button
            type="button"
            onClick={() => {
              setTermo("");
              inputRef.current?.focus();
            }}
            title="Limpar"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto thin-scroll px-2 pb-2">
        {achados === null ? (
          EMOJI_GROUPS.map((g) => (
            <div key={g.titulo} className="mb-1.5">
              <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                {g.titulo}
              </p>
              <div className="flex flex-wrap">{g.emojis.map(botao)}</div>
            </div>
          ))
        ) : achados.length === 0 ? (
          <p className="px-1 py-3 text-xs text-gray-400">
            Nenhum emoji para “{termo.trim()}”. Tente outra palavra, tipo “coração”, “caixa” ou “feliz”.
          </p>
        ) : (
          <div className="flex flex-wrap">{achados.map(botao)}</div>
        )}
      </div>
    </div>
  );
}
