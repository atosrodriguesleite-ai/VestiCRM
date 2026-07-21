"use client";

/**
 * Catálogo de revenda (PDF): o lojista/sacoleira encaminha ao cliente da
 * ponta. Neutro (sem marca), com opção de nome da loja e de preço.
 * As preferências ficam salvas na ficha do lojista.
 */

import { useState } from "react";
import { Portal } from "@/components/portal";
import { Images, X } from "lucide-react";

export function ResaleCatalog({
  orderId,
  customerName,
  savedMarkup,
  savedRound,
  savedStoreName,
}: {
  orderId: string;
  customerName: string;
  savedMarkup: number;
  savedRound: boolean;
  savedStoreName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [storeName, setStoreName] = useState(savedStoreName ?? "");
  const [withPrice, setWithPrice] = useState(savedMarkup > 0);
  const [markup, setMarkup] = useState(savedMarkup ? String(savedMarkup) : "100");
  const [round, setRound] = useState(savedRound);

  const href = () => {
    const p = new URLSearchParams();
    if (storeName.trim()) p.set("loja", storeName.trim());
    if (withPrice) {
      p.set("preco", "margem");
      p.set("markup", String(Math.max(0, parseFloat(markup.replace(",", ".")) || 0)));
      if (round) p.set("round", "1");
    } else {
      p.set("preco", "nao");
    }
    return `/api/orders/${orderId}/resale-pdf?${p.toString()}`;
  };

  // prévia: 35 reais com a margem digitada
  const m = Math.max(0, parseFloat(markup.replace(",", ".")) || 0);
  const raw = 35 * (1 + m / 100);
  const preview = round ? Math.max(0, Math.round(raw) - 0.1) : raw;
  const previewTxt = `R$ ${preview.toFixed(2).replace(".", ",")}`;

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
        <Portal><div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
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
