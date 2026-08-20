"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Share2 } from "lucide-react";

/**
 * Desenha o PDF do romaneio dentro da página (pdf.js), página por página.
 *
 * O motivo de não abrir o PDF direto: no app instalado (PWA), o visualizador
 * nativo toma a tela inteira e não tem "voltar" — a lojista ficava presa.
 * Aqui a barra do topo fica sempre visível, com Voltar, Compartilhar e Baixar.
 *
 * • Compartilhar usa o painel nativo do celular (WhatsApp, salvar em
 *   arquivos, imprimir) — só aparece quando o aparelho suporta.
 * • Baixar/abrir o PDF cru só aparece FORA do app instalado (no navegador
 *   comum há botão de voltar); dentro do app ele recriaria a armadilha.
 */

type Estado = "carregando" | "pronto" | "erro";

export function RomaneioViewer({
  orderId,
  numero,
}: {
  orderId: string;
  numero: string;
}) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [compartilha, setCompartilha] = useState(false);
  const [instalado, setInstalado] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const paginasRef = useRef<HTMLDivElement>(null);
  // bytes do PDF ficam guardados para o Compartilhar não baixar de novo
  const bytesRef = useRef<ArrayBuffer | null>(null);

  const pdfUrl = `/api/orders/${orderId}/pdf`;
  const nomeArquivo = `pedido-${numero.replace("#", "")}.pdf`;

  useEffect(() => {
    // dentro do app instalado? (é onde o PDF cru prende a tela)
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS antigo expõe só a flag própria do Safari
      Boolean((navigator as { standalone?: boolean }).standalone);
    setInstalado(standalone);

    let vivo = true;
    let cancelar: (() => void) | null = null;

    (async () => {
      try {
        setEstado("carregando");
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (!vivo) return;
        bytesRef.current = bytes.slice(0);

        // o painel de compartilhar precisa aceitar ARQUIVO (não só link)
        const arquivo = new File([bytes.slice(0)], nomeArquivo, {
          type: "application/pdf",
        });
        setCompartilha(
          typeof navigator.canShare === "function" &&
            navigator.canShare({ files: [arquivo] })
        );

        // build "legacy" do pdf.js: funciona também nos celulares mais
        // antigos das lojistas (o build padrão exige Safari muito novo)
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const tarefa = pdfjs.getDocument({ data: bytes });
        cancelar = () => void tarefa.destroy();
        const doc = await tarefa.promise;
        if (!vivo) return;

        const alvo = paginasRef.current;
        if (!alvo) return;
        alvo.replaceChildren();

        // nitidez: desenha nos pixels reais da tela (limitado para não
        // estourar memória em pedido grande no celular)
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const larguraCss = Math.min(alvo.clientWidth, 820);

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (!vivo) return;
          const base = page.getViewport({ scale: 1 });
          const escala = larguraCss / base.width;
          const viewport = page.getViewport({ scale: escala * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${larguraCss}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
          canvas.className = "block bg-white rounded-lg shadow-sm mx-auto";
          canvas.setAttribute("aria-label", `Página ${i} do romaneio`);
          alvo.appendChild(canvas);

          await page.render({ canvas, viewport }).promise;
        }
        if (vivo) setEstado("pronto");
      } catch {
        if (vivo) setEstado("erro");
      }
    })();

    return () => {
      vivo = false;
      cancelar?.();
    };
    // recarrega quando a lojista toca em "Tentar de novo"
  }, [pdfUrl, nomeArquivo, tentativa]);

  const compartilhar = useCallback(async () => {
    const bytes = bytesRef.current;
    if (!bytes) return;
    const arquivo = new File([bytes.slice(0)], nomeArquivo, {
      type: "application/pdf",
    });
    try {
      await navigator.share({ files: [arquivo], title: `Romaneio ${numero}` });
    } catch {
      // a lojista fechou o painel — não é erro
    }
  }, [nomeArquivo, numero]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* barra sempre visível: é ela que devolve o caminho de volta */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-gray-50/95 backdrop-blur border-b border-gray-200 flex items-center gap-2">
        <Link
          href={`/pedidos/${orderId}`}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white hover:border-gray-300 text-gray-700 text-sm font-medium px-3 py-2 transition"
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-gray-800 truncate">
          Romaneio {numero}
        </h1>
        {compartilha && estado === "pronto" && (
          <button
            onClick={compartilhar}
            className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3 py-2 transition"
          >
            <Share2 className="size-4" />
            Compartilhar
          </button>
        )}
        {!instalado && (
          <a
            href={pdfUrl}
            target="_blank"
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white hover:border-gray-300 text-gray-700 text-sm font-medium px-3 py-2 transition"
            title="Abrir o arquivo PDF (para imprimir ou salvar)"
          >
            <Download className="size-4" />
            PDF
          </a>
        )}
      </div>

      {estado === "carregando" && (
        <div className="flex flex-col items-center gap-3 py-24 text-gray-500">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Montando o romaneio…</p>
        </div>
      )}

      {estado === "erro" && (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="text-sm text-gray-600">
            Não deu para carregar o romaneio agora. 😕
          </p>
          <button
            onClick={() => setTentativa((t) => t + 1)}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition"
          >
            Tentar de novo
          </button>
        </div>
      )}

      <div ref={paginasRef} className="flex flex-col gap-4 py-4" />
    </div>
  );
}
