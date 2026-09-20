"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * A GRADE DE PEÇAS (RN-062) — escolher cor × tamanho do jeito que a lojista
 * pensa: linhas de cor, colunas de tamanho, e ela preenche as quantidades.
 *
 * O montador antigo pedia UMA variação por vez e fechava a busca a cada
 * peça adicionada: a grade de 3 cores × 3 tamanhos custava nove idas e nove
 * vezes digitando o nome do modelo. Aqui o pedido inteiro daquele modelo sai
 * de uma tela só.
 *
 * Quem manda no PREÇO é quem chama (`precoUnitario`) — a grade só mostra o
 * número e nunca decide dinheiro (RN-041). E a quantidade PARA no estoque:
 * a porta de criação recusa o pedido inteiro quando falta peça (409), então
 * oferecer mais do que existe seria levar a lojista a um beco no último
 * clique (achado da revisão).
 */

import { useMemo, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { brl } from "@/lib/format";
import {
  chaveDaCelula,
  montarGrade,
  quantidadeDigitada,
  repetirNaLinha as repetirNaLinhaDaGrade,
  resumoDaGrade,
  type VariacaoDaGrade,
} from "@/lib/pedido-grade";

export type ProdutoDaGrade = {
  id: string;
  name: string;
  sku: string;
  images: { url: string }[];
  variants: VariacaoDaGrade[];
  minQuantity?: number;
  wholesalePrice?: number;
};

export function GradeDePecas({
  produto,
  quantidadesIniciais,
  precoUnitario,
  jaNoPedido,
  onCancelar,
  onAplicar,
}: {
  produto: ProdutoDaGrade;
  /** o que já está no pedido: a grade ABRE preenchida e substitui (RN-062) */
  quantidadesIniciais: ReadonlyMap<string, number>;
  precoUnitario: (quantidadeDaCelula: number) => number;
  jaNoPedido: boolean;
  onCancelar: () => void;
  onAplicar: (quantidades: Map<string, number>) => void;
}) {
  const grade = useMemo(() => montarGrade(produto.variants), [produto.variants]);
  const [texto, setTexto] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const [id, q] of quantidadesIniciais) if (q > 0) inicial[id] = String(q);
    return inicial;
  });

  const quantidades = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const [id, t] of Object.entries(texto)) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n > 0) mapa.set(id, n);
    }
    return mapa;
  }, [texto]);

  const resumo = useMemo(() => resumoDaGrade(quantidades, precoUnitario), [quantidades, precoUnitario]);
  const umaCelulaSo = grade.cores.length === 1 && grade.tamanhos.length === 1;

  const escrever = (variantId: string, valor: string, estoque: number) => {
    setTexto((prev) => ({ ...prev, [variantId]: quantidadeDigitada(valor, estoque) }));
  };

  /** "3 de cada tamanho": preenche só as células VAZIAS daquela cor. */
  const repetirNaLinha = (cor: string) => {
    const celulas = grade.tamanhos
      .map((t) => grade.celulas.get(chaveDaCelula(cor, t)))
      .filter((v): v is VariacaoDaGrade => !!v);
    setTexto((prev) => repetirNaLinhaDaGrade(prev, celulas));
  };

  const totalDaLinha = (cor: string) =>
    grade.tamanhos.reduce((s, t) => {
      const v = grade.celulas.get(chaveDaCelula(cor, t));
      return s + (v ? quantidades.get(v.id) ?? 0 : 0);
    }, 0);
  const totalDaColuna = (tamanho: string) =>
    grade.cores.reduce((s, c) => {
      const v = grade.celulas.get(chaveDaCelula(c, tamanho));
      return s + (v ? quantidades.get(v.id) ?? 0 : 0);
    }, 0);

  const precoDaVitrine = precoUnitario(Math.max(1, resumo.pecas));

  return (
    <div className="absolute inset-0 z-20 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onCancelar} />
      <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-lg max-h-[92%] md:max-h-[86%] flex flex-col animate-fade-up">
        {/* cabeçalho: foto grande o bastante para reconhecer a peça */}
        <div className="flex items-start gap-3 p-4 pb-3 border-b border-gray-100 shrink-0">
          {produto.images[0] ? (
            <img src={produto.images[0].url} alt="" className="size-14 rounded-xl object-cover bg-gray-50 shrink-0" />
          ) : (
            <span className="size-14 rounded-xl bg-gray-100 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm leading-tight">{produto.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{produto.sku}</p>
            <p className="text-sm font-semibold text-brand-700 mt-1 tabular-nums">
              {brl(precoDaVitrine)}
              {(produto.minQuantity ?? 1) > 1 && (produto.wholesalePrice ?? 0) > 0 && (
                <span className="text-[10px] text-gray-400 font-normal"> · atacado a partir de {produto.minQuantity} un.</span>
              )}
            </p>
          </div>
          <button onClick={onCancelar} aria-label="Fechar" className="text-gray-400 p-1 -mt-1">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto thin-scroll p-4">
          {umaCelulaSo ? (
            // peça sem grade (cor única, tamanho único): um campo só, sem tabela
            (() => {
              const v = grade.celulas.get(chaveDaCelula(grade.cores[0], grade.tamanhos[0]))!;
              return (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Quantidade</p>
                    <p className="text-[11px] text-gray-400">{rotuloEstoque(v.stock)}</p>
                  </div>
                  <CampoDaCelula
                    valor={texto[v.id] ?? ""}
                    estoque={v.stock}
                    grande
                    onChange={(t) => escrever(v.id, t, v.stock)}
                  />
                </div>
              );
            })()
          ) : (
            <>
              <p className="text-[11px] text-gray-400 mb-2">
                Digite quantas peças de cada cor e tamanho. O que ficar em branco não entra.
              </p>
              <div className="-mx-1 overflow-x-auto thin-scroll">
                <table className="border-separate border-spacing-1">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-white z-10" />
                      {grade.tamanhos.map((t) => (
                        <th key={t} className="text-[11px] font-semibold text-gray-500 px-1 pb-0.5 min-w-14">
                          {t}
                        </th>
                      ))}
                      <th className="text-[11px] font-semibold text-gray-400 px-1 pb-0.5">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grade.cores.map((cor) => {
                      const daLinha = totalDaLinha(cor);
                      return (
                        <tr key={cor}>
                          <th className="sticky left-0 bg-white z-10 pr-2 text-left align-middle">
                            <span className="block text-xs font-medium text-gray-700 max-w-24 truncate" title={cor}>
                              {cor}
                            </span>
                            {/* "3 de cada tamanho": só aparece quando há um
                                número para repetir — link que não faz nada
                                é ruído em tela de celular */}
                            {daLinha > 0 && (
                              <button
                                type="button"
                                onClick={() => repetirNaLinha(cor)}
                                className="text-[10px] text-brand-600 hover:text-brand-700 inline-flex items-center gap-0.5"
                              >
                                repetir <ArrowRight className="size-2.5" />
                              </button>
                            )}
                          </th>
                          {grade.tamanhos.map((t) => {
                            const v = grade.celulas.get(chaveDaCelula(cor, t));
                            if (!v) {
                              return (
                                <td key={t} className="text-center">
                                  <span className="block h-11 rounded-xl bg-gray-50/70" title="A loja não cadastrou essa combinação" />
                                </td>
                              );
                            }
                            return (
                              <td key={t} className="text-center align-top">
                                <CampoDaCelula
                                  valor={texto[v.id] ?? ""}
                                  estoque={v.stock}
                                  rotulo={`${cor} ${t}`}
                                  onChange={(novo) => escrever(v.id, novo, v.stock)}
                                />
                              </td>
                            );
                          })}
                          <td className="text-center align-middle">
                            <span className={`text-xs font-semibold tabular-nums ${daLinha > 0 ? "text-gray-800" : "text-gray-300"}`}>
                              {daLinha}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {grade.cores.length > 1 && (
                    <tfoot>
                      <tr>
                        <th className="sticky left-0 bg-white z-10 pr-2 text-left text-[11px] font-medium text-gray-400">
                          Por tamanho
                        </th>
                        {grade.tamanhos.map((t) => {
                          const n = totalDaColuna(t);
                          return (
                            <td key={t} className="text-center">
                              <span className={`text-[11px] tabular-nums ${n > 0 ? "text-gray-600 font-semibold" : "text-gray-300"}`}>
                                {n}
                              </span>
                            </td>
                          );
                        })}
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>

        {/* rodapé: o que vai entrar, em peças e em dinheiro, antes de confirmar */}
        <div className="border-t border-gray-100 p-4 shrink-0 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tabular-nums">
              {resumo.pecas} {resumo.pecas === 1 ? "peça" : "peças"}
              {resumo.pecas > 0 && <span className="text-gray-400 font-normal"> · {brl(resumo.valor)}</span>}
            </p>
            <p className="text-[11px] text-gray-400">
              {resumo.pecas === 0
                ? jaNoPedido
                  ? "Zerar tudo remove a peça do pedido."
                  : "Preencha ao menos uma quantidade."
                : "A quantidade para no que há em estoque."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onAplicar(quantidades)}
            disabled={resumo.pecas === 0 && !jaNoPedido}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-40 inline-flex items-center gap-1.5 shrink-0"
          >
            <Check className="size-4" />
            {jaNoPedido ? "Atualizar" : "Adicionar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const rotuloEstoque = (estoque: number) => (estoque > 0 ? `${estoque} em estoque` : "sem estoque");

function CampoDaCelula({
  valor,
  estoque,
  rotulo,
  grande,
  onChange,
}: {
  valor: string;
  estoque: number;
  rotulo?: string;
  grande?: boolean;
  onChange: (valor: string) => void;
}) {
  const digitado = parseInt(valor, 10) || 0;
  const semEstoque = estoque <= 0;
  const noTeto = !semEstoque && digitado >= estoque;
  return (
    <span className="block">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={semEstoque ? "" : valor}
        disabled={semEstoque}
        aria-label={rotulo ? `Quantidade ${rotulo}` : "Quantidade"}
        title={semEstoque ? "Sem estoque desta peça" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        placeholder={semEstoque ? "—" : "0"}
        className={`${grande ? "w-24 h-12 text-lg" : "w-14 h-11 text-sm"} rounded-xl border text-center font-semibold tabular-nums outline-none transition ${
          semEstoque
            ? "border-gray-100 bg-gray-50 text-gray-300 placeholder:text-gray-300 cursor-not-allowed"
            : digitado > 0
              ? "border-brand-400 bg-brand-50 text-brand-800"
              : "border-gray-200 text-gray-700 placeholder:font-normal placeholder:text-gray-200 focus:border-brand-400"
        }`}
      />
      {/* embaixo de cada célula, o que existe na arara — e "máx" quando a
          quantidade bate no teto, para o número que parou de subir não
          parecer defeito do campo */}
      <span className={`block text-[10px] mt-0.5 ${noTeto ? "text-amber-600 font-medium" : "text-gray-400"}`}>
        {semEstoque ? "—" : noTeto ? `máx ${estoque}` : estoque}
      </span>
    </span>
  );
}
