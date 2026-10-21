"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Bot, Lock, Plus, Settings2, Trash2, X } from "lucide-react";
import { Portal } from "@/components/portal";
import {
  MARCOS,
  PALETA,
  ROTULO_DO_MARCO,
  TETO_DE_ETAPAS,
  TETO_DO_NOME,
  antesDoGanho,
  ehAberta,
  problemaAoApagar,
  problemaNaOrdem,
  type Marco,
} from "@/lib/funil/etapas-regra";
import type { EstadoDoEditor, EtapaDoEditor } from "@/lib/funil/editor";

/** Botão do topo da tela do Funil (só aparece com a chave + gerência). O
 *  estado do editor é buscado ao abrir — a tela do Funil abre o tempo todo e
 *  o editor quase nunca. */
export function BotaoEditarFunil({ pipelineId }: { pipelineId: string }) {
  const [estado, setEstado] = useState<EstadoDoEditor | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function abrir() {
    setAbrindo(true);
    setErro(null);
    try {
      const res = await fetch(`/api/funil/etapas?pipelineId=${encodeURIComponent(pipelineId)}`);
      const d = await res.json().catch(() => null);
      if (res.ok) setEstado(d);
      else setErro(d?.error ?? "Não foi possível abrir o editor.");
    } catch {
      setErro("Sem conexão. Confira a internet e tente de novo.");
    } finally {
      setAbrindo(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={abrindo}
        title={erro ?? undefined}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-3.5 py-2.5 transition disabled:opacity-60"
      >
        <Settings2 className="size-4" /> {abrindo ? "Abrindo…" : erro ? "Tentar de novo" : "Editar etapas"}
      </button>
      {estado && <EditorDeEtapas inicial={estado} onClose={() => setEstado(null)} />}
    </>
  );
}

/**
 * RN-091 · EDITOR DO FUNIL. Cada ação vai sozinha ao servidor (que confere
 * tudo de novo, com o funil travado) e a resposta traz o funil inteiro —
 * a tela nunca adivinha o resultado. As regras que a tela mostra antes do
 * clique são as MESMAS funções que o servidor usa (`etapas-regra.ts`).
 */
export function EditorDeEtapas({
  inicial,
  onClose,
}: {
  inicial: EstadoDoEditor;
  onClose: () => void;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  const [corAberta, setCorAberta] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");

  const { etapas, marcos, pipelineId } = estado;
  const abertas = etapas.filter(ehAberta);

  async function chamar(url: string, method: string, body?: unknown): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(d?.error ?? "Não foi possível salvar. Tente de novo.");
        return false;
      }
      setEstado({ pipelineId: d.pipelineId, etapas: d.etapas, marcos: d.marcos });
      // o quadro atrás da janela acompanha (colunas, nomes, cartões movidos)
      router.refresh();
      return true;
    } catch {
      setErro("Sem conexão. Confira a internet e tente de novo.");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function mover(id: string, passo: -1 | 1) {
    const ids = etapas.map((e) => e.id);
    const i = ids.indexOf(id);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const problema = problemaNaOrdem(etapas, ids, comMarco);
    if (problema) {
      setErro(problema);
      return;
    }
    void chamar("/api/funil/etapas", "PUT", { pipelineId, ids });
  }

  async function criar() {
    const usadas = new Set(etapas.map((e) => e.color));
    const color = PALETA.find((c) => !usadas.has(c)) ?? PALETA[0];
    if (await chamar("/api/funil/etapas", "POST", { pipelineId, name: novoNome, color }))
      setNovoNome("");
  }

  const marcosDa = (id: string) => MARCOS.filter((m) => marcos[m] === id);
  const comMarco = etapas.filter((e) => marcosDa(e.id).length > 0).map((e) => e.id);
  // segurar o foco no campo do nome ao tocar num botão da linha: sem isso o
  // campo perde o foco, o salvar do nome liga o "ocupado" e o clique do
  // botão chega com ele já desabilitado (a seta/lixeira "não funcionava")
  const naoRoubaFoco = (ev: React.MouseEvent) => ev.preventDefault();

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)] translate-y-[var(--kbtop,0px)]">
        <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
        <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-xl max-h-[88dvh] overflow-y-auto p-5 md:p-6 animate-fade-up">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="font-semibold text-lg">Editar etapas do funil</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Renomeie, mude a cor, a ordem, crie ou apague etapas. Tudo vale na hora para toda a
                equipe.
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 p-1 shrink-0" aria-label="Fechar">
              <X className="size-5" />
            </button>
          </div>

          {erro && (
            <div className="mt-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
              {erro}
            </div>
          )}
          {aviso && (
            <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">
              {aviso}
            </div>
          )}

          {/* ---- as etapas, na ordem do quadro ---- */}
          <ul className="mt-4 space-y-2">
            {etapas.map((e, i) => (
              <li key={e.id} className="rounded-xl border border-gray-200 p-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCorAberta(corAberta === e.id ? null : e.id)}
                    className="size-6 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: e.color }}
                    title="Mudar a cor"
                      onMouseDown={naoRoubaFoco}
                    aria-label={`Mudar a cor de ${e.name}`}
                  />
                  <NomeDaEtapa
                    etapa={e}
                    desabilitado={ocupado}
                    onSalvar={(name) =>
                      chamar(`/api/funil/etapas/${e.id}`, "PATCH", { pipelineId, name })
                    }
                  />
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      disabled={ocupado || i === 0}
                      onClick={() => mover(e.id, -1)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                      aria-label="Subir"
                      onMouseDown={naoRoubaFoco}
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={ocupado || i === etapas.length - 1}
                      onClick={() => mover(e.id, 1)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                      aria-label="Descer"
                      onMouseDown={naoRoubaFoco}
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    {ehAberta(e) ? (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => {
                          setErro(null);
                          setApagando(apagando === e.id ? null : e.id);
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                        aria-label={`Apagar ${e.name}`}
                      onMouseDown={naoRoubaFoco}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : (
                      <span
                        className="p-1.5 text-gray-300"
                        title={
                          e.isWon
                            ? "Etapa de venda ganha: o pedido pago leva o cartão para cá. Pode renomear, não apagar."
                            : "Etapa de negociação perdida: o pedido cancelado leva o cartão para cá. Pode renomear, não apagar."
                        }
                      >
                        <Lock className="size-4" />
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8 text-[11px]">
                  {i === 0 && <Selo cor="sky">🚪 entrada do lead</Selo>}
                  {e.isWon && <Selo cor="emerald">✅ venda ganha</Selo>}
                  {e.isLost && <Selo cor="rose">❌ perdida</Selo>}
                  {marcosDa(e.id).length > 0 && (
                    <Selo cor="violet">
                      <Bot className="size-3 inline -mt-0.5" /> anda sozinho para cá
                    </Selo>
                  )}
                  <span className="text-gray-400">
                    {e.cartoes} {e.cartoes === 1 ? "cartão" : "cartões"}
                  </span>
                </div>

                {corAberta === e.id && (
                  <div className="mt-2 pl-8 flex flex-wrap gap-1.5">
                    {PALETA.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={ocupado}
                        onClick={async () => {
                          if (await chamar(`/api/funil/etapas/${e.id}`, "PATCH", { pipelineId, color: c }))
                            setCorAberta(null);
                        }}
                        className={`size-7 rounded-full border-2 ${c === e.color ? "border-gray-900" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                        aria-label={`Cor ${c}`}
                        onMouseDown={naoRoubaFoco}
                      />
                    ))}
                  </div>
                )}

                {apagando === e.id && (
                  <PainelDeApagar
                    etapa={e}
                    etapas={etapas}
                    marcos={marcosDa(e.id)}
                    ocupado={ocupado}
                    onCancelar={() => setApagando(null)}
                    onConfirmar={async (destinoId) => {
                      const destino = etapas.find((x) => x.id === destinoId);
                      const ok = await chamar(
                        `/api/funil/etapas/${e.id}?pipelineId=${encodeURIComponent(pipelineId)}&destino=${encodeURIComponent(destinoId)}`,
                        "DELETE"
                      );
                      if (ok) {
                        setApagando(null);
                        setAviso(
                          e.cartoes > 0
                            ? `"${e.name}" apagada. Os cartões foram para "${destino?.name}".`
                            : `"${e.name}" apagada.`
                        );
                      }
                    }}
                  />
                )}
              </li>
            ))}
          </ul>

          {/* ---- nova etapa ---- */}
          {etapas.length < TETO_DE_ETAPAS ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (novoNome.trim()) void criar();
              }}
            >
              <input
                value={novoNome}
                onChange={(ev) => setNovoNome(ev.target.value)}
                maxLength={TETO_DO_NOME}
                placeholder="Nome da nova etapa"
                className="flex-1 min-w-0 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
              <button
                type="submit"
                disabled={ocupado || !novoNome.trim()}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 disabled:opacity-40"
              >
                <Plus className="size-4" /> Criar
              </button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-gray-500">
              O funil já tem {TETO_DE_ETAPAS} etapas, o máximo. Junte ou apague alguma para criar outra.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-gray-400">
            A etapa nova entra antes da etapa de venda ganha. Depois é só ajustar a posição com as setas.
          </p>

          {/* ---- o que o sistema move sozinho ---- */}
          <div className="mt-6 rounded-xl bg-violet-50/60 border border-violet-100 p-3.5">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Bot className="size-4 text-violet-600" /> O sistema move o cartão sozinho
            </h4>
            <p className="text-xs text-gray-600 mt-1">
              Quando acontece cada coisa abaixo, o cartão vai para a etapa escolhida. Ele só{" "}
              <b>avança</b> (nunca volta para uma etapa anterior) — por isso a ordem das etapas importa.
              Só aparecem as etapas antes da venda ganha.
            </p>
            <div className="mt-3 space-y-2.5">
              {MARCOS.map((m) => (
                <label key={m} className="block">
                  <span className="block text-xs font-medium text-gray-700 mb-1">{ROTULO_DO_MARCO[m]}</span>
                  <select
                    value={marcos[m] ?? ""}
                    disabled={ocupado}
                    onChange={(ev) =>
                      void chamar("/api/funil/automaticas", "PUT", {
                        pipelineId,
                        marcos: { [m]: ev.target.value || null } as Partial<Record<Marco, string | null>>,
                      })
                    }
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white outline-none focus:border-brand-400"
                  >
                    <option value="">Não mover</option>
                    {abertas
                      .filter((e) => antesDoGanho(etapas, e.id))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          mover para: {e.name}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-2.5">
              Pedido pago leva o cartão para a etapa de venda ganha e pedido cancelado para a perdida — isso
              não muda.
            </p>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function Selo({ cor, children }: { cor: "sky" | "emerald" | "rose" | "violet"; children: React.ReactNode }) {
  const cls = {
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
  }[cor];
  return <span className={`rounded-full px-2 py-0.5 font-medium ${cls}`}>{children}</span>;
}

/** Nome editável: grava ao sair do campo ou no Enter; Esc desfaz. */
function NomeDaEtapa({
  etapa,
  desabilitado,
  onSalvar,
}: {
  etapa: EtapaDoEditor;
  desabilitado: boolean;
  onSalvar: (nome: string) => Promise<boolean>;
}) {
  const [rascunho, setRascunho] = useState(etapa.name);
  const [visto, setVisto] = useState(etapa.name);
  // o servidor mudou o nome (outra aba, ou a resposta limpou espaços):
  // o campo acompanha
  if (etapa.name !== visto) {
    setVisto(etapa.name);
    setRascunho(etapa.name);
  }
  async function salvar() {
    if (rascunho.trim() === etapa.name) {
      setRascunho(etapa.name);
      return;
    }
    if (!(await onSalvar(rascunho))) setRascunho(etapa.name);
  }
  return (
    <input
      value={rascunho}
      disabled={desabilitado}
      maxLength={TETO_DO_NOME}
      onChange={(ev) => setRascunho(ev.target.value)}
      onBlur={() => void salvar()}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
        if (ev.key === "Escape") setRascunho(etapa.name);
      }}
      className="flex-1 min-w-0 rounded-lg border border-transparent hover:border-gray-200 focus:border-brand-400 px-2 py-1.5 text-sm font-medium outline-none"
      aria-label="Nome da etapa"
    />
  );
}

function PainelDeApagar({
  etapa,
  etapas,
  marcos,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  etapa: EtapaDoEditor;
  etapas: EtapaDoEditor[];
  marcos: Marco[];
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (destinoId: string) => void;
}) {
  const opcoes = etapas.filter((e) => ehAberta(e) && e.id !== etapa.id);
  const [destino, setDestino] = useState(opcoes[0]?.id ?? "");
  const problema = problemaAoApagar(etapas, etapa.id, destino || null, marcos.length > 0);
  const nomeDestino = opcoes.find((e) => e.id === destino)?.name ?? "";
  return (
    <div className="mt-2.5 rounded-xl bg-rose-50/70 border border-rose-100 p-3 text-sm">
      <p className="font-medium text-rose-800">Apagar &quot;{etapa.name}&quot;?</p>
      {opcoes.length > 0 && (
        <label className="block mt-2">
          <span className="block text-xs text-gray-700 mb-1">
            {etapa.cartoes > 0
              ? `Os ${etapa.cartoes} ${etapa.cartoes === 1 ? "cartão desta etapa vai" : "cartões desta etapa vão"} para:`
              : "O que vinha para esta etapa passa a ir para:"}
          </span>
          <select
            value={destino}
            onChange={(ev) => setDestino(ev.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
          >
            {opcoes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {marcos.length > 0 && nomeDestino && (
        <p className="mt-2 text-xs text-gray-700">
          🤖 O sistema movia cartões para cá quando{" "}
          {marcos.map((m) => ROTULO_DO_MARCO[m].toLowerCase()).join("; ")}. Isso passa a mover para{" "}
          <b>&quot;{nomeDestino}&quot;</b>.
        </p>
      )}
      {problema && <p className="mt-2 text-xs text-rose-700">{problema}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-white">
          Cancelar
        </button>
        <button
          type="button"
          disabled={ocupado || !!problema}
          onClick={() => onConfirmar(destino)}
          className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40"
        >
          Apagar etapa
        </button>
      </div>
    </div>
  );
}
