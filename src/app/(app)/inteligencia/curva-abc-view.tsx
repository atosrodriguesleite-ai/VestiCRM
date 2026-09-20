"use client";

/**
 * CURVA ABC — o bloco INTERATIVO da tela Inteligência (RN-061).
 *
 * Pedido do dono (20/09/2026, pelo celular): "queria uma forma mais fluida
 * de navegar pelas classes" e "quando clico para ver mais ela chega a
 * travar". As duas coisas tinham a mesma causa: cada clique (trocar a base,
 * ver todas) era um LINK que recarregava a página inteira — e a
 * Inteligência refaz umas quinze consultas a cada abertura. No celular isso
 * é um congelamento de segundos para mostrar 25 linhas a mais.
 *
 * Agora o servidor manda a curva PRONTA nas DUAS bases (unidades e
 * faturamento — é a mesma conta pura rodada duas vezes sobre os mesmos
 * itens) e tudo que é navegação acontece aqui, sem ir ao servidor: trocar a
 * base, filtrar por classe (tocando no cartão da classe ou no chip), buscar
 * uma peça pelo nome, e "mostrar mais" em blocos. O endereço da página é
 * atualizado por baixo (`history.replaceState`) para o CSV e o link
 * compartilhado continuarem apontando para a base que está na tela.
 */

import { useMemo, useState } from "react";
import { Download, Search, X } from "lucide-react";
import { brl } from "@/lib/format";
import { casaTexto } from "@/lib/busca";
import { Badge, EmptyState } from "@/components/ui";
import type { BaseAbc, ClasseAbc, LinhaAbc, ResumoAbc } from "@/lib/tracking/curva-abc";

export type CurvaPronta = {
  linhas: LinhaAbc[];
  resumo: ResumoAbc;
  totalUnidades: number;
  totalFaturamento: number;
};

type Filtro = "todas" | ClasseAbc;

export const COR_CLASSE: Record<ClasseAbc, string> = { A: "#059669", B: "#d97706", C: "#94a3b8" };

/** quantas linhas aparecem de saída e de quanto em quanto o "mostrar mais" cresce */
export const BLOCO_ABC = 25;
export const PASSO_ABC = 50;

/** porcentagem com UMA casa e vírgula, como a lojista lê ("3,0%", não "3.0%") */
export const pct1 = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/**
 * A régua do filtro, PURA (testada): quais linhas ficam, mantendo o número
 * da posição na curva inteira — filtrar por B mostra "90. …", não "1. …",
 * porque a posição é a informação (é a 90ª peça que mais vende). A busca é
 * por PALAVRAS, todas obrigatórias, em qualquer ordem e sem acento
 * ("alça preta" acha "Regata Alça · Preta · M") — a régua da lupa da Central.
 */
export function filtrarLinhas(
  linhas: LinhaAbc[],
  filtro: Filtro,
  busca: string
): { posicao: number; linha: LinhaAbc }[] {
  const palavras = busca.trim().split(/\s+/).filter(Boolean);
  const saida: { posicao: number; linha: LinhaAbc }[] = [];
  linhas.forEach((linha, i) => {
    if (filtro !== "todas" && linha.classe !== filtro) return;
    if (palavras.length && !palavras.every((p) => casaTexto(linha.rotulo, p))) return;
    saida.push({ posicao: i + 1, linha });
  });
  return saida;
}

export function CurvaAbcView({
  porUnidades,
  porFaturamento,
  baseInicial,
  periodoTexto,
  csvPrefixo,
  cortadaEm,
}: {
  porUnidades: CurvaPronta;
  porFaturamento: CurvaPronta;
  baseInicial: BaseAbc;
  /** "01/08/2026 a 31/08/2026" ou "últimos 30 dias" */
  periodoTexto: string;
  /** endereço do CSV sem a base — a base vai colada aqui conforme a tela */
  csvPrefixo: string;
  /** quantas linhas ficaram de fora do que veio para a tela (loja gigante); 0 = nenhuma */
  cortadaEm: number;
}) {
  const [base, setBase] = useState<BaseAbc>(baseInicial);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState(BLOCO_ABC);

  const curva = base === "unidades" ? porUnidades : porFaturamento;
  const visiveis = useMemo(() => filtrarLinhas(curva.linhas, filtro, busca), [curva, filtro, busca]);
  const naTela = visiveis.slice(0, mostrar);
  const sobra = visiveis.length - naTela.length;

  const trocarBase = (b: BaseAbc) => {
    setBase(b);
    // o endereço acompanha, sem recarregar: o CSV e o link compartilhado
    // apontam para a base que está na tela
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("abc", b);
      url.hash = "abc";
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* navegador sem history: a tela segue funcionando */
    }
  };
  const alternarClasse = (cl: ClasseAbc) => {
    setFiltro((atual) => (atual === cl ? "todas" : cl));
    setMostrar(BLOCO_ABC);
  };
  const recolher = () => {
    setMostrar(BLOCO_ABC);
    document.getElementById("abc")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const rotuloBase = base === "unidades" ? "das unidades vendidas" : "do faturamento";
  const cabecalhoPct = base === "unidades" ? "% un." : "% R$";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <p className="text-xs text-gray-500">
          {curva.totalUnidades.toLocaleString("pt-BR")} unidades vendidas em {curva.linhas.length} variaç
          {curva.linhas.length === 1 ? "ão" : "ões"} (peça exata) · {periodoTexto}
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
            {(["unidades", "faturamento"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => trocarBase(b)}
                aria-pressed={base === b}
                className={`px-3 py-1.5 transition ${base === b ? "bg-brand-600 text-white" : "bg-white text-gray-500 hover:text-gray-800"}`}
              >
                {b === "unidades" ? "Por unidades" : "Por faturamento"}
              </button>
            ))}
          </div>
          <a href={`${csvPrefixo}&abc=${base}`} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
            <Download className="size-3.5" /> CSV
          </a>
        </div>
      </div>

      {curva.linhas.length === 0 ? (
        <EmptyState title="Nenhuma peça vendida no período" hint="A curva conta só pedidos pagos, pela data do pagamento." />
      ) : (
        <>
          {/* Os cartões das classes SÃO o filtro: tocar em "Classe A" mostra
              só as peças A; tocar de novo volta para todas. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            {(["A", "B", "C"] as const).map((cl) => {
              const r = curva.resumo[cl];
              const ativo = filtro === cl;
              return (
                <button
                  key={cl}
                  type="button"
                  onClick={() => alternarClasse(cl)}
                  aria-pressed={ativo}
                  className={`text-left rounded-xl border px-3 py-2.5 transition ${
                    ativo ? "border-brand-400 bg-brand-50/60 ring-2 ring-brand-200" : "border-gray-100 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge color={COR_CLASSE[cl]}>Classe {cl}</Badge>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {r.itens} variaç{r.itens === 1 ? "ão" : "ões"} · {r.parteItens.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-2 text-sm font-semibold tabular-nums">
                    <span>{r.unidades.toLocaleString("pt-BR")} un.</span>
                    <span className="text-gray-500 font-normal">{brl(r.faturamento)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {r.parteBase.toFixed(0)}% {rotuloBase}
                    {ativo && <span className="ml-1 font-medium text-brand-700">· mostrando só a classe {cl}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Chips + busca: a barra de navegação da lista */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
              {(["todas", "A", "B", "C"] as const).map((f) => {
                const n = f === "todas" ? curva.linhas.length : curva.resumo[f].itens;
                const ativo = filtro === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFiltro(f);
                      setMostrar(BLOCO_ABC);
                    }}
                    aria-pressed={ativo}
                    className={`px-3 py-1.5 tabular-nums transition ${ativo ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:text-gray-900"}`}
                  >
                    {f === "todas" ? "Todas" : f} <span className={ativo ? "text-gray-300" : "text-gray-400"}>{n}</span>
                  </button>
                );
              })}
            </div>
            <label className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-400" />
              <input
                type="search"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setMostrar(BLOCO_ABC);
                }}
                placeholder="Buscar peça (ex.: regata preta)"
                className="w-full rounded-xl border border-gray-200 bg-white pl-8 pr-7 py-1.5 text-xs focus:border-brand-400 focus:outline-none"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </label>
          </div>

          {visiveis.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">
              Nenhuma peça {filtro !== "todas" ? `da classe ${filtro} ` : ""}
              {busca.trim() ? `com "${busca.trim()}"` : ""} no período.
            </p>
          ) : (
            <>
              {/* Computador: tabela */}
              <div className="hidden md:block overflow-x-auto thin-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                      {["Peça", "Classe", "Unidades", cabecalhoPct, "Acumulado", "Faturamento"].map((h, i) => (
                        <th key={h} className={`py-2 pr-3 font-semibold ${i > 0 ? "text-right" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {naTela.map(({ posicao, linha: l }) => (
                      <tr key={l.chave}>
                        <td className="py-2 pr-3 font-medium">
                          <span className="text-gray-400 tabular-nums mr-2">{posicao}.</span>
                          {l.rotulo}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Badge color={COR_CLASSE[l.classe]}>{l.classe}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{l.unidades} un.</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{pct1(l.parte)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{pct1(l.acumulado)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{brl(l.faturamento)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Celular: um cartão de DUAS linhas por peça — nome e classe em
                  cima, os quatro números numa frase embaixo. O cartão
                  genérico espalhava seis pares rótulo/valor que quebravam
                  torto (print do dono, 20/09/2026). */}
              <div className="md:hidden space-y-1.5">
                {naTela.map(({ posicao, linha: l }) => (
                  <div key={l.chave} className="rounded-xl border border-gray-100 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium text-gray-800 leading-snug">
                        <span className="text-gray-400 tabular-nums mr-1.5">{posicao}.</span>
                        {l.rotulo}
                      </span>
                      <span className="shrink-0">
                        <Badge color={COR_CLASSE[l.classe]}>{l.classe}</Badge>
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3 text-xs tabular-nums">
                      <span className="text-gray-500">
                        <span className="font-semibold text-gray-700">{l.unidades} un.</span>
                        {" · "}
                        {pct1(l.parte)} {base === "unidades" ? "das un." : "do R$"}
                        {" · "}acum. {pct1(l.acumulado)}
                      </span>
                      <span className="shrink-0 font-semibold text-gray-700">{brl(l.faturamento)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* "Mostrar mais" cresce AQUI, em blocos — nada de recarregar a
                  página para ver 25 linhas a mais */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-medium">
                {sobra > 0 && (
                  <>
                    <button type="button" onClick={() => setMostrar((m) => m + PASSO_ABC)} className="text-brand-600 hover:underline">
                      Mostrar mais {Math.min(PASSO_ABC, sobra)} (faltam {sobra})
                    </button>
                    <button type="button" onClick={() => setMostrar(visiveis.length)} className="text-gray-500 hover:underline">
                      Mostrar todas as {visiveis.length}
                    </button>
                  </>
                )}
                {mostrar > BLOCO_ABC && naTela.length > BLOCO_ABC && (
                  <button type="button" onClick={recolher} className="text-gray-500 hover:underline">
                    Recolher para as {BLOCO_ABC} primeiras
                  </button>
                )}
              </div>
              {cortadaEm > 0 && (
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  A tela mostra as {curva.linhas.length.toLocaleString("pt-BR")} peças que mais vendem; as outras {cortadaEm.toLocaleString("pt-BR")} estão no CSV.
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
