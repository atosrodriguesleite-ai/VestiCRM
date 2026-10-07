"use client";

/**
 * RN-070 · a galeria que a cliente abre no celular: categorias em chips,
 * grade de fotos, toque abre a foto grande e cada foto tem o seu BAIXAR
 * (sem ZIP — decisão do dono: "muitas pessoas têm dificuldade de abrir").
 * Sem preço e sem marca: a foto é para ela repostar.
 *
 * "Salvar todas" tem DOIS caminhos, porque os aparelhos são diferentes
 * (achado da revisão): no Android/computador baixa UMA A UMA, em sequência
 * (o Chrome pede permissão para vários downloads uma vez e segue); no
 * iPhone o Safari só honra o download disparado pelo TOQUE — depois do
 * primeiro, os outros são ignorados em silêncio, e a tela anunciaria 20/20
 * com uma foto salva. Lá as fotos vão pela folha de compartilhar do próprio
 * aparelho (`navigator.share` com arquivos), que oferece "Salvar N imagens"
 * direto na galeria de fotos — que é onde a cliente quer que elas fiquem.
 * Se o aparelho não deixar, a tela DIZ para salvar uma a uma.
 *
 * Cada salvamento avisa o servidor por beacon (com a quantidade), só para
 * o contador do link.
 */

import { useEffect, useMemo, useState } from "react";
import { Download, X, ChevronLeft, ChevronRight, Images, ShoppingBag } from "lucide-react";
import { downloadHref, extensaoDaImagem, imageHref } from "@/lib/img";
import { waLink } from "@/lib/bio";
import { nomeDoArquivoDaFoto, type CategoriaDaGaleria } from "@/lib/fotos/regra";

type Foto = { id: string; peca: string; cor: string | null; indice: number; nome: string };

/** no iPhone/iPad a folha de compartilhar é o caminho; o teto é da memória do aparelho */
const TETO_DO_COMPARTILHAR = 40;

function fotosDaCategoria(c: CategoriaDaGaleria): Foto[] {
  return c.pecas.flatMap((p) =>
    p.fotos.map((f, i) => ({ id: f.id, peca: p.nome, cor: f.cor, indice: i, nome: nomeDoArquivoDaFoto(p.nome, f.cor, i) }))
  );
}

function contarDownload(code: string, n = 1) {
  try {
    const corpo = JSON.stringify({ code, n });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/catalogo/fotos/evento", new Blob([corpo], { type: "application/json" }));
    } else {
      void fetch("/api/catalogo/fotos/evento", { method: "POST", body: corpo, headers: { "content-type": "application/json" }, keepalive: true });
    }
  } catch {
    /* contador é enfeite comparado ao download */
  }
}

function ehAparelhoApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** um download pelo link de arquivo: o servidor manda o nome e a extensão certa */
function baixar(foto: Foto, code: string) {
  const a = document.createElement("a");
  a.href = downloadHref(foto.id, foto.nome);
  a.download = foto.nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  contarDownload(code);
}

/** as fotos como ARQUIVOS, para a folha de compartilhar; null se o aparelho não compartilha arquivo */
async function arquivosParaCompartilhar(fotos: Foto[]): Promise<File[] | null> {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return null;
  const arquivos: File[] = [];
  for (const f of fotos) {
    const r = await fetch(imageHref(f.id));
    if (!r.ok) continue;
    const blob = await r.blob();
    arquivos.push(new File([blob], `${f.nome}.${extensaoDaImagem(blob.type)}`, { type: blob.type || "image/jpeg" }));
  }
  if (arquivos.length === 0 || !navigator.canShare({ files: arquivos })) return null;
  return arquivos;
}

export function GaleriaDeFotos({
  loja,
  code,
  vencido,
  categorias,
  validoAte,
  catalogo,
}: {
  loja: { nome: string; logoUrl: string | null; whatsapp: string | null };
  code: string;
  vencido: boolean;
  categorias: CategoriaDaGaleria[];
  validoAte?: string;
  /** o catálogo da loja, já com a vendedora do link (RN-005) */
  catalogo?: string;
}) {
  const [ativa, setAtiva] = useState<string | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const [salvandoTodas, setSalvandoTodas] = useState<{ feitas: number; total: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const visiveis = useMemo(
    () => (ativa ? categorias.filter((c) => c.categoria === ativa) : categorias),
    [categorias, ativa]
  );
  const fotos = useMemo(() => visiveis.flatMap(fotosDaCategoria), [visiveis]);
  const totalDeFotos = categorias.reduce((s, c) => s + c.fotos, 0);

  // setas do teclado no computador; Escape fecha
  useEffect(() => {
    if (aberta === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberta(null);
      if (e.key === "ArrowRight") setAberta((i) => (i === null ? i : Math.min(fotos.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setAberta((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberta, fotos.length]);

  async function salvarTodas() {
    if (salvandoTodas || fotos.length === 0) return;
    setAviso(null);
    if (ehAparelhoApple()) {
      // iPhone: a folha de compartilhar → "Salvar imagens" na galeria
      const lote = fotos.slice(0, TETO_DO_COMPARTILHAR);
      setSalvandoTodas({ feitas: 0, total: lote.length });
      try {
        const arquivos = await arquivosParaCompartilhar(lote);
        if (!arquivos) throw new Error("sem-compartilhar");
        await navigator.share({ files: arquivos });
        contarDownload(code, arquivos.length);
        if (fotos.length > lote.length) {
          setAviso(`Foram as ${lote.length} primeiras. Para as outras, filtre por categoria ou salve uma a uma.`);
        }
      } catch (e) {
        // a pessoa fechou a folha: não é erro; qualquer outra coisa, a saída é uma a uma
        if (!(e instanceof Error && e.name === "AbortError")) {
          setAviso("Neste aparelho, salve uma foto por vez: toque no botão de cada foto.");
        }
      } finally {
        setSalvandoTodas(null);
      }
      return;
    }
    setSalvandoTodas({ feitas: 0, total: fotos.length });
    for (let i = 0; i < fotos.length; i++) {
      baixar(fotos[i], code);
      setSalvandoTodas({ feitas: i + 1, total: fotos.length });
      // uma de cada vez: em rajada o navegador descarta as do meio
      await new Promise((r) => setTimeout(r, 700));
    }
    setSalvandoTodas(null);
  }

  // o número da loja pela MESMA régua da bio (DDD 55 não é código do país)
  const linkDaLoja = waLink(loja.whatsapp);

  return (
    <main className="min-h-screen bg-[#f7f3ee] text-gray-900">
      <header className="sticky top-0 z-10 border-b border-black/5 bg-[#f7f3ee]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          {loja.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={loja.logoUrl} alt="" className="size-9 rounded-lg object-cover" />
          ) : (
            <div className="grid size-9 place-items-center rounded-lg bg-gray-900 text-sm font-bold text-white">
              {loja.nome.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{loja.nome}</p>
            <p className="text-[11px] text-gray-500">
              {vencido ? "Fotos para divulgação" : `${totalDeFotos} ${totalDeFotos === 1 ? "foto" : "fotos"} para você baixar`}
            </p>
          </div>
          {catalogo && !vencido && (
            <a
              href={catalogo}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-inset ring-gray-200"
            >
              <ShoppingBag className="size-3.5" /> Ver catálogo
            </a>
          )}
        </div>
      </header>

      {vencido ? (
        <section className="mx-auto max-w-md px-4 py-16 text-center">
          <Images className="mx-auto size-10 text-gray-300" />
          <h1 className="mt-4 text-lg font-bold">Este link de fotos não vale mais</h1>
          <p className="mt-2 text-sm text-gray-600">
            Os links de fotos valem por 7 dias. É só pedir um novo para quem te atende que ele chega na hora. 😊
          </p>
          {linkDaLoja && (
            <a
              href={linkDaLoja}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Falar com {loja.nome} no WhatsApp
            </a>
          )}
        </section>
      ) : categorias.length === 0 ? (
        <section className="mx-auto max-w-md px-4 py-16 text-center">
          <Images className="mx-auto size-10 text-gray-300" />
          <h1 className="mt-4 text-lg font-bold">Nenhuma foto disponível agora</h1>
          <p className="mt-2 text-sm text-gray-600">As peças deste link estão esgotadas ou saíram do catálogo. Peça um link novo para quem te atende.</p>
        </section>
      ) : (
        <section className="mx-auto max-w-5xl px-4 pb-24 pt-4">
          {categorias.length > 1 && (
            <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              <button
                type="button"
                onClick={() => setAtiva(null)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition ${
                  ativa === null ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-700 ring-gray-200"
                }`}
              >
                Todas ({totalDeFotos})
              </button>
              {categorias.map((c) => (
                <button
                  key={c.categoria}
                  type="button"
                  onClick={() => setAtiva(c.categoria)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition ${
                    ativa === c.categoria ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-700 ring-gray-200"
                  }`}
                >
                  {c.categoria} ({c.fotos})
                </button>
              ))}
            </div>
          )}

          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Toque na foto para ver grande. O botão <Download className="inline size-3" /> salva no seu celular.
            </p>
            <button
              type="button"
              onClick={salvarTodas}
              disabled={salvandoTodas !== null || fotos.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              <Download className="size-3.5" />
              {salvandoTodas
                ? `Salvando ${salvandoTodas.feitas}/${salvandoTodas.total}…`
                : `Salvar ${ativa ? "estas" : "todas as"} ${fotos.length} fotos`}
            </button>
          </div>

          {aviso && <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">{aviso}</p>}

          {visiveis.map((c) => (
            <div key={c.categoria} className="mb-8">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
                {c.categoria} <span className="font-normal normal-case text-gray-400">· {c.fotos} {c.fotos === 1 ? "foto" : "fotos"}</span>
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {fotosDaCategoria(c).map((f) => {
                  const idx = fotos.findIndex((x) => x.id === f.id);
                  return (
                    <figure key={f.id} className="group relative overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
                      <button type="button" onClick={() => setAberta(idx)} className="block w-full" title="Ver grande">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageHref(f.id)} alt={f.peca} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                      </button>
                      <figcaption className="flex items-center gap-1.5 px-2 py-1.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">{f.peca}</span>
                          {f.cor && <span className="block truncate text-[11px] text-gray-500">{f.cor}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => baixar(f, code)}
                          title="Salvar esta foto"
                          aria-label={`Salvar ${f.nome}`}
                          className="grid size-8 shrink-0 place-items-center rounded-lg bg-gray-900 text-white transition hover:bg-gray-700"
                        >
                          <Download className="size-4" />
                        </button>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </div>
          ))}

          {validoAte && (
            <p className="mt-6 text-center text-[11px] text-gray-400">
              Este link vale até {new Date(validoAte).toLocaleDateString("pt-BR")}. Depois disso, é só pedir outro. 💛
            </p>
          )}
        </section>
      )}

      {aberta !== null && fotos[aberta] && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" onClick={() => setAberta(null)}>
          <div className="flex items-center justify-between gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{fotos[aberta].peca}</p>
              {fotos[aberta].cor && <p className="truncate text-xs text-white/70">{fotos[aberta].cor}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => baixar(fotos[aberta], code)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900"
              >
                <Download className="size-4" /> Salvar
              </button>
              <button type="button" onClick={() => setAberta(null)} aria-label="Fechar" className="rounded-xl p-2 text-white/80 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-6" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageHref(fotos[aberta].id)} alt={fotos[aberta].peca} className="max-h-full max-w-full rounded-lg object-contain" />
            {aberta > 0 && (
              <button type="button" onClick={() => setAberta(aberta - 1)} aria-label="Anterior" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2">
                <ChevronLeft className="size-6" />
              </button>
            )}
            {aberta < fotos.length - 1 && (
              <button type="button" onClick={() => setAberta(aberta + 1)} aria-label="Próxima" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2">
                <ChevronRight className="size-6" />
              </button>
            )}
          </div>
          <p className="pb-4 text-center text-[11px] text-white/60">{aberta + 1} de {fotos.length}</p>
        </div>
      )}
    </main>
  );
}
