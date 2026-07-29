"use client";

import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  MENSAGEM_PADRAO,
  DESCRICAO_CHAMADA,
  CAMPO_DA_CHAMADA,
  type TipoChamada,
} from "@/lib/mensagens-chamada";

/**
 * Editor das mensagens da lista "Quem chamar hoje".
 *
 * A lojista escreve do jeito dela. Campo vazio = usa o padrão do sistema —
 * então ninguém precisa preencher nada para o recurso funcionar, e "voltar ao
 * padrão" é sempre um clique.
 */

const ORDEM: TipoChamada[] = [
  "ANIVERSARIO",
  "RECOMPRA",
  "POS_VENDA",
  "NOVA",
  "PARADA",
];

export function MensagensChamada({
  inicial,
}: {
  inicial: Record<string, string | null>;
}) {
  const [textos, setTextos] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const tipo of ORDEM) {
      t[tipo] = inicial[CAMPO_DA_CHAMADA[tipo]] ?? "";
    }
    return t;
  });
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setSalvando(true);
    setErro("");
    setSalvo(false);
    const corpo: Record<string, string | null> = {};
    for (const tipo of ORDEM) {
      corpo[CAMPO_DA_CHAMADA[tipo]] = textos[tipo].trim() || null;
    }
    try {
      const res = await fetch("/api/comm/mensagens-chamada", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (res.ok) {
        setSalvo(true);
        setTimeout(() => setSalvo(false), 2500);
      } else {
        const d = await res.json().catch(() => null);
        setErro(d?.error ?? "Não foi possível salvar. Tente de novo.");
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    }
    setSalvando(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Estas são as mensagens que aparecem prontas na lista{" "}
        <b className="text-gray-500">Quem chamar hoje</b>, no painel. Escreva do
        jeito da sua loja — a vendedora ainda pode ajustar antes de enviar.
        Deixe em branco para usar o texto padrão.
      </p>

      {ORDEM.map((tipo) => {
        const { titulo, quando } = DESCRICAO_CHAMADA[tipo];
        const usandoPadrao = !textos[tipo].trim();
        return (
          <div key={tipo} className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-700">{titulo}</p>
                <p className="text-[11px] text-gray-400">{quando}</p>
              </div>
              {!usandoPadrao && (
                <button
                  onClick={() => setTextos((t) => ({ ...t, [tipo]: "" }))}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 transition"
                  title="Voltar ao texto padrão"
                >
                  <RotateCcw className="size-3" />
                  Padrão
                </button>
              )}
            </div>
            <textarea
              rows={3}
              maxLength={500}
              value={textos[tipo]}
              onChange={(e) =>
                setTextos((t) => ({ ...t, [tipo]: e.target.value }))
              }
              placeholder={MENSAGEM_PADRAO[tipo]}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 transition resize-y"
            />
            {usandoPadrao && (
              <p className="text-[11px] text-gray-300 mt-1">
                Usando o texto padrão (o cinza acima).
              </p>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 transition"
        >
          {salvando ? "Salvando..." : "Salvar mensagens"}
        </button>
        {salvo && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
            <Check className="size-4" />
            Salvo
          </span>
        )}
        {erro && <span className="text-sm text-rose-600">{erro}</span>}
      </div>

      <p className="text-[11px] text-gray-400">
        Você pode usar <code className="bg-gray-100 px-1 rounded">{"{nome}"}</code>{" "}
        para o primeiro nome da cliente.
      </p>
    </div>
  );
}
