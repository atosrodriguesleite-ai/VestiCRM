"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, X } from "lucide-react";
import { Portal } from "@/components/portal";
import { imprimirNaZebra, zebraDisponivel, type ImpressoraZebra } from "@/lib/etiquetas/browser-print";

/** o mesmo teto da rota (TETO_ETIQUETAS_POR_LOTE), por linha */
const TETO_POR_LINHA = 500;

/** solta a URL do blob depois que o navegador já a usou (senão vaza uma por impressão) */
function soltarDepois(url: string) {
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * O MODAL DE IMPRESSÃO DE ETIQUETAS (RN-059), o mesmo na ficha da peça (a
 * grade inteira) e no pedido (só as peças dele). Cada linha tem a quantidade
 * que a lojista quer; o servidor monta o texto e o código do cadastro.
 *
 * Três saídas: PDF (qualquer impressora pelo driver, abre para imprimir),
 * Zebra direto (quando o Browser Print está rodando no computador) e o
 * arquivo ZPL (para quem manda pelo utilitário da Zebra).
 */
export type ItemParaEtiqueta = {
  variantId: string;
  rotulo: string;
  detalhe?: string;
  quantidade: number;
};

export function ImprimirEtiquetas({
  titulo,
  itens,
  onClose,
}: {
  titulo: string;
  itens: ItemParaEtiqueta[];
  onClose: () => void;
}) {
  // a sugestão respeita o teto por linha: estoque de 600 abria com 600 e o
  // servidor recusava sem explicar (achado da revisão)
  const [qtd, setQtd] = useState<Record<string, number>>(() =>
    Object.fromEntries(itens.map((i) => [i.variantId, Math.max(0, Math.min(TETO_POR_LINHA, i.quantidade))]))
  );
  const [faltando, setFaltando] = useState<string[]>([]);
  const [zebra, setZebra] = useState<ImpressoraZebra | null | "procurando">("procurando");
  const [busy, setBusy] = useState<"" | "pdf" | "zebra" | "zpl">("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let vivo = true;
    zebraDisponivel().then((z) => vivo && setZebra(z));
    return () => {
      vivo = false;
    };
  }, []);

  const total = useMemo(() => Object.values(qtd).reduce((s, n) => s + (n || 0), 0), [qtd]);

  const lote = () =>
    itens.map((i) => ({ variantId: i.variantId, quantidade: qtd[i.variantId] || 0 })).filter((i) => i.quantidade > 0);

  async function pedir(formato: "pdf" | "zpl") {
    const r = await fetch("/api/etiquetas/imprimir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formato, itens: lote() }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      if (Array.isArray(d?.faltando)) setFaltando(d.faltando);
      throw new Error(d?.error ?? "Não foi possível gerar as etiquetas.");
    }
    setFaltando([]);
    return r;
  }

  async function pdf() {
    setBusy("pdf");
    setErro("");
    setAviso("");
    // a aba nova é aberta NO CLIQUE (antes de esperar o servidor): depois de
    // um await o bloqueador de pop-up do Safari/iPad a engole em silêncio e a
    // tela dizia "aberto em outra aba" (achado da revisão). Bloqueada mesmo
    // assim, o PDF vira download.
    const aba = window.open("", "_blank");
    try {
      const r = await pedir("pdf");
      const url = URL.createObjectURL(await r.blob());
      soltarDepois(url);
      if (aba && !aba.closed) {
        aba.location.href = url;
        setAviso(`PDF com ${total} etiqueta${total === 1 ? "" : "s"} aberto em outra aba. Na impressão, escolha a impressora de etiquetas e "tamanho real".`);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `etiquetas-${total}.pdf`;
        a.click();
        setAviso(`PDF com ${total} etiqueta${total === 1 ? "" : "s"} baixado. Abra e imprima na impressora de etiquetas em "tamanho real".`);
      }
    } catch (e) {
      aba?.close();
      setErro(e instanceof Error ? e.message : "Erro ao gerar o PDF.");
    } finally {
      setBusy("");
    }
  }

  async function zpl() {
    setBusy("zpl");
    setErro("");
    setAviso("");
    try {
      const r = await pedir("zpl");
      const url = URL.createObjectURL(await r.blob());
      soltarDepois(url);
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiquetas-${total}.zpl`;
      a.click();
      setAviso("Arquivo ZPL baixado. Mande para a Zebra pelo utilitário dela (Zebra Setup Utilities → Open Communication → Send file).");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao gerar o ZPL.");
    } finally {
      setBusy("");
    }
  }

  async function naZebra() {
    if (!zebra || zebra === "procurando") return;
    setBusy("zebra");
    setErro("");
    setAviso("");
    try {
      const r = await pedir("zpl");
      await imprimirNaZebra(zebra, await r.text());
      setAviso(`${total} etiqueta${total === 1 ? "" : "s"} enviada${total === 1 ? "" : "s"} para ${zebra.name}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao imprimir na Zebra.");
    } finally {
      setBusy("");
    }
  }

  const botao =
    "inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium px-4 py-2.5 transition disabled:opacity-50";

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
        <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
        <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-lg max-h-[90dvh] overflow-y-auto thin-scroll animate-fade-up p-6">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <h3 className="font-semibold text-lg leading-tight flex items-center gap-2">
                <Printer className="size-5 text-brand-600" />
                Etiquetas de embalagem
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">{titulo}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 p-1 shrink-0" aria-label="Fechar">
              <X className="size-5" />
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto thin-scroll rounded-xl border border-gray-100 divide-y divide-gray-50 mb-3">
            {itens.map((i) => (
              <div
                key={i.variantId}
                className={`flex items-center gap-2 px-3 py-1.5 ${faltando.includes(i.variantId) ? "bg-rose-50" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {i.rotulo}
                    {faltando.includes(i.variantId) && (
                      <span className="ml-1.5 text-[10px] font-semibold text-rose-600">não existe mais</span>
                    )}
                  </p>
                  {i.detalhe && <p className="text-[11px] text-gray-400 truncate">{i.detalhe}</p>}
                </div>
                <input
                  type="number"
                  min={0}
                  max={TETO_POR_LINHA}
                  inputMode="numeric"
                  value={qtd[i.variantId] ?? 0}
                  onChange={(e) =>
                    setQtd((q) => ({
                      ...q,
                      [i.variantId]: Math.max(0, Math.min(TETO_POR_LINHA, Math.floor(Number(e.target.value) || 0))),
                    }))
                  }
                  aria-label={`Quantidade de etiquetas de ${i.rotulo}`}
                  className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm text-right tabular-nums outline-none focus:border-brand-400"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Total: <b>{total}</b> etiqueta{total === 1 ? "" : "s"}. O tamanho e os campos são os de
            Configurações → Etiquetas.
          </p>

          {erro && <p className="mb-3 text-sm text-rose-600">{erro}</p>}
          {aviso && <p className="mb-3 text-sm text-emerald-700">{aviso}</p>}

          <div className="flex flex-col gap-2">
            {zebra === "procurando" ? (
              <p className="text-xs text-gray-400 flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" /> Procurando a Zebra no computador…
              </p>
            ) : zebra ? (
              <button
                onClick={naZebra}
                disabled={busy !== "" || total === 0}
                className={`${botao} bg-brand-600 hover:bg-brand-700 text-white`}
              >
                {busy === "zebra" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                Imprimir na {zebra.name}
              </button>
            ) : (
              <p className="text-[11px] text-gray-400">
                Zebra não encontrada no computador. Para imprimir direto, instale o{" "}
                <b>Zebra Browser Print</b> e deixe-o aberto; enquanto isso, use o PDF.
              </p>
            )}
            <button
              onClick={pdf}
              disabled={busy !== "" || total === 0}
              className={`${botao} ${zebra && zebra !== "procurando" ? "border border-gray-200 hover:border-brand-300 text-gray-700" : "bg-brand-600 hover:bg-brand-700 text-white"}`}
            >
              {busy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              Gerar PDF para imprimir (qualquer impressora)
            </button>
            <button
              onClick={zpl}
              disabled={busy !== "" || total === 0}
              className={`${botao} border border-gray-200 hover:border-gray-300 text-gray-500 text-xs py-2`}
            >
              Baixar arquivo ZPL (Zebra)
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
