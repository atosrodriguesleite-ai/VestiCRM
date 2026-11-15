"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { Download, ExternalLink, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { linkParaSalvar } from "@/lib/midia-arquivo";
import { useTravarFundo } from "@/components/travar-fundo";
import { medidasDaPagina, pareceUmPdf, ZOOMS } from "@/lib/documento-no-chat";

/**
 * VISOR DE PDF POR CIMA DA CONVERSA — irmão do visor de foto.
 *
 * Existe porque, no aplicativo instalado, abrir o PDF "em outra aba" não
 * abre aba nenhuma: o documento toma a tela do app e não há como voltar
 * (`lib/documento-no-chat.ts`). Aqui o PDF fica DENTRO da Central, e o X, o
 * Esc e o toque no fundo fecham — a conversa nunca sai de baixo. "Salvar"
 * entrega como arquivo (`?baixar=1`, com nome) e "Abrir fora" segue existindo
 * no computador para quem prefere o leitor do navegador.
 *
 * AS PÁGINAS SÃO DESENHADAS POR NÓS (pdf.js), não por uma moldura do
 * navegador: a moldura só mostrava o PDF no computador — no iPhone saía só a
 * primeira página e no Android nada. Três cuidados:
 *
 * - só fica DESENHADA a página que está perto da tela (as outras guardam só
 *   o lugar): um catálogo de 60 páginas desenhado inteiro derruba a aba do
 *   celular por falta de memória. A página que se afasta devolve o quadro E
 *   o que o pdf.js guardou dela (`cleanup` — as fotos decodificadas ficavam
 *   para sempre, achado da revisão);
 * - o arquivo é conferido pelo CONTEÚDO antes de abrir (`pareceUmPdf`), e
 *   pelos PRIMEIROS bytes: o que não é PDF para de baixar ali, em vez de
 *   gastar 12 MB de dados para dizer "não abre". O que não é PDF, o PDF com
 *   senha e a falha dizem o que houve e deixam o botão de salvar — nunca
 *   uma tela preta muda;
 * - o zoom mantém o LUGAR: a página que estava no meio da tela continua no
 *   meio (sem isso, ampliar na página 10 jogava a leitura para a 5);
 * - nada do que está DENTRO do PDF roda: só o desenho das páginas (sem
 *   formulário, sem script, sem link clicável do documento).
 */

type Estado = "carregando" | "pronto" | "nao-pdf" | "senha" | "sessao" | "erro";

/**
 * Baixa o arquivo conferindo a marca de PDF nos PRIMEIROS bytes: não sendo
 * PDF, o download é interrompido ali (devolve `null`). Navegador sem leitura
 * em pedaços baixa inteiro e confere depois, como antes.
 */
async function baixarSeForPdf(res: Response): Promise<ArrayBuffer | null> {
  const leitor = res.body?.getReader?.();
  if (!leitor) {
    const tudo = await res.arrayBuffer();
    return pareceUmPdf(new Uint8Array(tudo, 0, Math.min(tudo.byteLength, 1024))) ? tudo : null;
  }
  const pedacos: Uint8Array[] = [];
  let total = 0;
  let conferido = false;
  for (;;) {
    const { done, value } = await leitor.read();
    if (value) {
      pedacos.push(value);
      total += value.byteLength;
    }
    if (!conferido && (total >= 1024 || done)) {
      const comeco = new Uint8Array(Math.min(total, 1024));
      let posto = 0;
      for (const p of pedacos) {
        if (posto >= comeco.length) break;
        const fatia = p.subarray(0, comeco.length - posto);
        comeco.set(fatia, posto);
        posto += fatia.length;
      }
      if (!pareceUmPdf(comeco)) {
        void leitor.cancel().catch(() => {});
        return null;
      }
      conferido = true;
    }
    if (done) break;
  }
  const tudo = new Uint8Array(total);
  let posto = 0;
  for (const p of pedacos) {
    tudo.set(p, posto);
    posto += p.byteLength;
  }
  return tudo.buffer;
}

export function VisorDeDocumento({
  src,
  nome,
  onClose,
}: {
  src: string;
  nome: string;
  onClose: () => void;
}) {
  useTravarFundo(true);
  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [onClose]);

  const [estado, setEstado] = useState<Estado>("carregando");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  // altura ÷ largura da primeira página: o lugar guardado das que ainda não
  // foram desenhadas (cada uma acerta a sua ao ser desenhada)
  const [proporcao, setProporcao] = useState(1.414);
  const [zoom, setZoom] = useState(0);
  const [largura, setLargura] = useState(0);
  const [tentativa, setTentativa] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);

  // a largura que o visor tem para a página (muda ao virar o celular)
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const medir = () => setLargura(Math.max(0, area.clientWidth - 16));
    medir();
    const olho = new ResizeObserver(medir);
    olho.observe(area);
    return () => olho.disconnect();
  }, []);

  useEffect(() => {
    let vivo = true;
    let largar: (() => void) | null = null;
    setEstado("carregando");
    setDoc(null);
    (async () => {
      try {
        const res = await fetch(src);
        if (!vivo) return;
        if (res.status === 401) return setEstado("sessao");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await baixarSeForPdf(res);
        if (!vivo) return;
        if (!bytes) return setEstado("nao-pdf");
        // build "legacy" do pdf.js: funciona também nos celulares mais
        // antigos das lojistas (o build padrão exige Safari muito novo)
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const tarefa = pdfjs.getDocument({ data: bytes, enableXfa: false });
        largar = () => void tarefa.destroy();
        const aberto = await tarefa.promise;
        if (!vivo) return;
        const primeira = await aberto.getPage(1);
        if (!vivo) return;
        const base = primeira.getViewport({ scale: 1 });
        if (base.width > 0) setProporcao(base.height / base.width);
        setDoc(aberto);
        setEstado("pronto");
      } catch (e) {
        if (!vivo) return;
        setEstado((e as { name?: string } | null)?.name === "PasswordException" ? "senha" : "erro");
      }
    })();
    return () => {
      vivo = false;
      largar?.();
    };
  }, [src, tentativa]);

  const fator = ZOOMS[zoom];

  // O ZOOM MANTÉM O LUGAR: antes de mudar, guarda em que FRAÇÃO do documento
  // está o meio da tela; depois que as páginas mudam de tamanho, devolve
  const lugarRef = useRef<{ x: number; y: number } | null>(null);
  const mudarZoom = (para: (z: number) => number) => {
    const area = areaRef.current;
    if (area && area.scrollHeight > 0 && area.scrollWidth > 0) {
      lugarRef.current = {
        x: (area.scrollLeft + area.clientWidth / 2) / area.scrollWidth,
        y: (area.scrollTop + area.clientHeight / 2) / area.scrollHeight,
      };
    }
    setZoom((z) => Math.min(ZOOMS.length - 1, Math.max(0, para(z))));
  };
  useLayoutEffect(() => {
    const area = areaRef.current;
    const lugar = lugarRef.current;
    if (!area || !lugar) return;
    lugarRef.current = null;
    area.scrollTop = lugar.y * area.scrollHeight - area.clientHeight / 2;
    area.scrollLeft = lugar.x * area.scrollWidth - area.clientWidth / 2;
  }, [zoom]);
  const aviso: Record<Exclude<Estado, "carregando" | "pronto">, string> = {
    "nao-pdf": "Este arquivo não é um PDF, então não abre aqui dentro. Salve no aparelho para abrir.",
    senha: "Este PDF tem senha e não abre aqui dentro. Salve no aparelho e abra com a senha.",
    sessao: "Sua sessão venceu. Entre de novo em outra aba e toque em Tentar de novo.",
    erro: "Não deu para abrir o documento aqui dentro agora. 😕 Tente de novo ou salve no aparelho.",
  };

  return (
    <div
      data-visor-documento
      className="fixed inset-0 z-[95] bg-black animate-fade-in flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* barra: nome do arquivo + ações, sempre visível — é ela que devolve
          a conversa */}
      <div className="flex items-center gap-1.5 px-3 py-2 text-white shrink-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={nome}>
            {nome}
          </p>
          {doc && (
            <p className="text-[11px] text-white/60" data-testid="paginas-do-documento">
              {doc.numPages} {doc.numPages === 1 ? "página" : "páginas"}
            </p>
          )}
        </div>
        {estado === "pronto" && (
          <>
            <button
              type="button"
              onClick={() => mudarZoom((z) => z - 1)}
              disabled={zoom === 0}
              aria-label="Diminuir"
              title="Diminuir"
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition disabled:opacity-40"
            >
              <ZoomOut className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => mudarZoom((z) => z + 1)}
              disabled={zoom === ZOOMS.length - 1}
              aria-label="Aumentar"
              title="Aumentar"
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition disabled:opacity-40"
            >
              <ZoomIn className="size-5" />
            </button>
          </>
        )}
        <a
          href={linkParaSalvar(src)}
          download={nome}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition"
          title="Salvar o arquivo no aparelho"
          aria-label="Salvar o arquivo no aparelho"
        >
          <Download className="size-5" />
        </a>
        <a
          href={src}
          target="_blank"
          rel="noopener"
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition hidden md:inline-flex"
          title="Abrir no leitor do navegador"
        >
          <ExternalLink className="size-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="p-2.5 rounded-full bg-white/15 hover:bg-white/30 transition"
        >
          <X className="size-5" />
        </button>
      </div>

      <div
        ref={areaRef}
        className="flex-1 min-h-0 overflow-auto bg-neutral-900 overscroll-contain"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        onClick={(e) => {
          // toque no fundo escuro (fora das páginas) fecha, como no visor de foto
          if ((e.target as HTMLElement).dataset.fundoDoVisor !== undefined) onClose();
        }}
        data-fundo-do-visor
      >
        {estado === "carregando" && (
          <div className="flex flex-col items-center gap-3 py-24 text-white/70">
            <Loader2 className="size-6 animate-spin" />
            <p className="text-sm">Abrindo o documento…</p>
          </div>
        )}

        {estado !== "carregando" && estado !== "pronto" && (
          <div className="flex flex-col items-center gap-3 px-6 py-24 text-center text-white">
            <p className="text-sm max-w-xs" role="alert">
              {aviso[estado]}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {(estado === "erro" || estado === "sessao") && (
                <button
                  type="button"
                  onClick={() => setTentativa((t) => t + 1)}
                  className="rounded-xl bg-white text-ink text-sm font-medium px-4 py-2 transition hover:bg-white/90"
                >
                  Tentar de novo
                </button>
              )}
              <a
                href={linkParaSalvar(src)}
                download={nome}
                className="rounded-xl border border-white/40 text-sm font-medium px-4 py-2 transition hover:bg-white/10"
              >
                Salvar no aparelho
              </a>
            </div>
          </div>
        )}

        {estado === "pronto" && doc && largura > 0 && (
          // `max-content` + `min-width: 100%`: a página ampliada passa da tela
          // e rola para os DOIS lados (centrada por flex, a beirada esquerda
          // ficava inalcançável)
          <div
            className="py-2"
            style={{ width: "max-content", minWidth: "100%" }}
            data-fundo-do-visor
          >
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PaginaDoPdf
                key={i}
                doc={doc}
                numero={i + 1}
                larguraDisponivel={largura}
                zoom={fator}
                proporcaoPadrao={proporcao}
                raiz={areaRef}
                aoTocarDuasVezes={() => mudarZoom((z) => (z === 0 ? 2 : 0))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * UMA PÁGINA. Guarda o lugar dela na rolagem o tempo todo, mas só fica
 * DESENHADA enquanto está perto da tela — ao se afastar, o quadro de desenho
 * é solto e a memória volta.
 */
function PaginaDoPdf({
  doc,
  numero,
  larguraDisponivel,
  zoom,
  proporcaoPadrao,
  raiz,
  aoTocarDuasVezes,
}: {
  doc: PDFDocumentProxy;
  numero: number;
  larguraDisponivel: number;
  zoom: number;
  proporcaoPadrao: number;
  raiz: React.RefObject<HTMLDivElement | null>;
  aoTocarDuasVezes: () => void;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const quadroRef = useRef<HTMLCanvasElement>(null);
  const [perto, setPerto] = useState(numero === 1);
  const [proporcao, setProporcao] = useState<number | null>(null);
  const [falhou, setFalhou] = useState(false);

  // o tamanho na tela vem da MESMA conta do desenho (`medidasDaPagina`)
  const medidas = medidasDaPagina({
    larguraPdf: 1,
    alturaPdf: proporcao ?? proporcaoPadrao,
    larguraDisponivel,
    zoom,
    dpr: 1,
  });

  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    // "perto" = dentro de uma tela de distância, para cima ou para baixo
    const olho = new IntersectionObserver(
      (vistas) => setPerto(vistas.some((v) => v.isIntersecting)),
      { root: raiz.current, rootMargin: "100% 0px" }
    );
    olho.observe(caixa);
    return () => olho.disconnect();
  }, [raiz]);

  useEffect(() => {
    if (!perto) return;
    let vivo = true;
    let tarefa: RenderTask | null = null;
    let pagina: PDFPageProxy | null = null;
    const quadro = quadroRef.current;
    (async () => {
      pagina = await doc.getPage(numero);
      if (!vivo || !quadro) return;
      const base = pagina.getViewport({ scale: 1 });
      if (base.width > 0) setProporcao(base.height / base.width);
      const m = medidasDaPagina({
        larguraPdf: base.width,
        alturaPdf: base.height,
        larguraDisponivel,
        zoom,
        dpr: window.devicePixelRatio || 1,
      });
      const viewport = pagina.getViewport({ scale: m.escala });
      quadro.width = Math.floor(viewport.width);
      quadro.height = Math.floor(viewport.height);
      tarefa = pagina.render({ canvas: quadro, viewport });
      await tarefa.promise;
      if (vivo) setFalhou(false);
    })().catch((e: { name?: string } | null) => {
      // desenho cancelado (a página saiu de perto, o zoom mudou) não é falha
      if (vivo && e?.name !== "RenderingCancelledException") setFalhou(true);
    });
    return () => {
      vivo = false;
      tarefa?.cancel();
      // o pdf.js guarda, por página, a lista de desenho e as FOTOS já
      // decodificadas — e só as solta quando alguém pede. Sem isto, rolar um
      // catálogo de 60 páginas acumulava as 60 na memória
      try {
        pagina?.cleanup();
      } catch {
        /* página já destruída junto com o documento */
      }
      // quadro zerado devolve a memória NA HORA (o iPhone demora a recolher)
      if (quadro) {
        quadro.width = 0;
        quadro.height = 0;
      }
    };
  }, [perto, doc, numero, larguraDisponivel, zoom]);

  return (
    <div
      ref={caixaRef}
      data-pagina={numero}
      onDoubleClick={aoTocarDuasVezes}
      className="relative mx-auto mb-2 bg-white shadow-lg"
      style={{ width: medidas.larguraCss, height: medidas.alturaCss }}
    >
      {perto && (
        <canvas
          ref={quadroRef}
          aria-label={`Página ${numero}`}
          className="block"
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {falhou && (
        <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-gray-500">
          Não deu para desenhar a página {numero}.
        </p>
      )}
    </div>
  );
}
