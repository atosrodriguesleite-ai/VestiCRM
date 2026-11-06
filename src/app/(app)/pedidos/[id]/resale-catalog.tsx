"use client";

/**
 * Catálogo de revenda (PDF): o lojista/sacoleira encaminha ao cliente da
 * ponta. Neutro (sem marca), com opção de nome da loja e de preço — a
 * margem geral e, por cima dela, a regra de cada CATEGORIA do pedido
 * (margem % ou preço fixo, RN-109), com a prévia pela MESMA conta do PDF.
 * As preferências ficam salvas na ficha do lojista.
 */

import { useMemo, useState } from "react";
import { Portal } from "@/components/portal";
import { Images, X } from "lucide-react";
import {
  avisoDaCategoria,
  categoriasDoPedido,
  faixaDePreco,
  formatarPreco as brl2,
  pagosPorCategoria,
  precoDeRevenda,
  regraQueVale,
  regrasDoPedido,
  type PecaDoPedido,
  type RegrasPorCategoria,
  type TipoDeRegra,
} from "@/lib/revenda/precos";
// o leitor de número em pt-BR da casa: "1.299,90" é mil duzentos e noventa e nove (não 1,299)
import { numeroBR } from "@/lib/format";

/** o que a pessoa digitou em cada linha: "geral" é a margem geral (sem regra própria) */
type LinhaDaCategoria = { modo: "geral" | TipoDeRegra; valor: string };

export function ResaleCatalog({
  orderId,
  customerName,
  savedMarkup,
  savedRound,
  savedStoreName,
  pecas = [],
  savedCategorias = {},
}: {
  orderId: string;
  customerName: string;
  savedMarkup: number;
  savedRound: boolean;
  savedStoreName: string | null;
  /** as peças deste pedido (categoria do cadastro, preço pago, quantidade) — a janela deriva o resto */
  pecas?: PecaDoPedido[];
  /** as regras lembradas na ficha dela, SÓ as das categorias deste pedido (a página recorta) */
  savedCategorias?: RegrasPorCategoria;
}) {
  const categorias = useMemo(() => categoriasDoPedido(pecas), [pecas]);
  const pagos = useMemo(() => pagosPorCategoria(pecas), [pecas]);
  // as regras lembradas que valem AQUI: é o que liga o preço na abertura
  const lembradas = regrasDoPedido(savedCategorias, categorias);
  const [open, setOpen] = useState(false);
  const [storeName, setStoreName] = useState(savedStoreName ?? "");
  const [withPrice, setWithPrice] = useState(savedMarkup > 0 || Object.keys(lembradas).length > 0);
  // a margem geral lembrada vale INCLUSIVE quando é 0% (a revendedora que põe tudo
  // em preço fixo e "Outras" pelo custo) — o 100 é só o palpite de quem nunca escolheu
  const [markup, setMarkup] = useState(savedMarkup > 0 || Object.keys(lembradas).length > 0 ? String(savedMarkup) : "100");
  const [round, setRound] = useState(savedRound);
  // as linhas por categoria partem do que está lembrado na ficha
  const [linhas, setLinhas] = useState<Record<string, LinhaDaCategoria>>(() =>
    Object.fromEntries(
      categorias.map((c) => {
        const r = lembradas[c.nome];
        return [c.nome, r ? { modo: r.tipo, valor: String(r.valor) } : { modo: "geral", valor: "" }];
      })
    )
  );
  const mudarLinha = (nome: string, mudanca: Partial<LinhaDaCategoria>) =>
    setLinhas((l) => ({ ...l, [nome]: { ...(l[nome] ?? { modo: "geral", valor: "" }), ...mudanca } }));
  // trocar o modo APAGA o número: "99,90" de preço fixo virando 99,9% de margem
  // (ou "120" de margem virando R$ 120 fixos) iria para o papel sem ninguém ver
  const mudarModo = (nome: string, modo: LinhaDaCategoria["modo"]) => mudarLinha(nome, { modo, valor: "" });

  const m = numeroBR(markup);
  // a regra que uma linha vale agora: margem própria aceita 0%; preço fixo precisa de número acima de zero
  const regraDaLinha = (l: LinhaDaCategoria) => {
    if (l.modo === "geral" || l.valor.trim() === "") return null;
    const valor = numeroBR(l.valor);
    if (l.modo === "fixo" && valor <= 0) return null;
    return { tipo: l.modo as TipoDeRegra, valor };
  };
  const regras: RegrasPorCategoria = Object.fromEntries(
    Object.entries(linhas).flatMap(([nome, l]) => {
      const r = regraDaLinha(l);
      return r ? [[nome, r] as const] : [];
    })
  );
  const opcoes = { margemGeral: m, arredondar: round, regras };

  const href = () => {
    const p = new URLSearchParams();
    if (storeName.trim()) p.set("loja", storeName.trim());
    if (withPrice) {
      p.set("preco", "margem");
      p.set("markup", String(m));
      if (round) p.set("round", "1");
      const doPedido = regrasDoPedido(regras, categorias);
      if (Object.keys(doPedido).length > 0) p.set("cats", JSON.stringify(doPedido));
    } else {
      p.set("preco", "nao");
    }
    return `/api/orders/${orderId}/resale-pdf?${p.toString()}`;
  };

  // prévia: 35 reais pela margem geral — a MESMA conta do papel
  const previewTxt = brl2(precoDeRevenda(35, null, { ...opcoes, regras: {} }));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
        title="Gera um PDF com as fotos para o cliente revender na ponta"
      >
        <Images className="size-4 text-brand-500" />
        Catálogo de revenda
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)] translate-y-[var(--kbtop,0px)]">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-sm p-6 animate-fade-up max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-lg">Catálogo de revenda</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 p-1">
                <X className="size-5" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              PDF neutro (sem marca) com as fotos deste pedido, para{" "}
              <b>{customerName.split(" ")[0]}</b> revender ao cliente final.
            </p>

            {/* nome da loja (opcional) */}
            <label className="block text-sm font-medium mb-1.5">
              Nome da loja{" "}
              <span className="text-xs font-normal text-gray-400">(opcional)</span>
            </label>
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Ex.: Loja da Camila"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 mb-4"
            />

            {/* preço */}
            <p className="text-sm font-medium mb-1.5">Preço</p>
            <div className="space-y-2 mb-4">
              <label
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition ${
                  !withPrice ? "border-brand-400 bg-brand-50/50" : "border-gray-200"
                }`}
              >
                <input type="radio" checked={!withPrice} onChange={() => setWithPrice(false)} className="mt-0.5 accent-brand-600" />
                <span className="text-sm">
                  <b>Sem preço</b>
                  <span className="block text-xs text-gray-400">
                    O revendedor combina o valor na conversa dele.
                  </span>
                </span>
              </label>

              <label
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition ${
                  withPrice ? "border-brand-400 bg-brand-50/50" : "border-gray-200"
                }`}
              >
                <input type="radio" checked={withPrice} onChange={() => setWithPrice(true)} className="mt-0.5 accent-brand-600" />
                <span className="text-sm flex-1">
                  <b>Com o preço de venda dele</b>
                  <span className="block text-xs text-gray-400">
                    Aplica a margem sobre o que ele pagou, em todas as peças.
                  </span>
                  {withPrice && (
                    <>
                      <span className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-gray-500">Margem de</span>
                        <input
                          value={markup}
                          onChange={(e) => setMarkup(e.target.value)}
                          inputMode="decimal"
                          className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-300"
                        />
                        <span className="text-xs text-gray-500">%</span>
                      </span>
                      <label className="mt-2 flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={round}
                          onChange={(e) => setRound(e.target.checked)}
                          className="accent-brand-600"
                        />
                        <span className="text-xs text-gray-600">
                          Arredondar para terminar em <b>,90</b> (mais atraente)
                        </span>
                      </label>
                      <span className="mt-1.5 block text-[11px] text-gray-400">
                        Ex.: peça de R$ 35 → sai <b>{previewTxt}</b>
                      </span>
                    </>
                  )}
                </span>
              </label>
            </div>

            {/* POR CATEGORIA (RN-109): cada categoria do pedido com a regra dela — margem geral, margem própria ou preço fixo */}
            {withPrice && categorias.length > 0 && (
              <div className="mb-4" data-testid="revenda-categorias">
                <p className="text-sm font-medium mb-0.5">Por categoria</p>
                <p className="text-[11px] text-gray-400 mb-2">
                  Quem ficar em &quot;margem geral&quot; segue os {m}% acima. O preço fixo vale para toda peça da categoria.
                </p>
                <ul className="space-y-2">
                  {categorias.map((c) => {
                    const linha = linhas[c.nome] ?? { modo: "geral", valor: "" };
                    const faixa = faixaDePreco(c, opcoes);
                    const regra = regraQueVale(c.nome, opcoes);
                    const aviso = avisoDaCategoria(c, regras[c.nome], pagos[c.nome] ?? []);
                    const precisaDeNumero = linha.modo === "fixo" && linha.valor.trim() !== "" && !regras[c.nome];
                    const pagou = c.menorPago === c.maiorPago ? brl2(c.menorPago) : `${brl2(c.menorPago)} a ${brl2(c.maiorPago)}`;
                    const sai = faixa.de === faixa.ate ? brl2(faixa.de) : `${brl2(faixa.de)} a ${brl2(faixa.ate)}`;
                    return (
                      <li key={c.nome} className="rounded-xl border border-gray-200 p-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium truncate">{c.nome}</span>
                          <span className="text-[11px] text-gray-400 shrink-0">
                            {c.pecas} {c.pecas === 1 ? "peça" : "peças"} · pagou {pagou}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <select
                            aria-label={`Regra de ${c.nome}`}
                            value={linha.modo}
                            onChange={(e) => mudarModo(c.nome, e.target.value as LinhaDaCategoria["modo"])}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white"
                          >
                            <option value="geral">Margem geral</option>
                            <option value="margem">Margem própria (%)</option>
                            <option value="fixo">Preço fixo (R$)</option>
                          </select>
                          {linha.modo !== "geral" && (
                            <input
                              aria-label={linha.modo === "fixo" ? `Preço fixo de ${c.nome}` : `Margem de ${c.nome}`}
                              value={linha.valor}
                              onChange={(e) => mudarLinha(c.nome, { valor: e.target.value })}
                              inputMode="decimal"
                              placeholder={linha.modo === "fixo" ? "49,90" : "120"}
                              className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-300"
                            />
                          )}
                          {linha.modo === "margem" && <span className="text-xs text-gray-500">%</span>}
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">
                          Sai a <b className="text-gray-700">{sai}</b>
                          {regra.tipo === "margem" && linha.modo === "geral" && " (margem geral)"}
                        </p>
                        {precisaDeNumero && (
                          <p className="mt-1 text-[11px] font-medium text-amber-700" role="alert">
                            Preço fixo precisa ser maior que zero — enquanto isso vale a margem geral.
                          </p>
                        )}
                        {aviso?.tipo === "abaixo-do-custo" && (
                          <p className="mt-1 text-[11px] font-medium text-red-700" role="alert">
                            {aviso.pecasAbaixo === 1 ? "1 peça custou" : `${aviso.pecasAbaixo} peças custaram`} esse valor ou mais — ela venderia no prejuízo.
                          </p>
                        )}
                        {aviso?.tipo === "margem-baixa" && (
                          <p className="mt-1 text-[11px] font-medium text-amber-700" role="alert">
                            Margem de só {Math.round(aviso.margemMinima)}% na peça mais cara ({brl2(c.maiorPago)}).
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <a
              href={href()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setTimeout(() => setOpen(false), 300)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 text-sm transition"
            >
              <Images className="size-4" />
              Gerar PDF
            </a>
            <p className="text-[11px] text-gray-400 text-center mt-2">
              Suas escolhas ficam salvas para os próximos catálogos deste cliente.
            </p>
          </div>
        </div></Portal>
      )}
    </>
  );
}
