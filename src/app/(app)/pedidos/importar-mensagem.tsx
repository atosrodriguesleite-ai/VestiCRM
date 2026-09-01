"use client";

/**
 * PEDIDO A PARTIR DA MENSAGEM DO WHATSAPP.
 *
 * A vendedora cola a mensagem que a cliente mandou e o pedido se monta
 * sozinho. É a rede de segurança da venda que só existe na conversa: o
 * pedido feito antes da proteção contra perda, a cliente que mandou de
 * outro aparelho, o print que aparece dias depois.
 *
 * A conferência continua sendo de gente: a tela mostra peça por peça, o
 * que não casou com o catálogo e o que está sem estoque, e o preço vem
 * SEMPRE do nosso cadastro (número em mensagem se digita errado).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Portal } from "@/components/portal";
import { ClipboardPaste, X, Loader2, AlertTriangle, Check } from "lucide-react";
import { brl, formatPhone } from "@/lib/format";

type Linha = {
  descricao: string;
  productId: string | null;
  variantId: string | null;
  nome: string | null;
  cor: string | null;
  tamanho: string;
  quantidade: number;
  unitPrice: number | null;
  estoque: number | null;
  problema: string | null;
};

type Previa = {
  loja: string | null;
  cliente: {
    encontrada: { id: string; name: string; phone: string } | null;
    nome: string | null;
    lojaDela: string | null;
    telefone: string | null;
  };
  linhas: Linha[];
  resumo: {
    pecasLidas: number;
    pecasNaMensagem: number | null;
    confere: boolean;
    valorNaMensagem: number | null;
    comProblema: number;
    /** desconto do link de campanha lido na mensagem (RN-040) */
    descontoDoLink?: number;
    campanhaNaMensagem?: string | null;
    campanhaSlug?: string | null;
    /** a mensagem cita campanha que não achamos: preço cheio, mas AVISANDO */
    campanhaNaoResolvida?: boolean;
  };
};

export function ImportarMensagemButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  function fechar() {
    setOpen(false);
    setTexto("");
    setPrevia(null);
    setErro("");
  }

  async function ler() {
    setBusy(true);
    setErro("");
    const res = await fetch("/api/orders/ler-mensagem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErro(d.error ?? "Não consegui ler essa mensagem.");
    setPrevia(d);
  }

  /** Só entra no pedido o que casou com o catálogo E tem estoque. */
  const aproveitaveis = (previa?.linhas ?? []).filter((l) => l.variantId && !l.problema);
  const subtotal = aproveitaveis.reduce((s, l) => s + l.quantidade * (l.unitPrice ?? 0), 0);

  async function criar() {
    if (!previa || aproveitaveis.length === 0) return;
    setBusy(true);
    setErro("");

    // a cliente: usa o cadastro existente ou cria na hora com o que veio na
    // mensagem (mesmo caminho do "novo pedido", com dedup por telefone)
    let customerId = previa.cliente.encontrada?.id;
    if (!customerId) {
      if (!previa.cliente.telefone || !previa.cliente.nome) {
        setBusy(false);
        return setErro(
          "A mensagem não trouxe nome e telefone da cliente. Crie o pedido pelo botão “Novo pedido”."
        );
      }
      const r = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: previa.cliente.nome,
          phone: previa.cliente.telefone,
          origin: "MANUAL",
          skipOpportunity: true,
        }),
      });
      if (!r.ok) {
        setBusy(false);
        return setErro("Não foi possível cadastrar a cliente.");
      }
      customerId = (await r.json()).id;
    }

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        items: aproveitaveis.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantidade,
          unitPrice: l.unitPrice ?? 0,
        })),
        status: "AGUARDANDO_PAGAMENTO",
        // carimbo do link de campanha (RN-040): é o que faz a peça
        // acrescentada depois seguir o mesmo desconto — e é por ele que a
        // exclusão da campanha conta os pedidos dela
        campaignRef: previa.resumo.campanhaSlug ?? null,
        notes: [
          "Pedido lançado a partir da mensagem do WhatsApp.",
          previa.cliente.lojaDela ? `Loja da cliente: ${previa.cliente.lojaDela}` : null,
          // POR QUE ESTE PEDIDO SAIU MAIS BARATO — senão o valor não se
          // explica depois (mesma linha que o pedido do catálogo grava)
          previa.resumo.descontoDoLink
            ? `🏷 Link da campanha “${previa.resumo.campanhaNaMensagem}” — ${previa.resumo.descontoDoLink}% de desconto já aplicado.`
            : null,
          previa.resumo.campanhaNaoResolvida
            ? `⚠️ A mensagem citava a campanha “${previa.resumo.campanhaNaMensagem}”, que não confere com o cadastro. Os preços são os cheios — confira o valor combinado com a cliente.`
            : null,
          previa.resumo.comProblema > 0
            ? `⚠️ ${previa.resumo.comProblema} linha(s) da mensagem não entraram (sem cadastro ou sem estoque) — confira com a cliente.`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      // a mensagem do servidor vem primeiro; se nem JSON veio, mostramos o
      // código do erro — "não foi possível" sem mais nada não ajuda ninguém
      const d = await res.json().catch(() => null);
      return setErro(
        d?.error ??
          `Não foi possível criar o pedido (erro ${res.status}). Tente de novo; se repetir, avise o suporte com o horário.`
      );
    }
    const order = await res.json();
    fechar();
    router.push(`/pedidos/${order.id}`);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium px-4 py-2.5 transition active:scale-[0.98]"
        title="Cole a mensagem do pedido que a cliente enviou pelo WhatsApp"
      >
        <ClipboardPaste className="size-4" />
        Colar pedido do WhatsApp
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
            <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl">
              <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3.5">
                <h2 className="text-base font-bold">Pedido pela mensagem do WhatsApp</h2>
                <button onClick={fechar} className="rounded-lg p-1.5 hover:bg-gray-100">
                  <X className="size-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {!previa ? (
                  <>
                    <p className="text-sm text-gray-600">
                      Abra a conversa no WhatsApp, copie a mensagem do pedido que a
                      cliente enviou e cole aqui. O sistema monta o pedido — você
                      confere antes de salvar.
                    </p>
                    <textarea
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      rows={10}
                      placeholder={
                        "*Novo pedido — Sua Loja*\n\n*Blusas*\n• Cropped Básico Comfy Preto — P ×2, M ×1  (3 peças · R$ 149,70)\n\n*Total:* 3 peças · R$ 149,70\n\n*Cliente*\nNome: ...\nTelefone: ..."
                      }
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-mono outline-none focus:border-brand-400 transition"
                    />
                    {erro && (
                      <p className="flex items-start gap-1.5 text-sm text-rose-600">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        {erro}
                      </p>
                    )}
                    <button
                      onClick={ler}
                      disabled={busy || texto.trim().length < 10}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      Ler pedido
                    </button>
                  </>
                ) : (
                  <>
                    {/* cliente */}
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Cliente
                      </p>
                      {previa.cliente.encontrada ? (
                        <p className="mt-1 text-sm">
                          <b>{previa.cliente.encontrada.name}</b>
                          <span className="text-gray-500">
                            {" "}
                            · {formatPhone(previa.cliente.encontrada.phone)}
                          </span>
                          <span className="ml-1.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                            já cadastrada
                          </span>
                        </p>
                      ) : previa.cliente.nome && previa.cliente.telefone ? (
                        <p className="mt-1 text-sm">
                          <b>{previa.cliente.nome}</b>
                          <span className="text-gray-500">
                            {" "}
                            · {formatPhone(previa.cliente.telefone)}
                          </span>
                          <span className="ml-1.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                            será cadastrada
                          </span>
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-rose-600">
                          A mensagem não trouxe nome e telefone.
                        </p>
                      )}
                      {previa.cliente.lojaDela && (
                        <p className="text-[12px] text-gray-500">
                          Loja: {previa.cliente.lojaDela}
                        </p>
                      )}
                    </div>

                    {/* conferência */}
                    {!previa.resumo.confere && (
                      <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        A mensagem diz {previa.resumo.pecasNaMensagem} peças, mas eu li{" "}
                        {previa.resumo.pecasLidas}. Confira se a mensagem foi colada
                        inteira.
                      </p>
                    )}

                    {/* peças */}
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      {previa.linhas.map((l, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-0 ${
                            l.problema ? "bg-rose-50/60" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {l.nome ?? l.descricao}
                            </p>
                            <p className="text-[12px] text-gray-500">
                              {[l.cor, l.tamanho].filter(Boolean).join(" · ")} ·{" "}
                              {l.quantidade}{" "}
                              {l.quantidade === 1 ? "peça" : "peças"}
                              {l.unitPrice !== null && !l.problema
                                ? ` · ${brl(l.unitPrice)} cada`
                                : ""}
                            </p>
                            {l.problema && (
                              <p className="text-[12px] font-medium text-rose-600">
                                {l.problema}
                              </p>
                            )}
                          </div>
                          {!l.problema && (
                            <Check className="size-4 shrink-0 text-emerald-600" />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        {aproveitaveis.length} de {previa.linhas.length} linhas entram
                        no pedido
                      </span>
                      <b>{brl(subtotal)}</b>
                    </div>
                    {previa.resumo.campanhaNaoResolvida && (
                      <p className="text-[12px] text-amber-700">
                        ⚠️ A mensagem cita a campanha{" "}
                        <b>“{previa.resumo.campanhaNaMensagem}”</b>, e o desconto
                        dela não confere com o cadastro de agora (pode ter sido
                        pausada, renomeada ou ter mudado de porcentagem). Os
                        preços acima são os <b>cheios</b> — confira com a
                        cliente o valor combinado antes de criar o pedido.
                      </p>
                    )}
                    {!!previa.resumo.descontoDoLink && (
                      <p className="text-[12px] text-emerald-700">
                        🏷 A mensagem veio de um link de campanha com{" "}
                        <b>{previa.resumo.descontoDoLink}% de desconto</b> — os
                        preços acima já saem com ele.
                      </p>
                    )}
                    {previa.resumo.comProblema > 0 && (
                      <p className="text-[12px] text-gray-500">
                        As linhas em vermelho ficam de fora e são anotadas no pedido —
                        combine com a cliente e adicione depois, se for o caso.
                      </p>
                    )}
                    {erro && (
                      <p className="flex items-start gap-1.5 text-sm text-rose-600">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        {erro}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => setPrevia(null)}
                        className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium hover:bg-gray-50"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={criar}
                        disabled={busy || aproveitaveis.length === 0}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
                      >
                        {busy && <Loader2 className="size-4 animate-spin" />}
                        Criar pedido com {aproveitaveis.length}{" "}
                        {aproveitaveis.length === 1 ? "linha" : "linhas"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
