"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * TROCAS DO PEDIDO (RN-073) — o bloco na ficha do pedido: a história das
 * trocas já feitas e a janela "Registrar troca", em três passos com um
 * assunto cada (a lição da RN-062): o que VOLTA, o que SAI (pela grade de
 * cor × tamanho) e a CONFERÊNCIA (diferença, como acertar, frete combinado).
 *
 * Quem decide dinheiro e estoque é o servidor (`lib/troca`); a tela mostra a
 * prévia com a MESMA regra pura (`lib/troca/regra`) para a vendedora não
 * bater num 400 no último clique.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  Loader2,
  Minus,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { brl, dateShort, numeroBR, timeShort } from "@/lib/format";
import { precoSugeridoNoPedido } from "@/lib/orders";
import { precoUnicoDoModelo } from "@/lib/pedido-grade";
import { Portal } from "@/components/portal";
import { useTravarFundo } from "@/components/travar-fundo";
import { GradeDePecas, type ProdutoDaGrade } from "@/components/pedido/grade-de-pecas";
import {
  ROTULO_DESTINO,
  ROTULO_RESOLUCAO,
  juntarSaidas,
  juntarVoltas,
  resolucoesPermitidas,
  restanteDaLinha,
  rotuloDaPeca,
  somarTroca,
  validarTroca,
  type LinhaParaTroca,
  type PecaQueSai,
  type PecaQueVolta,
  type TrocaDestino,
  type TrocaResolucao,
} from "@/lib/troca/regra";

export type LinhaDaTroca = LinhaParaTroca;

export type TrocaDaTela = {
  id: string;
  numero: number;
  createdAt: string;
  registradaPorNome: string;
  motivo: string | null;
  freteCombinado: string | null;
  valorVolta: number;
  valorSai: number;
  diferenca: number;
  resolucao: TrocaResolucao;
  resolvidaEm: string | null;
  resolvidaPorNome: string | null;
  observacoes: string | null;
  itens: {
    sentido: "VOLTA" | "SAI";
    name: string;
    color: string | null;
    size: string | null;
    quantity: number;
    unitPrice: number;
    destino: TrocaDestino | null;
  }[];
};

type ApiVariant = { id: string; color: string; size: string; stock: number };
type ApiProduct = ProdutoDaGrade & {
  category?: string;
  wholesalePrice: number;
  retailPrice: number;
  variants: ApiVariant[];
};

/** uma peça que SAI, como a tela a guarda (com o retrato para mostrar) */
type SaidaDaTela = PecaQueSai & { productId: string; name: string; color: string; size: string };

type Passo = 1 | 2 | 3;

/** "48", "48,5", "R$ 1.248,90" → número; vazio ou torto → null (nunca zero por acidente) */
export function precoDigitado(texto: string): number | null {
  const limpo = texto.replace(/R\$/i, "").trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(limpo)) return null;
  if (/^0+([.,]0{1,2})?$/.test(limpo)) return 0;
  return numeroBR(limpo);
}

const MOTIVOS = ["Tamanho", "Cor", "Modelo", "Defeito", "Outro"];

export function TrocasDoPedido({
  orderId,
  numeroDoPedido,
  linhas,
  trocas,
  podeRegistrar,
  podeAcertar,
  motivoBloqueio,
  lojaOnline,
  preco,
  saldoCredito,
}: {
  orderId: string;
  numeroDoPedido: string;
  linhas: LinhaDaTroca[];
  trocas: TrocaDaTela[];
  /** status aceita E a pessoa pode (equipe comercial) */
  podeRegistrar: boolean;
  /** confirmar o acerto do dinheiro: só a pessoa (vale em qualquer status) */
  podeAcertar: boolean;
  /** por que o botão não aparece (texto curto) */
  motivoBloqueio: string | null;
  /** venda da loja online: a Nuvemshop não fica sabendo do pedido, só do estoque */
  lojaOnline: boolean;
  preco: {
    priceMode: string | null;
    source: string | null;
    catalogPriceMode: string | null | undefined;
    campaignDiscount: number;
  };
  /** saldo de crédito da cliente HOJE (soma do livro) */
  saldoCredito: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [passo, setPasso] = useState<Passo>(1);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // passo 1
  const [qtdVolta, setQtdVolta] = useState<Record<string, number>>({});
  const [destino, setDestino] = useState<Record<string, TrocaDestino>>({});
  const [motivoChip, setMotivoChip] = useState<string>("");
  const [motivoTexto, setMotivoTexto] = useState("");
  // passo 2
  const [busca, setBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [produtos, setProdutos] = useState<ApiProduct[]>([]);
  const [grade, setGrade] = useState<ApiProduct | null>(null);
  const [abrindoGrade, setAbrindoGrade] = useState<string | null>(null);
  const [saidas, setSaidas] = useState<SaidaDaTela[]>([]);
  const [precoTexto, setPrecoTexto] = useState<Record<string, string>>({});
  // passo 3
  const [resolucao, setResolucao] = useState<TrocaResolucao | null>(null);
  const [frete, setFrete] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const buscaRef = useRef<HTMLInputElement>(null);
  const ultimaBusca = useRef<string | null>(null);

  useTravarFundo(open);

  const porChave = useMemo(() => new Map(linhas.map((l) => [l.chave, l])), [linhas]);

  const volta: PecaQueVolta[] = useMemo(
    () =>
      juntarVoltas(
        Object.entries(qtdVolta)
          .filter(([, q]) => q > 0)
          .map(([chave, quantity]) => ({ chave, quantity, destino: destino[chave] ?? "ESTOQUE" }))
      ),
    [qtdVolta, destino]
  );
  const sai: PecaQueSai[] = useMemo(() => juntarSaidas(saidas.map(({ variantId, quantity, unitPrice }) => ({ variantId, quantity, unitPrice }))), [saidas]);
  const totais = useMemo(() => somarTroca(linhas, volta, sai), [linhas, volta, sai]);
  const permitidas = useMemo(() => resolucoesPermitidas(totais.diferenca), [totais.diferenca]);
  const motivo = useMemo(() => {
    const texto = motivoTexto.trim();
    if (!motivoChip) return texto;
    if (motivoChip === "Outro") return texto;
    return texto ? `${motivoChip} — ${texto}` : motivoChip;
  }, [motivoChip, motivoTexto]);

  // a resolução acompanha a diferença: mudou o sinal, a escolha anterior não vale
  useEffect(() => {
    if (resolucao && !permitidas.includes(resolucao)) setResolucao(permitidas.length === 1 ? permitidas[0] : null);
    if (!resolucao && permitidas.length === 1) setResolucao(permitidas[0]);
  }, [permitidas, resolucao]);

  // busca de peças (a mesma do editor de itens): abortável e sem repetir
  useEffect(() => {
    if (!open || passo !== 2 || grade) return;
    if (ultimaBusca.current === busca.trim() && produtos.length > 0) return;
    const ctrl = new AbortController();
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(busca.trim())}`, { signal: ctrl.signal });
        if (res.ok) {
          setProdutos(await res.json());
          ultimaBusca.current = busca.trim();
        }
      } catch {
        /* busca abortada */
      } finally {
        if (!ctrl.signal.aborted) setBuscando(false);
      }
    }, busca.trim() ? 300 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, open, passo]);

  function abrir() {
    setPasso(1);
    setErro("");
    setOpen(true);
  }

  function limpar() {
    setQtdVolta({});
    setDestino({});
    setMotivoChip("");
    setMotivoTexto("");
    setBusca("");
    setSaidas([]);
    setPrecoTexto({});
    setGrade(null);
    setResolucao(null);
    setFrete("");
    setObservacoes("");
    setErro("");
    setPasso(1);
  }

  const precoSugerido = (p: ApiProduct) => precoSugeridoNoPedido(p, preco);
  /**
   * O preço do modelo na troca, nesta ordem: o já digitado nesta troca; o
   * que o MESMO modelo custou no pedido (a troca mais comum é de tamanho —
   * a cliente pagou R$ 32 pela P e leva a M: sugerir o preço de tabela aqui
   * inventaria uma diferença que ninguém combinou, a régua da RN-062); por
   * fim o sugerido pela origem do pedido (RN-041). Editável em todo caso.
   */
  const precoDoModelo = (p: ApiProduct): number => {
    const nestaTroca = saidas.find((s) => s.productId === p.id);
    if (nestaTroca) return nestaTroca.unitPrice;
    const noPedido = precoUnicoDoModelo(
      linhas.map((l) => ({ productId: l.productId ?? "", variantId: l.variantId ?? "", unitPrice: l.unitPrice })),
      p.id
    );
    return noPedido ?? precoSugerido(p);
  };
  const precoDaGradeAberta = useMemo(() => (grade ? precoDoModelo(grade) : 0), [grade, saidas]); // eslint-disable-line react-hooks/exhaustive-deps
  const precoUnitarioDaGrade = useCallback(() => precoDaGradeAberta, [precoDaGradeAberta]);

  const quantidadesNaTroca = (productId: string) =>
    new Map(saidas.filter((s) => s.productId === productId).map((s) => [s.variantId, s.quantity]));

  function aplicarGrade(p: ApiProduct, q: Map<string, number>) {
    const precoLinha = precoDoModelo(p);
    setSaidas((prev) => {
      const outras = prev.filter((s) => s.productId !== p.id);
      const novas: SaidaDaTela[] = [];
      // a ordem das variações da peça é a da grade (cor, depois tamanho)
      for (const v of p.variants) {
        const n = q.get(v.id) ?? 0;
        if (n <= 0) continue;
        novas.push({ variantId: v.id, quantity: n, unitPrice: precoLinha, productId: p.id, name: p.name, color: v.color ?? "", size: v.size ?? "" });
      }
      return [...outras, ...novas];
    });
    setPrecoTexto((prev) => (prev[p.id] ? prev : { ...prev, [p.id]: precoLinha.toFixed(2).replace(".", ",") }));
    setGrade(null);
  }

  async function abrirGradeDoModelo(productId: string) {
    setAbrindoGrade(productId);
    setErro("");
    try {
      const res = await fetch(`/api/products?id=${encodeURIComponent(productId)}`);
      const lista = res.ok ? ((await res.json()) as ApiProduct[]) : [];
      const p = lista.find((x) => x.id === productId);
      if (!p) {
        setErro("Essa peça não está mais no catálogo.");
        return;
      }
      setGrade(p);
    } catch {
      setErro("Não deu para abrir a grade agora (sem conexão?). Tente de novo.");
    } finally {
      setAbrindoGrade(null);
    }
  }

  /**
   * O preço digitado só vale quando é um número de verdade: campo vazio ou
   * "R$ " no meio da digitação NÃO vira zero (zero transformaria a peça em
   * brinde, inverteria o sinal da diferença e ofereceria crédito à cliente
   * — achado da revisão). Zero explícito ("0") continua válido: brinde é
   * decisão, não acidente.
   */
  function mudarPreco(productId: string, texto: string) {
    setPrecoTexto((prev) => ({ ...prev, [productId]: texto }));
    const n = precoDigitado(texto);
    if (n === null) return;
    setSaidas((prev) => prev.map((s) => (s.productId === productId ? { ...s, unitPrice: n } : s)));
  }

  function removerModelo(productId: string) {
    setSaidas((prev) => prev.filter((s) => s.productId !== productId));
    setPrecoTexto((prev) => {
      const n = { ...prev };
      delete n[productId];
      return n;
    });
  }

  const grupos = useMemo(() => {
    const m = new Map<string, { productId: string; name: string; itens: SaidaDaTela[] }>();
    for (const s of saidas) {
      let g = m.get(s.productId);
      if (!g) {
        g = { productId: s.productId, name: s.name, itens: [] };
        m.set(s.productId, g);
      }
      g.itens.push(s);
    }
    return [...m.values()];
  }, [saidas]);

  const erroDoPasso1 = volta.length === 0 ? "Marque pelo menos uma peça que a cliente devolveu." : null;
  const modeloSemPreco = grupos.find((g) => precoDigitado(precoTexto[g.productId] ?? "") === null);
  const erroDoPasso2 =
    sai.length === 0
      ? "Escolha a peça que a cliente leva."
      : modeloSemPreco
        ? `Digite o preço de ${modeloSemPreco.name} (ou 0 se for brinde).`
        : null;

  function avancar() {
    setErro("");
    if (passo === 1) {
      if (erroDoPasso1) return setErro(erroDoPasso1);
      setPasso(2);
      setTimeout(() => buscaRef.current?.focus(), 50);
    } else if (passo === 2) {
      if (erroDoPasso2) return setErro(erroDoPasso2);
      setPasso(3);
    }
  }

  async function registrar() {
    setErro("");
    const e = validarTroca(linhas, volta, sai);
    if (e) return setErro(e);
    if (!resolucao) return setErro("Diga como acertar a diferença.");
    setSalvando(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/troca`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ volta, sai, resolucao, motivo, freteCombinado: frete, observacoes }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(d.error ?? "Não deu para registrar a troca.");
        return;
      }
      limpar();
      setOpen(false);
      router.refresh();
    } catch {
      setErro("Sem conexão — a troca NÃO foi registrada. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <ArrowLeftRight className="size-4 text-brand-600" />
            Trocas
            {trocas.length > 0 && (
              <span className="text-xs font-medium text-gray-400">
                {trocas.length} {trocas.length === 1 ? "registrada" : "registradas"}
              </span>
            )}
          </h3>
          {saldoCredito > 0.005 && (
            <p className="text-xs text-emerald-700 mt-0.5">
              A cliente tem <strong>{brl(saldoCredito)}</strong> de crédito na ficha (abate no próximo pedido).
            </p>
          )}
        </div>
        {podeRegistrar ? (
          <button
            onClick={abrir}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium px-3 py-1.5 transition shrink-0"
          >
            <ArrowLeftRight className="size-3.5" /> Registrar troca
          </button>
        ) : motivoBloqueio ? (
          <span className="text-[11px] text-gray-400 text-right max-w-[14rem]">{motivoBloqueio}</span>
        ) : null}
      </div>

      {trocas.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma troca registrada neste pedido.</p>
      ) : (
        <ul className="space-y-3">
          {trocas.map((t) => (
            <TrocaRegistrada key={t.id} troca={t} orderId={orderId} podeAcertar={podeAcertar} />
          ))}
        </ul>
      )}

      {open && (
        <Portal>
          <div
            className="fixed inset-x-0 top-0 z-50 flex items-end md:items-center justify-center"
            style={{ height: "var(--vvh, 100dvh)", transform: "translateY(var(--vvtop, 0px))" }}
          >
            <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setOpen(false)} />
            <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl h-[calc(100%_-_1rem)] md:h-[88dvh] flex flex-col overflow-hidden animate-fade-up">
              {/* CABEÇALHO */}
              <div className="shrink-0 border-b border-gray-100 px-4 pt-3.5 pb-3 flex items-center gap-2">
                {passo > 1 && (
                  <button onClick={() => setPasso((p) => (p - 1) as Passo)} aria-label="Voltar" className="text-gray-500 p-1 -ml-1">
                    <ArrowLeft className="size-5" />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">Registrar troca · pedido {numeroDoPedido}</h3>
                  <p className="text-[11px] text-gray-400">
                    Passo {passo} de 3 ·{" "}
                    {passo === 1 ? "o que a cliente devolveu" : passo === 2 ? "o que ela leva" : "conferir e acertar"}
                  </p>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Fechar" className="text-gray-400 p-1">
                  <X className="size-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto thin-scroll">
                {/* ---------- PASSO 1: O QUE VOLTA ---------- */}
                {passo === 1 && (
                  <div className="p-4 space-y-3">
                    <p className="text-xs text-gray-500">
                      Marque quantas peças de cada linha a cliente devolveu e se cada uma volta para o estoque ou veio com defeito.
                    </p>
                    <ul className="space-y-2">
                      {linhas.map((l) => {
                        const restante = restanteDaLinha(l);
                        const q = qtdVolta[l.chave] ?? 0;
                        const d = destino[l.chave] ?? "ESTOQUE";
                        return (
                          <li key={l.chave} className={`rounded-xl border p-3 ${q > 0 ? "border-brand-300 bg-brand-50/40" : "border-gray-100"}`}>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{l.name}</p>
                                <p className="text-[11px] text-gray-400">
                                  {[l.color, l.size].filter(Boolean).join(" · ")}
                                  {[l.color, l.size].filter(Boolean).length > 0 ? " · " : ""}
                                  comprou {l.quantity} · {brl(l.unitPrice)} cada
                                  {l.jaDevolvidas > 0 ? ` · ${l.jaDevolvidas} já ${l.jaDevolvidas === 1 ? "voltou" : "voltaram"}` : ""}
                                </p>
                              </div>
                              {restante === 0 ? (
                                <span className="text-[11px] text-gray-400 shrink-0">já voltou toda</span>
                              ) : (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    aria-label="Menos uma devolvida"
                                    onClick={() => setQtdVolta((p) => ({ ...p, [l.chave]: Math.max(0, q - 1) }))}
                                    disabled={q === 0}
                                    className="size-9 rounded-lg border border-gray-200 flex items-center justify-center disabled:opacity-40"
                                  >
                                    <Minus className="size-4" />
                                  </button>
                                  <span className="w-7 text-center text-sm font-semibold tabular-nums">{q}</span>
                                  <button
                                    aria-label="Mais uma devolvida"
                                    onClick={() => setQtdVolta((p) => ({ ...p, [l.chave]: Math.min(restante, q + 1) }))}
                                    disabled={q >= restante}
                                    className="size-9 rounded-lg border border-gray-200 flex items-center justify-center disabled:opacity-40"
                                  >
                                    <Plus className="size-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {q > 0 && (
                              <div className="mt-2 flex gap-1.5 text-xs">
                                {(["ESTOQUE", "DEFEITO"] as TrocaDestino[]).map((op) => (
                                  <button
                                    key={op}
                                    onClick={() => setDestino((p) => ({ ...p, [l.chave]: op }))}
                                    className={`rounded-full px-2.5 py-1 border transition ${
                                      d === op
                                        ? op === "DEFEITO"
                                          ? "bg-red-50 border-red-200 text-red-700 font-medium"
                                          : "bg-emerald-50 border-emerald-200 text-emerald-700 font-medium"
                                        : "border-gray-200 text-gray-500"
                                    }`}
                                  >
                                    {op === "ESTOQUE" ? "Volta ao estoque" : "Com defeito"}
                                  </button>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1.5">Motivo da troca</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {MOTIVOS.map((m) => (
                          <button
                            key={m}
                            onClick={() => setMotivoChip((atual) => (atual === m ? "" : m))}
                            className={`rounded-full px-2.5 py-1 text-xs border transition ${
                              motivoChip === m ? "bg-brand-600 border-brand-600 text-white" : "border-gray-200 text-gray-600"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                      <input
                        value={motivoTexto}
                        onChange={(e) => setMotivoTexto(e.target.value)}
                        maxLength={200}
                        placeholder="Detalhe (opcional): ficou pequena, veio com a costura aberta…"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* ---------- PASSO 2: O QUE SAI ---------- */}
                {passo === 2 && (
                  <div className="p-4 space-y-3">
                    {grupos.length > 0 && (
                      <ul className="space-y-2">
                        {grupos.map((g) => (
                          <li key={g.productId} className="rounded-xl border border-brand-200 bg-brand-50/30 p-3">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium flex-1 min-w-0 truncate">{g.name}</p>
                              <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                                R$
                                <input
                                  value={precoTexto[g.productId] ?? ""}
                                  onChange={(e) => mudarPreco(g.productId, e.target.value)}
                                  inputMode="decimal"
                                  className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right tabular-nums"
                                  aria-label={`Preço de ${g.name} na troca`}
                                />
                              </label>
                              <button onClick={() => removerModelo(g.productId)} aria-label={`Tirar ${g.name} da troca`} className="text-gray-400 hover:text-red-600 p-1">
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                            <p className="text-[11px] text-gray-500 mt-1">
                              {g.itens.map((i) => `${i.quantity}× ${[i.color, i.size].filter(Boolean).join(" ") || "única"}`).join(" · ")}
                            </p>
                            <button
                              onClick={() => abrirGradeDoModelo(g.productId)}
                              disabled={abrindoGrade === g.productId}
                              className="mt-1.5 text-xs text-brand-700 font-medium underline-offset-2 hover:underline disabled:opacity-60"
                            >
                              {abrindoGrade === g.productId ? "Abrindo…" : "Mudar cores e tamanhos"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="relative">
                      <Search className="size-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        ref={buscaRef}
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar a peça que a cliente leva…"
                        className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2.5 text-sm"
                      />
                    </div>
                    {buscando && produtos.length === 0 ? (
                      <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Buscando…</p>
                    ) : produtos.length === 0 ? (
                      <p className="text-xs text-gray-400">Nenhuma peça encontrada.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {produtos.map((p) => {
                          const naTroca = saidas.filter((s) => s.productId === p.id).reduce((s, i) => s + i.quantity, 0);
                          const cores = [...new Set(p.variants.map((v) => (v.color ?? "").trim()).filter(Boolean))];
                          const estoque = p.variants.reduce((s, v) => s + Math.max(0, v.stock), 0);
                          return (
                            <li key={p.id}>
                              <button
                                onClick={() => setGrade(p)}
                                className={`w-full text-left flex items-center gap-3 rounded-xl border p-2 transition ${
                                  naTroca > 0 ? "border-brand-300 bg-brand-50/40" : "border-gray-100 hover:border-brand-300 hover:bg-brand-50/30"
                                }`}
                              >
                                {p.images[0] ? (
                                  <img src={p.images[0].url} alt="" className="size-12 rounded-lg object-cover bg-gray-50 shrink-0" />
                                ) : (
                                  <span className="size-12 rounded-lg bg-gray-100 shrink-0" />
                                )}
                                <span className="flex-1 min-w-0">
                                  <span className="flex items-center gap-1.5">
                                    <span className="block text-sm font-medium truncate">{p.name}</span>
                                    {naTroca > 0 && (
                                      <span className="shrink-0 rounded-full bg-brand-600 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">{naTroca}</span>
                                    )}
                                  </span>
                                  <span className="block text-[11px] text-gray-400 truncate">
                                    {p.sku}{p.category ? ` · ${p.category}` : ""}
                                  </span>
                                  <span className="block text-[11px] text-gray-500 truncate mt-0.5">
                                    {cores.length > 0 ? `${cores.slice(0, 3).join(", ")}${cores.length > 3 ? ` +${cores.length - 3}` : ""} · ` : ""}
                                    {estoque > 0 ? `${estoque} em estoque` : "sem estoque"}
                                  </span>
                                </span>
                                <span className="text-sm font-semibold text-brand-700 tabular-nums shrink-0">{brl(precoDoModelo(p))}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {/* ---------- PASSO 3: CONFERIR ---------- */}
                {passo === 3 && (
                  <div className="p-4 space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-gray-100 p-3">
                        <p className="text-xs font-semibold text-gray-500 mb-1.5">Voltou</p>
                        <ul className="space-y-1 text-sm">
                          {volta.map((v) => {
                            const l = porChave.get(v.chave)!;
                            return (
                              <li key={`${v.chave}-${v.destino}`} className="flex justify-between gap-2">
                                <span className="min-w-0">
                                  {v.quantity}× {rotuloDaPeca(l)}
                                  {v.destino === "DEFEITO" && <span className="text-red-600 text-xs"> · defeito</span>}
                                </span>
                                <span className="tabular-nums text-gray-500 shrink-0">{brl(l.unitPrice * v.quantity)}</span>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-sm font-medium">
                          <span>Total que volta</span><span className="tabular-nums">{brl(totais.valorVolta)}</span>
                        </p>
                      </div>
                      <div className="rounded-xl border border-gray-100 p-3">
                        <p className="text-xs font-semibold text-gray-500 mb-1.5">Levou</p>
                        <ul className="space-y-1 text-sm">
                          {saidas.map((s) => (
                            <li key={s.variantId} className="flex justify-between gap-2">
                              <span className="min-w-0">{s.quantity}× {rotuloDaPeca(s)}</span>
                              <span className="tabular-nums text-gray-500 shrink-0">{brl(s.unitPrice * s.quantity)}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-sm font-medium">
                          <span>Total que sai</span><span className="tabular-nums">{brl(totais.valorSai)}</span>
                        </p>
                      </div>
                    </div>

                    <div
                      className={`rounded-xl p-3 border ${
                        Math.abs(totais.diferenca) < 0.005
                          ? "bg-gray-50 border-gray-100"
                          : totais.diferenca > 0
                            ? "bg-amber-50 border-amber-100"
                            : "bg-emerald-50 border-emerald-100"
                      }`}
                    >
                      <p className="text-sm font-semibold">
                        {Math.abs(totais.diferenca) < 0.005
                          ? "Sem diferença de valor"
                          : totais.diferenca > 0
                            ? `A cliente paga ${brl(totais.diferenca)} de diferença`
                            : `A loja fica devendo ${brl(-totais.diferenca)} para a cliente`}
                      </p>
                      {permitidas.length > 1 && (
                        <div className="mt-2 space-y-1.5">
                          {permitidas.map((r) => (
                            <label key={r} className="flex items-start gap-2 text-sm cursor-pointer">
                              <input type="radio" name="resolucao" checked={resolucao === r} onChange={() => setResolucao(r)} className="mt-0.5" />
                              <span>
                                <span className="font-medium">{ROTULO_RESOLUCAO[r]}</span>
                                <span className="block text-xs text-gray-500">
                                  {r === "CREDITO"
                                    ? "Fica anotado na ficha dela e abate no próximo pedido."
                                    : "A loja devolve o dinheiro (Pix, dinheiro). Depois você confirma aqui que devolveu."}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      {resolucao === "COBRAR" && (
                        <p className="text-xs text-amber-800 mt-1">
                          Combine o pagamento com a cliente (Pix, dinheiro). Quando receber, confirme na troca — fica registrado quem recebeu e quando.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-600">Frete da troca (combinado)</label>
                      <input
                        value={frete}
                        onChange={(e) => setFrete(e.target.value)}
                        maxLength={200}
                        placeholder="Ex.: cliente paga o envio de volta; loja manda a nova por PAC"
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">O frete fica fora da conta da diferença — é só anotação do combinado.</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Observações (opcional)</label>
                      <textarea
                        value={observacoes}
                        onChange={(e) => setObservacoes(e.target.value)}
                        maxLength={1000}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-[11px] text-gray-500 space-y-1">
                      <p>• O pedido {numeroDoPedido} <strong>não muda</strong>: valor, data da venda, comissão e nota ficam como estão. A troca fica registrada abaixo dos itens e na história do pedido.</p>
                      <p>• O estoque anda sozinho: a peça devolvida boa volta para a arara, a com defeito é baixada, e a peça levada sai{lojaOnline ? " — a Nuvemshop recebe o estoque novo, mas o pedido lá não muda" : " (e a loja online recebe o número novo, se a peça for vinculada)"}.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* RODAPÉ */}
              <div className="shrink-0 border-t border-gray-100 px-4 py-3 bg-white">
                {erro && <p className="text-xs text-red-600 mb-2">{erro}</p>}
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 text-xs text-gray-500">
                    {volta.length > 0 && (
                      <span>
                        Volta {volta.reduce((s, v) => s + v.quantity, 0)} · leva {sai.reduce((s, v) => s + v.quantity, 0)}
                        {passo >= 2 && Math.abs(totais.diferenca) >= 0.005 && (
                          <span className={totais.diferenca > 0 ? " text-amber-700" : " text-emerald-700"}>
                            {" "}· {totais.diferenca > 0 ? "cliente paga" : "loja devolve"} {brl(Math.abs(totais.diferenca))}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {passo < 3 ? (
                    <button onClick={avancar} className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition shrink-0">
                      Avançar
                    </button>
                  ) : (
                    <button
                      onClick={registrar}
                      disabled={salvando || !resolucao}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-60 shrink-0"
                    >
                      {salvando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      {salvando ? "Registrando…" : "Registrar troca"}
                    </button>
                  )}
                </div>
              </div>

              {grade && (
                <GradeDePecas
                  produto={grade}
                  quantidadesIniciais={quantidadesNaTroca(grade.id)}
                  precoUnitario={precoUnitarioDaGrade}
                  jaNoPedido={quantidadesNaTroca(grade.id).size > 0}
                  onCancelar={() => setGrade(null)}
                  onAplicar={(q) => aplicarGrade(grade, q)}
                />
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

/** Uma troca já registrada: o bloco legível, com o botão de confirmar o acerto. */
function TrocaRegistrada({ troca: t, orderId, podeAcertar }: { troca: TrocaDaTela; orderId: string; podeAcertar: boolean }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState("");
  const voltou = t.itens.filter((i) => i.sentido === "VOLTA");
  const levou = t.itens.filter((i) => i.sentido === "SAI");
  const criadaEm = new Date(t.createdAt);
  const pendente = !t.resolvidaEm && (t.resolucao === "COBRAR" || t.resolucao === "DEVOLUCAO");

  async function acertar() {
    setErro("");
    setConfirmando(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/troca`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trocaId: t.id, acertada: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(d.error ?? "Não deu para confirmar.");
        return;
      }
      router.refresh();
    } catch {
      setErro("Sem conexão — tente de novo.");
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <li className="rounded-xl border border-gray-100 p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="font-semibold">Troca {t.numero}</p>
        <p className="text-[11px] text-gray-400">
          {dateShort(criadaEm)} {timeShort(criadaEm)} · {t.registradaPorNome}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-400 font-medium mb-0.5">Voltou</p>
          <ul className="space-y-0.5">
            {voltou.map((i, k) => (
              <li key={k}>
                {i.quantity}× {rotuloDaPeca(i)}
                <span className={i.destino === "DEFEITO" ? "text-red-600" : "text-gray-400"}> · {i.destino ? ROTULO_DESTINO[i.destino] : ""}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-gray-400 font-medium mb-0.5">Levou</p>
          <ul className="space-y-0.5">
            {levou.map((i, k) => (
              <li key={k}>
                {i.quantity}× {rotuloDaPeca(i)} <span className="text-gray-400">· {brl(i.unitPrice)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>
          {Math.abs(t.diferenca) < 0.005 ? (
            <span className="text-gray-500">Sem diferença de valor</span>
          ) : t.diferenca > 0 ? (
            <span className="text-amber-700 font-medium">Cliente paga {brl(t.diferenca)}</span>
          ) : (
            <span className="text-emerald-700 font-medium">Loja devolve {brl(-t.diferenca)}</span>
          )}
          {Math.abs(t.diferenca) >= 0.005 && <span className="text-gray-500"> · {ROTULO_RESOLUCAO[t.resolucao]}</span>}
        </span>
        {pendente ? (
          podeAcertar ? (
            <button
              onClick={acertar}
              disabled={confirmando}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-medium px-2.5 py-1 hover:bg-amber-100 transition disabled:opacity-60"
            >
              {confirmando ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              {t.resolucao === "COBRAR" ? "Confirmar que recebeu" : "Confirmar que devolveu"}
            </button>
          ) : (
            <span className="text-amber-700">aguardando acerto</span>
          )
        ) : t.resolvidaEm && (t.resolucao === "COBRAR" || t.resolucao === "DEVOLUCAO") ? (
          <span className="text-emerald-700">
            ✓ {t.resolucao === "COBRAR" ? "recebido" : "devolvido"} em {dateShort(new Date(t.resolvidaEm))}
            {t.resolvidaPorNome ? ` por ${t.resolvidaPorNome}` : ""}
          </span>
        ) : null}
      </div>
      {(t.motivo || t.freteCombinado || t.observacoes) && (
        <div className="mt-1.5 text-[11px] text-gray-500 space-y-0.5">
          {t.motivo && <p>Motivo: {t.motivo}</p>}
          {t.freteCombinado && <p>Frete: {t.freteCombinado}</p>}
          {t.observacoes && <p>{t.observacoes}</p>}
        </div>
      )}
      {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
    </li>
  );
}
