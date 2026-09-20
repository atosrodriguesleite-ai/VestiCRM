"use client";

/**
 * REAJUSTAR PREÇO EM LOTE, POR CATEGORIA (RN-056). Gerência.
 *
 * O caminho é sempre prévia → aplicar: a lojista vê quantas peças mudam, o
 * antes e o depois, e o que fica de fora (peça da Nuvemshop, sem preço)
 * ANTES de gravar. Quem faz a conta é o servidor, nos dois passos.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Portal } from "@/components/portal";
import { AlertTriangle, Loader2, Percent, X } from "lucide-react";
import { brl } from "@/lib/format";
import { lerNumeroDigitado, type LinhaDoReajuste, type ResumoDoReajuste } from "@/lib/reajuste-preco-regra";

type Previa = { resumo: ResumoDoReajuste; linhas: LinhaDoReajuste[]; cortada: boolean };

export function ReajustePreco({ categories }: { categories: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [atacado, setAtacado] = useState(true);
  const [varejo, setVarejo] = useState(false);
  const [modo, setModo] = useState<"percentual" | "fixo">("percentual");
  const [valor, setValor] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState<ResumoDoReajuste | null>(null);

  const campos = [...(atacado ? ["atacado"] : []), ...(varejo ? ["varejo"] : [])];
  const numero = lerNumeroDigitado(valor);
  // valor fixo nos DOIS campos deixa atacado e varejo IGUAIS: quase nunca é
  // o que se quer, e numa lista de 200 linhas isso não salta aos olhos
  const fixoNosDois = modo === "fixo" && atacado && varejo;
  const pronto = !!categoria && campos.length > 0 && Number.isFinite(numero);

  function fechar() {
    setOpen(false);
    setPrevia(null);
    setErro("");
    setFeito(null);
  }

  async function chamar(aplicar: boolean) {
    setBusy(true);
    setErro("");
    try {
      const r = await fetch("/api/products/reajuste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoria, campos, modo, valor: numero, aplicar }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error ?? "Não foi possível calcular o reajuste.");
        return;
      }
      if (aplicar) {
        setFeito(d.resumo);
        setPrevia(null);
        router.refresh();
      } else {
        setPrevia(d);
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-brand-300"
        title="Reajustar o preço de uma categoria inteira de uma vez"
      >
        <Percent className="size-4" />
        <span className="hidden sm:inline">Reajustar preço</span>
      </button>
      {open && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end justify-center pb-[var(--kb,0px)] translate-y-[var(--kbtop,0px)] md:items-center">
            <div className="absolute inset-0 bg-black/40" onClick={fechar} />
            <div className="relative flex max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop md:max-w-2xl md:rounded-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h3 className="text-lg font-semibold">Reajustar preço por categoria</h3>
                <button onClick={fechar} className="p-1 text-gray-400">
                  <X className="size-5" />
                </button>
              </div>
              <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {feito ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    <p className="font-semibold">Pronto! ✅</p>
                    <p className="mt-1">
                      {feito.alterados} de {feito.total} produto{feito.total === 1 ? "" : "s"} da
                      categoria <b>{categoria}</b> {feito.alterados === 1 ? "teve" : "tiveram"} o
                      preço reajustado. Já vale no catálogo.
                    </p>
                    <AvisosDoResumo resumo={feito} />
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-gray-700">Categoria</span>
                        <select
                          value={categoria}
                          onChange={(e) => {
                            setCategoria(e.target.value);
                            setPrevia(null);
                          }}
                          className={input}
                        >
                          <option value="">Escolha…</option>
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="text-sm">
                        <span className="mb-1 block font-medium text-gray-700">Qual preço</span>
                        <div className="flex gap-4 pt-2">
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={atacado}
                              onChange={(e) => {
                                setAtacado(e.target.checked);
                                setPrevia(null);
                              }}
                            />
                            Atacado
                          </label>
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={varejo}
                              onChange={(e) => {
                                setVarejo(e.target.checked);
                                setPrevia(null);
                              }}
                            />
                            Varejo
                          </label>
                        </div>
                      </div>
                      <div className="text-sm">
                        <span className="mb-1 block font-medium text-gray-700">Como</span>
                        <div className="flex gap-4 pt-2">
                          <label className="flex items-center gap-1.5">
                            <input
                              type="radio"
                              checked={modo === "percentual"}
                              onChange={() => {
                                setModo("percentual");
                                setPrevia(null);
                              }}
                            />
                            Percentual
                          </label>
                          <label className="flex items-center gap-1.5">
                            <input
                              type="radio"
                              checked={modo === "fixo"}
                              onChange={() => {
                                setModo("fixo");
                                setPrevia(null);
                              }}
                            />
                            Valor fixo
                          </label>
                        </div>
                      </div>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-gray-700">
                          {modo === "percentual" ? "Percentual (use - para baixar)" : "Novo preço (R$)"}
                        </span>
                        <input
                          value={valor}
                          onChange={(e) => {
                            setValor(e.target.value);
                            setPrevia(null);
                          }}
                          inputMode="decimal"
                          placeholder={modo === "percentual" ? "ex.: 10 ou -5" : "ex.: 89,90"}
                          className={input}
                        />
                      </label>
                    </div>
                    <p className="text-xs text-gray-500">
                      Peça vinculada à Nuvemshop: o varejo muda aqui e vai para lá sozinho. Peça do
                      Jueri tem os dois preços lá e fica de fora; a prévia diz quais. Percentual não
                      cria preço onde está zero.
                    </p>
                    {fixoNosDois && (
                      <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                        <AlertTriangle className="size-4 shrink-0" />
                        Atenção: com valor fixo nos dois, atacado e varejo ficarão IGUAIS em toda a categoria.
                      </p>
                    )}
                    {erro && (
                      <p className="flex items-center gap-1.5 text-sm text-rose-600">
                        <AlertTriangle className="size-4" /> {erro}
                      </p>
                    )}
                    {previa && (
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
                        <p className="font-semibold text-gray-800">
                          {previa.resumo.alterados} de {previa.resumo.total} produto
                          {previa.resumo.total === 1 ? "" : "s"} vão mudar
                        </p>
                        <AvisosDoResumo resumo={previa.resumo} />
                        {previa.linhas.length > 0 && (
                          <div className="mt-2 max-h-64 overflow-y-auto thin-scroll">
                            <table className="w-full text-xs">
                              <tbody>
                                {previa.linhas.map((l) => (
                                  <tr key={l.id} className="border-t border-gray-100">
                                    <td className="py-1 pr-2 align-top">{l.nome}</td>
                                    <td className="py-1 text-right align-top">
                                      {l.atacado && (
                                        <div>
                                          atacado {brl(l.atacado.de)} → <b>{brl(l.atacado.para)}</b>
                                        </div>
                                      )}
                                      {l.varejo && (
                                        <div>
                                          varejo {brl(l.varejo.de)} → <b>{brl(l.varejo.para)}</b>
                                          {l.espelhaVarejo && (
                                            <span className="ml-1 text-sky-700">· vai para a Nuvemshop</span>
                                          )}
                                        </div>
                                      )}
                                      {l.avisos.map((a) => (
                                        <div key={a} className="text-amber-700">
                                          {a}
                                        </div>
                                      ))}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {previa.cortada && (
                              <p className="mt-1 text-[11px] text-gray-400">
                                Mostrando as primeiras {previa.linhas.length}; o total acima conta todas.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
                <button onClick={fechar} className="rounded-xl px-3 py-2 text-sm text-gray-500">
                  {feito ? "Fechar" : "Cancelar"}
                </button>
                {!feito && !previa && (
                  <button
                    onClick={() => chamar(false)}
                    disabled={!pronto || busy}
                    className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />} Ver prévia
                  </button>
                )}
                {!feito && previa && (
                  <button
                    onClick={() => chamar(true)}
                    disabled={busy || previa.resumo.alterados === 0}
                    className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    Aplicar em {previa.resumo.alterados} produto{previa.resumo.alterados === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

function AvisosDoResumo({ resumo }: { resumo: ResumoDoReajuste }) {
  const avisos: string[] = [];
  if (resumo.presos.jueri) avisos.push(`${resumo.presos.jueri} preço(s) são do Jueri e ficam de fora`);
  if (resumo.semPreco) avisos.push(`${resumo.semPreco} preço(s) estão zerados e ficam de fora`);
  if (avisos.length === 0 && !resumo.espelhados) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {resumo.espelhados > 0 && (
        <li className="text-sky-700">
          • {resumo.espelhados} preço(s) de varejo mudam aqui e vão para a Nuvemshop sozinhos (a ficha
          mostra ⏳ até ela confirmar)
        </li>
      )}
      {avisos.map((a) => (
        <li key={a} className="text-amber-700">
          • {a}
        </li>
      ))}
    </ul>
  );
}
