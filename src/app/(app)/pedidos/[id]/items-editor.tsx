"use client";

/* eslint-disable @next/next/no-img-element */

import { precoSugeridoNoPedido } from "@/lib/orders";

/**
 * EDIÇÃO DOS ITENS DO PEDIDO — a MESMA experiência do "Novo pedido" (RN-062),
 * pensada para o celular (pedido do dono, 05/10/2026, com o print do iPhone:
 * a lista de busca apertada embaixo do campo, o teclado por cima, e quatro
 * linhas "Regata Alça · R$ 32" sem dizer qual peça é qual).
 *
 * Duas telas dentro da janela: as PEÇAS DO PEDIDO (agrupadas por modelo, com
 * − e + grandes por cor × tamanho, preço por modelo e a grade a um toque) e
 * ADICIONAR (a busca com cartões que dizem foto, código, categoria, cores e
 * estoque, abrindo a grade cor × tamanho já preenchida com o que está no
 * pedido). A janela ocupa a área visível MEDIDA pelo navegador
 * (`--vvh`/`--vvtop`) e trava a página de trás — a lição da grade.
 *
 * Dinheiro não muda de dono: o preço sugerido continua saindo de
 * `precoSugeridoNoPedido` (RN-041), o preço digitado à mão nunca é reescrito
 * pela grade, e o salvar manda as MESMAS linhas de sempre para o PATCH.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Portal } from "@/components/portal";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { brl, numeroBR } from "@/lib/format";
import {
  aplicarGradeNoPedido,
  pecasNoPedido,
  precoUnicoDoModelo,
  quantidadeDigitada,
  quantidadesNoPedido,
  seguradasPorVariacao,
  somarOQueOPedidoSegura,
  TETO_COM_EXTRA,
  type LinhaDoPedido,
} from "@/lib/pedido-grade";
import { GradeDePecas, type ProdutoDaGrade } from "@/components/pedido/grade-de-pecas";
import { useTravarFundo } from "@/components/travar-fundo";
import { useConfirmarExtras } from "@/components/pedido/confirmar-extras";

type ApiVariant = { id: string; color: string; size: string; stock: number; sobEncomenda?: boolean };
type ApiProduct = ProdutoDaGrade & {
  category?: string;
  wholesalePrice: number;
  retailPrice: number;
  variants: ApiVariant[];
};

/**
 * Uma linha do pedido como a ficha entrega (cor e tamanho separados).
 * `segurado` é o que ESTE pedido já segura da variação (RN-003): o `stock`
 * da peça vem já sem isso, e o teto da tela é a soma dos dois.
 */
export type Line = LinhaDoPedido & { segurado?: number };

type Tela = "pecas" | "adicionar";

/** a chave do grupo na tela: o modelo; a linha sem vínculo é grupo próprio (pela posição) */
const chaveDoGrupo = (l: { productId: string }, i: number) => l.productId || `sem-vinculo-${i}`;
/** a chave de UMA linha: a variação; sem vínculo, a posição */
const chaveDaLinha = (l: { variantId: string }, i: number) => l.variantId || `sem-vinculo-${i}`;

/** as linhas como a tela as edita: o teto já somando o que o pedido segura (RN-003) */
const linhasIniciais = (itens: Line[]): Line[] =>
  itens.map((l) =>
    l.segurado ? { ...l, stock: (l.sobEncomenda ? l.stock : Math.max(0, l.stock)) + l.segurado } : l
  );

export function ItemsEditor({
  orderId,
  initialItems,
  discount,
  shippingFee,
  surcharge = 0,
  creditoTroca = 0,
  alreadyPaid = false,
  priceMode = null,
  campaignDiscount = 0,
  source = null,
  catalogPriceMode = null,
}: {
  orderId: string;
  initialItems: Line[];
  discount: number;
  shippingFee: number;
  /** acréscimo do pedido (a prévia do total o soma, como o servidor) */
  surcharge?: number;
  /** RN-074: crédito de troca abatido — a prévia mostra o total já com ele */
  creditoTroca?: number;
  alreadyPaid?: boolean;
  /**
   * TABELA que precificou o pedido (do link de atacado/varejo). O item
   * acrescentado depois segue a MESMA tabela — antes o sistema sugeria
   * atacado sempre que existisse, inclusive num pedido de varejo (revisão
   * 18/08/2026).
   */
  priceMode?: string | null;
  /**
   * DESCONTO DO LINK DE CAMPANHA que precificou o pedido (RN-040). Mesmo
   * motivo da tabela acima: sem ele, três peças saíam a R$ 80 e a quarta,
   * acrescentada depois, a R$ 100 — no mesmo pedido (revisão 01/09/2026).
   */
  campaignDiscount?: number;
  /** de onde o pedido veio (CATALOGO | NUVEMSHOP | MANUAL) — RN-041 */
  source?: string | null;
  /** a tabela que o catálogo desta loja mostra */
  catalogPriceMode?: string | null;
}) {
  /** preço a sugerir para uma peça nova: regra ÚNICA, em `lib/orders.ts`. */
  const precoSugerido = (p: { wholesalePrice: number; retailPrice: number }) =>
    precoSugeridoNoPedido(p, { priceMode, source, catalogPriceMode, campaignDiscount });

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tela, setTela] = useState<Tela>("pecas");
  // o teto de cada variação que o pedido já segura: disponível + segurado
  const seguradas = useMemo(() => seguradasPorVariacao(initialItems), [initialItems]);
  const [lines, setLines] = useState<Line[]>(() => linhasIniciais(initialItems));
  const [prodQuery, setProdQuery] = useState("");
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [picking, setPicking] = useState<ApiProduct | null>(null);
  const [abrindoGrade, setAbrindoGrade] = useState<string | null>(null);
  const [precoTexto, setPrecoTexto] = useState<Record<string, string>>({});
  // o preço POR LINHA (quando as variações do modelo divergem) também tem o
  // texto digitado guardado: controlado pelo número, a vírgula sumia ao digitar
  const [precoLinhaTexto, setPrecoLinhaTexto] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const buscaRef = useRef<HTMLInputElement>(null);
  const ultimaBusca = useRef<string | null>(null);
  // RN-075: o que passa do estoque vira EXTRA, confirmado numa janela antes de gravar
  const extras = useConfirmarExtras();

  useTravarFundo(open);

  useEffect(() => {
    if (!open || tela !== "adicionar") return;
    // a mesma busca de antes (voltar de "Ver o pedido") não vai ao servidor
    // de novo: no 4G a lista inteira do catálogo a cada ida pesava
    if (ultimaBusca.current === prodQuery.trim() && products.length > 0) return;
    // aborta a busca anterior: sem isso uma resposta LENTA e antiga
    // sobrescrevia a lista do que foi digitado por último
    const ctrl = new AbortController();
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(prodQuery.trim())}`, { signal: ctrl.signal });
        if (res.ok) {
          setProducts(await res.json());
          ultimaBusca.current = prodQuery.trim();
        }
      } catch { /* busca abortada */ } finally {
        if (!ctrl.signal.aborted) setBuscando(false);
      }
    }, prodQuery.trim() ? 300 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodQuery, open, tela]);

  /**
   * Abrir NÃO zera o rascunho: fechar por um toque na faixa escura (no celular
   * sobra 1rem dela no topo) e reabrir encontra a grade como estava — a mesma
   * lição do "Novo pedido" (RN-062). O rascunho só é trocado pelo que foi
   * SALVO, depois de salvar.
   */
  function abrir() {
    setTela("pecas");
    setPicking(null);
    setError("");
    setOpen(true);
  }

  /**
   * O preço digitado à mão morre junto com a peça: sem isso, tirar o modelo
   * e pôr de novo mostrava no campo o preço velho enquanto as linhas — e o
   * pedido salvo — valiam o sugerido (achado da revisão).
   */
  useEffect(() => {
    const limpar = (chaves: Set<string>) => (prev: Record<string, string>) => {
      const sobrando = Object.keys(prev).filter((k) => !chaves.has(k));
      if (sobrando.length === 0) return prev;
      const novo = { ...prev };
      for (const k of sobrando) delete novo[k];
      return novo;
    };
    setPrecoTexto(limpar(new Set(lines.map((l, i) => chaveDoGrupo(l, i)))));
    setPrecoLinhaTexto(limpar(new Set(lines.map((l, i) => chaveDaLinha(l, i)))));
  }, [lines]);

  /**
   * O preço que a grade fala (e dá à célula nova): o que o MODELO já tem no
   * pedido — o combinado com a cliente —, e o sugerido (RN-041) só para o
   * modelo que ainda não está nele. A grade anunciava R$ 49,90 com as linhas
   * valendo R$ 32 (prova no celular, 05/10/2026).
   */
  const precoDaGrade = (produto: ApiProduct) => () =>
    precoUnicoDoModelo(lines, produto.id) ?? precoSugerido(produto);
  // a grade recebe a função com identidade estável (ela memoriza por ela)
  const precoDaGradeAberta = useMemo(
    () => (picking ? precoDaGrade(picking)() : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picking, lines, priceMode, source, catalogPriceMode, campaignDiscount]
  );
  const precoUnitarioDaGrade = useCallback(() => precoDaGradeAberta, [precoDaGradeAberta]);

  /** A peça com o teto certo para a grade: o que o pedido já segura volta ao estoque dela. */
  const comTeto = (produto: ApiProduct): ApiProduct => ({
    ...produto,
    variants: somarOQueOPedidoSegura(produto.variants, seguradas),
  });

  /**
   * A grade fechou: o pedido passa a ser o que ela mostrava daquela peça
   * (RN-062). A linha SEM VÍNCULO do mesmo modelo (variação apagada do
   * cadastro) não passa pela grade — ela não tem célula lá, e a grade a
   * zeraria em silêncio (achado da revisão); só a lixeira a tira.
   */
  function aplicarGrade(produto: ApiProduct, quantidades: Map<string, number>) {
    setLines((prev) => {
      const ehOrfa = (l: Line) => l.productId === produto.id && !l.variantId;
      const demais = prev.filter((l) => !ehOrfa(l));
      const novas = aplicarGradeNoPedido(demais, produto, produto.variants, quantidades, precoDaGrade(produto));
      // a órfã volta para o LUGAR em que estava (a ordem da lista é a que a
      // lojista está conferindo, e a chave dela é a posição)
      const resultado = [...novas];
      prev.forEach((l, i) => {
        if (ehOrfa(l)) resultado.splice(Math.min(i, resultado.length), 0, l);
      });
      return resultado;
    });
    setPicking(null);
    // a busca CONTINUA onde estava: o modelo seguinte costuma ser vizinho deste
  }

  /** Abre a grade de uma peça que JÁ está no pedido (busca a peça pelo id). */
  async function abrirGradeDoModelo(productId: string) {
    setAbrindoGrade(productId);
    setError("");
    try {
      const res = await fetch(`/api/products?id=${encodeURIComponent(productId)}`);
      const lista = res.ok ? ((await res.json()) as ApiProduct[]) : [];
      const produto = lista.find((p) => p.id === productId);
      if (!produto) {
        setError("Essa peça não está mais no catálogo — mexa nas quantidades aqui ou apague a linha.");
        return;
      }
      setPicking(comTeto(produto));
    } catch {
      setError("Não deu para abrir a grade agora (sem conexão?). Tente de novo.");
    } finally {
      setAbrindoGrade(null);
    }
  }

  // AGRUPADO POR MODELO para ler, mas cada linha continua sendo editada pela
  // POSIÇÃO dela em `lines` (o vínculo pode faltar em duas linhas ao mesmo
  // tempo, e por vínculo elas viravam uma só — achado de 2026)
  const grupos = useMemo(() => {
    const porProduto = new Map<string, { chave: string; productId: string; name: string; idx: number[] }>();
    lines.forEach((l, i) => {
      const chave = chaveDoGrupo(l, i);
      let g = porProduto.get(chave);
      if (!g) {
        g = { chave, productId: l.productId, name: l.name, idx: [] };
        porProduto.set(chave, g);
      }
      g.idx.push(i);
    });
    return [...porProduto.values()];
  }, [lines]);

  const pecas = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  // RN-074: o crédito abatido sai depois do desconto, limitado ao valor
  const antesDoCredito = Math.max(0, subtotal - discount + surcharge);
  const total = antesDoCredito - Math.min(creditoTroca, antesDoCredito) + shippingFee;

  /** Descartar: volta ao que está salvo no pedido (o X e a faixa escura só fecham). */
  function descartar() {
    setLines(linhasIniciais(initialItems));
    setPrecoTexto({});
    setPrecoLinhaTexto({});
    setError("");
    setOpen(false);
  }

  async function save() {
    setError("");
    if (lines.length === 0) return setError("O pedido precisa ter ao menos um item.");
    // a linha sem vínculo não tem como ser gravada (o servidor exige a
    // variação): dizer QUAL é o problema, em vez do "Dados inválidos" genérico
    if (lines.some((l) => !l.variantId)) {
      return setError(
        "Há uma linha de peça que não está mais no catálogo: apague essa linha (lixeira) e, se for o caso, adicione a peça de novo pela busca."
      );
    }
    setSaving(true);
    const enviado = await extras.enviar((extrasConfirmados) =>
      fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({
            productId: l.productId, variantId: l.variantId,
            quantity: l.quantity, unitPrice: l.unitPrice,
          })),
          extrasConfirmados,
        }),
      })
    );
    setSaving(false);
    // voltou da janela sem confirmar: nada foi gravado, o rascunho fica
    if (!enviado) return;
    if (!enviado.res.ok) {
      const d = enviado.data as { error?: string } | null;
      return setError(d?.error ?? "Não foi possível salvar os itens.");
    }
    // o que ficou salvo passa a ser o rascunho (a próxima abertura parte dele);
    // a busca guardada também vai embora — o estoque das peças mudou com o salvar
    setPrecoTexto({});
    setPrecoLinhaTexto({});
    setProducts([]);
    ultimaBusca.current = null;
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={abrir}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 transition"
      >
        <Pencil className="size-3.5" />
        Editar itens
      </button>
    );
  }

  return (
    <Portal>
      {/* A janela ocupa EXATAMENTE a área visível MEDIDA pelo navegador
          (`--vvh`/`--vvtop`): no iPhone o `innerHeight` muda sozinho e a
          conta a partir dele jogava a janela para fora da tela. */}
      <div
        className="fixed inset-x-0 top-0 z-50 flex items-end md:items-center justify-center"
        style={{ height: "var(--vvh, 100dvh)", transform: "translateY(var(--vvtop, 0px))" }}
      >
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setOpen(false)} />
        <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl h-[calc(100%_-_1rem)] md:h-[88dvh] flex flex-col overflow-hidden animate-fade-up">
          {/* CABEÇALHO */}
          <div className="shrink-0 border-b border-gray-100 px-4 pt-3.5 pb-3 flex items-center gap-2">
            {tela === "adicionar" ? (
              <button onClick={() => setTela("pecas")} aria-label="Voltar para as peças do pedido" className="text-gray-500 p-1 -ml-1">
                <ArrowLeft className="size-5" />
              </button>
            ) : null}
            <h3 className="font-semibold flex-1 min-w-0 truncate">
              {tela === "adicionar" ? "Adicionar peça" : "Itens do pedido"}
            </h3>
            <button onClick={() => setOpen(false)} aria-label="Fechar" className="text-gray-400 p-1">
              <X className="size-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto thin-scroll">
            {/* ---------- PEÇAS DO PEDIDO ---------- */}
            {tela === "pecas" && (
              <div className="p-4 space-y-3">
                {alreadyPaid && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Pedido já pago: ao salvar, o <strong>estoque é ajustado sozinho</strong> (devolve o que sair, baixa o que entrar) e o faturamento acompanha o novo total.
                  </p>
                )}

                <button
                  onClick={() => { setTela("adicionar"); setTimeout(() => buscaRef.current?.focus(), 50); }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-200 text-brand-700 text-sm font-medium px-4 py-3 hover:bg-brand-50/60 transition"
                >
                  <Plus className="size-4" /> Adicionar peça
                </button>

                {grupos.length === 0 && (
                  <div className="text-center py-10 text-gray-400">
                    <Package className="size-8 mx-auto mb-2" />
                    <p className="text-sm">Nenhuma peça no pedido.</p>
                  </div>
                )}

                {grupos.map((g) => {
                  const linhasDoGrupo = g.idx.map((i) => lines[i]);
                  const precos = new Set(linhasDoGrupo.map((l) => l.unitPrice));
                  const precoUnico = precos.size === 1 ? linhasDoGrupo[0].unitPrice : null;
                  const texto = precoTexto[g.chave];
                  const valorDoGrupo = linhasDoGrupo.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
                  const pecasDoGrupo = linhasDoGrupo.reduce((s, l) => s + l.quantity, 0);
                  const temVinculo = !!g.productId;
                  return (
                    <div key={g.chave} className="rounded-xl border border-gray-100 p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{g.name}</p>
                          <p className="text-xs text-gray-400 tabular-nums">
                            {pecasDoGrupo} {pecasDoGrupo === 1 ? "peça" : "peças"} · {brl(valorDoGrupo)}
                          </p>
                        </div>
                        {temVinculo && (
                          <button
                            onClick={() => abrirGradeDoModelo(g.productId)}
                            disabled={abrindoGrade === g.productId}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 shrink-0 rounded-lg px-2 py-1 border border-brand-100 disabled:opacity-50"
                          >
                            <Pencil className="size-3.5" /> {abrindoGrade === g.productId ? "Abrindo…" : "Grade"}
                          </button>
                        )}
                        <button
                          onClick={() => setLines((prev) => prev.filter((_, xi) => !g.idx.includes(xi)))}
                          aria-label={`Remover ${g.name}`}
                          className="text-gray-300 hover:text-rose-500 p-1 shrink-0"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>

                      <div className="mt-2 divide-y divide-gray-50">
                        {g.idx.map((i) => {
                          const l = lines[i];
                          // Item sem vínculo com a peça atual (ex.: catálogo reimportado e a
                          // religação não achou par). NÃO é estoque zero — dizer "estoque 0
                          // (insuficiente)" aqui já quase fez a loja desistir de uma venda
                          // com a peça cheia na Nuvemshop. Fala a verdade: perdeu o vínculo.
                          const semVinculo = !l.variantId;
                          // acima do que o pedido segura + o disponível: EXTRA
                          // (RN-075), feito para o pedido — não trava mais
                          // a peça sob encomenda (RN-076) passa do estoque sem extra
                          const extra = semVinculo || l.sobEncomenda ? 0 : Math.max(0, l.quantity - Math.max(0, l.stock));
                          const trocar = (mudanca: Partial<Line>) =>
                            setLines((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...mudanca } : x)));
                          const passo = (delta: number) => {
                            // o + passa do estoque (o que sobra vira EXTRA, confirmado
                            // ao salvar, RN-075); o − para em 1: remover é a lixeira
                            const alvo = l.quantity + delta;
                            if (alvo < 1) return;
                            const texto =
                              delta < 0 || semVinculo ? String(alvo) : quantidadeDigitada(String(alvo), TETO_COM_EXTRA);
                            trocar({ quantity: Math.max(1, parseInt(texto, 10) || 1) });
                          };
                          return (
                            <div key={l.variantId || `sem-vinculo-${i}`} className="flex items-center gap-2 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-700 truncate">{[l.color, l.size].filter(Boolean).join(" · ") || "Único"}</p>
                                <p className={`text-[11px] ${extra > 0 ? "text-violet-700 font-medium" : semVinculo ? "text-amber-600" : "text-gray-400"}`}>
                                  {semVinculo
                                    ? "peça não está mais no catálogo (apague a linha e adicione de novo)"
                                    : extra > 0
                                      ? `${Math.max(0, l.stock)} do estoque + ${extra} extra`
                                      : l.sobEncomenda
                                        ? `estoque ${l.stock} · sob encomenda`
                                        : `estoque ${l.stock}`}
                                </p>
                              </div>
                              <span className="inline-flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => passo(-1)}
                                  disabled={l.quantity <= 1}
                                  aria-label="Tirar 1"
                                  className="w-10 h-10 rounded-lg border border-gray-200 text-lg font-semibold text-gray-600 active:bg-brand-50 disabled:text-gray-200 disabled:border-gray-100"
                                >
                                  −
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={l.quantity}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) => {
                                    const t = semVinculo ? e.target.value.replace(/\D/g, "") : quantidadeDigitada(e.target.value, TETO_COM_EXTRA);
                                    trocar({ quantity: Math.max(1, parseInt(t, 10) || 1) });
                                  }}
                                  aria-label={`Quantidade ${l.color} ${l.size}`}
                                  className={`w-12 h-10 rounded-lg border text-center text-sm font-semibold tabular-nums outline-none ${extra > 0 ? "border-violet-300 text-violet-700" : "border-gray-200 focus:border-brand-400"}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => passo(1)}
                                  aria-label="Somar 1"
                                  className="w-10 h-10 rounded-lg border border-gray-200 text-lg font-semibold text-gray-600 active:bg-brand-50 disabled:text-gray-200 disabled:border-gray-100"
                                >
                                  +
                                </button>
                              </span>
                              {precoUnico === null && (
                                <input
                                  value={precoLinhaTexto[chaveDaLinha(l, i)] ?? l.unitPrice.toFixed(2).replace(".", ",")}
                                  onChange={(e) => {
                                    const t = e.target.value;
                                    setPrecoLinhaTexto((prev) => ({ ...prev, [chaveDaLinha(l, i)]: t }));
                                    trocar({ unitPrice: numeroBR(t) });
                                  }}
                                  inputMode="decimal"
                                  aria-label="Preço unitário"
                                  className="w-20 h-10 rounded-lg border border-gray-200 px-2 text-sm text-right tabular-nums outline-none focus:border-brand-400 shrink-0"
                                />
                              )}
                              <button
                                onClick={() => setLines((prev) => prev.filter((_, xi) => xi !== i))}
                                aria-label="Remover linha"
                                className="text-gray-300 hover:text-rose-500 p-1 shrink-0"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* preço por MODELO: no atacado o número é um só para a peça inteira */}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-500">Preço por peça</span>
                        {precoUnico === null ? (
                          <span className="text-xs text-amber-600">preços diferentes nas variações (edite em cada linha)</span>
                        ) : (
                          <input
                            value={texto ?? precoUnico.toFixed(2).replace(".", ",")}
                            onChange={(e) => {
                              const t = e.target.value;
                              setPrecoTexto((prev) => ({ ...prev, [g.chave]: t }));
                              // a MESMA leitura do "Novo pedido": "34,90" e "34.90" são
                              // o mesmo preço; tirar todo ponto fazia "34.9" virar 349
                              const n = numeroBR(t);
                              setLines((prev) => prev.map((x, xi) => (g.idx.includes(xi) ? { ...x, unitPrice: n } : x)));
                            }}
                            inputMode="decimal"
                            aria-label={`Preço de ${g.name}`}
                            className="w-24 h-9 rounded-lg border border-gray-200 px-2 text-sm text-right tabular-nums outline-none focus:border-brand-400"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---------- ADICIONAR PEÇA ---------- */}
            {tela === "adicionar" && (
              <div className="p-4">
                <div className="relative mb-3 sticky top-0 z-10 bg-white pb-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-300" />
                  <input
                    ref={buscaRef}
                    value={prodQuery}
                    onChange={(e) => setProdQuery(e.target.value)}
                    placeholder="Buscar peça (nome ou código)…"
                    className="w-full rounded-xl border border-gray-200 pl-9 pr-9 py-3 text-base md:text-sm outline-none focus:border-brand-400 transition"
                  />
                  {prodQuery && (
                    <button onClick={() => { setProdQuery(""); buscaRef.current?.focus(); }} aria-label="Limpar busca" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 p-1">
                      <X className="size-4" />
                    </button>
                  )}
                </div>

                {buscando && products.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-10">Carregando catálogo…</p>
                ) : products.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <Package className="size-8 mx-auto mb-2" />
                    <p className="text-sm">Nenhuma peça encontrada.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* a lista INTEIRA que o servidor devolveu, com rolagem — o
                        corte em 8 escondia o produto novo quando muitos nomes
                        parecidos vinham antes dele na ordem alfabética */}
                    {products.map((p) => (
                      <CartaoDaPeca
                        key={p.id}
                        produto={p}
                        preco={precoSugerido(p)}
                        noPedido={pecasNoPedido(lines, p.id)}
                        onClick={() => setPicking(comTeto(p))}
                      />
                    ))}
                  </div>
                )}
                {products.length >= 60 && (
                  <p className="mt-2 text-xs text-amber-600">Tem mais resultado do que cabe aqui — digite mais letras para afinar.</p>
                )}
              </div>
            )}
          </div>

          {/* RODAPÉ FIXO: o total fica SEMPRE à vista, e o salvar também */}
          <div className="shrink-0 border-t border-gray-100 p-3">
            {error && (
              <p className="mb-2 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tabular-nums leading-tight">{brl(Math.max(total, 0))}</p>
                <p className="text-[11px] text-gray-400">
                  {pecas} {pecas === 1 ? "peça" : "peças"} · {grupos.length} {grupos.length === 1 ? "modelo" : "modelos"}
                  {discount > 0 || shippingFee > 0 ? " · com desconto e frete do pedido" : ""}
                </p>
              </div>
              {tela === "adicionar" ? (
                <button
                  onClick={() => setTela("pecas")}
                  className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition shrink-0"
                >
                  Ver o pedido
                </button>
              ) : (
                <>
                  <button onClick={descartar} className="rounded-xl border border-gray-200 text-gray-500 text-sm font-medium px-3 py-2.5 transition hover:bg-gray-50 shrink-0">
                    Descartar
                  </button>
                  <button
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-60 shrink-0"
                  >
                    <Check className="size-4" />{saving ? "Salvando…" : "Salvar itens"}
                  </button>
                </>
              )}
            </div>
          </div>

          {picking && (
            <GradeDePecas
              produto={picking}
              quantidadesIniciais={quantidadesNoPedido(lines, picking.id)}
              precoUnitario={precoUnitarioDaGrade}
              jaNoPedido={pecasNoPedido(lines, picking.id) > 0}
              permiteExtra
              onCancelar={() => setPicking(null)}
              onAplicar={(q) => aplicarGrade(picking, q)}
            />
          )}
          {extras.janela}
        </div>
      </div>
    </Portal>
  );
}

/**
 * O resultado da busca DIZ qual peça é qual: foto, código, categoria, cores
 * e estoque — "Regata Alça · R$ 32" quatro vezes seguidas era o print do
 * dono. O preço mostrado é o MESMO que vai virar a linha (achado de
 * 01/09/2026: a listinha mostrava atacado e a linha entrava a varejo).
 */
function CartaoDaPeca({
  produto,
  preco,
  noPedido,
  onClick,
}: {
  produto: ApiProduct;
  preco: number;
  noPedido: number;
  onClick: () => void;
}) {
  const cores = [...new Set(produto.variants.map((v) => (v.color ?? "").trim()).filter(Boolean))];
  const estoque = produto.variants.reduce((s, v) => s + Math.max(0, v.stock), 0);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 rounded-xl border p-2 transition ${
        noPedido > 0 ? "border-brand-300 bg-brand-50/40" : "border-gray-100 hover:border-brand-300 hover:bg-brand-50/30"
      }`}
    >
      {produto.images[0] ? (
        <img src={produto.images[0].url} alt="" className="size-14 rounded-lg object-cover bg-gray-50 shrink-0" />
      ) : (
        <span className="size-14 rounded-lg bg-gray-100 shrink-0" />
      )}
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="block text-sm font-medium truncate">{produto.name}</span>
          {noPedido > 0 && (
            <span className="shrink-0 rounded-full bg-brand-600 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">{noPedido}</span>
          )}
        </span>
        <span className="block text-[11px] text-gray-400 truncate">
          {produto.sku}
          {produto.category ? ` · ${produto.category}` : ""}
        </span>
        <span className="block text-[11px] text-gray-500 truncate mt-0.5">
          {cores.length > 0 ? `${cores.slice(0, 3).join(", ")}${cores.length > 3 ? ` +${cores.length - 3}` : ""} · ` : ""}
          {estoque > 0 ? `${estoque} em estoque` : "sem estoque"}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className="block text-sm font-semibold text-brand-700 tabular-nums">{brl(preco)}</span>
      </span>
    </button>
  );
}
