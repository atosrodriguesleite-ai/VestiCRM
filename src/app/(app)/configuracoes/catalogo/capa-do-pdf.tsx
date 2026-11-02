"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Search, X } from "lucide-react";
import { prepararCapaNoNavegador } from "@/lib/catalogo/capa-no-navegador";
import {
  FORMATO_RECOMENDADO,
  TETO_FOTOS_DA_CAPA,
  TETO_SUBTITULO,
  TETO_TITULO,
} from "@/lib/catalogo/capa-pdf-regra";

/**
 * A CAPA DO CATÁLOGO EM PDF (RN-094, item 6).
 *
 * Pedido do dono (26/10/2026): editar a capa — ou fazê-la no Canva e subir.
 * Dois caminhos, na mesma seção:
 *
 *  1. **A capa da loja** (imagem): a lojista faz no Canva, no formato A4, e
 *     sobe aqui. O navegador recorta e encolhe antes de mandar (a porta
 *     recebe no máximo 4,5 MB) e o servidor confere de novo. A faixa do
 *     sistema no pé (data + WhatsApp) fica por padrão e a loja pode tirar.
 *  2. **A capa automática, ajustada**: título, uma linha abaixo e as três
 *     peças da capa — quando a loja não quer ir ao Canva.
 *
 * A imagem é SALVA NA HORA em que sobe (um data-URL de meio megabyte não
 * fica esperando num botão de salvar); os ajustes de texto e peças saem
 * pelo botão.
 */
type Peca = { id: string; nome: string; foto: string | null; ativa?: boolean };

export function CapaDoPdf({
  canEdit,
  initial,
}: {
  canEdit: boolean;
  initial: {
    /** a miniatura do que está salvo (nula = sem capa da loja) */
    miniatura: string | null;
    capaTem: boolean;
    faixa: boolean;
    titulo: string;
    subtitulo: string;
    pecas: Peca[];
  };
}) {
  const [miniatura, setMiniatura] = useState(initial.miniatura);
  const [capaTem, setCapaTem] = useState(initial.capaTem);
  const [faixa, setFaixa] = useState(initial.faixa);
  const [titulo, setTitulo] = useState(initial.titulo);
  const [subtitulo, setSubtitulo] = useState(initial.subtitulo);
  const [pecas, setPecas] = useState<Peca[]>(initial.pecas);

  const [ocupado, setOcupado] = useState<null | "capa" | "faixa" | "ajustes">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function patch(corpo: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErro(d?.error ?? "Não foi possível salvar. Tente de novo.");
      return false;
    }
    return true;
  }

  async function subirCapa(arquivo: File) {
    setErro(null);
    setAviso(null);
    setOk(null);
    setOcupado("capa");
    try {
      const pronta = await prepararCapaNoNavegador(arquivo);
      if (!pronta.ok) {
        setErro(pronta.erro);
        return;
      }
      // a borda aparada é dita ANTES de salvar: salva, a capa já vale para o
      // próximo PDF que uma vendedora baixar (achado da revisão)
      if (pronta.aviso && !confirm(`${pronta.aviso}\n\nSalvar a capa assim mesmo?`)) {
        return;
      }
      if (await patch({ catalogPdfCapa: pronta.dataUrl })) {
        setMiniatura(pronta.dataUrl);
        setCapaTem(true);
        setAviso(pronta.aviso);
        setOk("Capa salva. O próximo PDF já sai com ela.");
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setOcupado(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function tirarCapa() {
    if (!confirm("Tirar a capa da loja? O PDF volta para a capa automática.")) return;
    setErro(null);
    setOk(null);
    setOcupado("capa");
    try {
      if (await patch({ catalogPdfCapa: null })) {
        setMiniatura(null);
        setCapaTem(false);
        setOk("Capa removida. O PDF volta para a capa automática.");
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  async function mudarFaixa(valor: boolean) {
    setFaixa(valor);
    setErro(null);
    setOcupado("faixa");
    try {
      if (!(await patch({ catalogPdfCapaFaixa: valor }))) setFaixa(!valor);
    } catch {
      // sem rede a chavinha volta ao que está no banco, e a tela diz
      setFaixa(!valor);
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  async function salvarAjustes() {
    setErro(null);
    setOk(null);
    setOcupado("ajustes");
    try {
      if (
        await patch({
          catalogPdfTitulo: titulo.trim() || null,
          catalogPdfSubtitulo: subtitulo.trim() || null,
          catalogPdfCapaFotos: pecas.map((p) => p.id),
        })
      ) {
        setOk("Ajustes da capa automática salvos.");
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-bold">Capa do catálogo em PDF</h2>
      <p className="mt-1 text-sm text-gray-600">
        Faça a capa do seu jeito (no Canva, por exemplo) e suba aqui — ou ajuste a capa
        automática. A data e o WhatsApp continuam saindo na capa, para a cliente saber de
        quando são os preços.
      </p>

      {/* ── 1 · a capa da loja ─────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[150px_1fr]">
        <div
          className="relative mx-auto aspect-[210/297] w-[150px] overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
          aria-label={capaTem ? "Prévia da capa salva" : "Sem capa da loja"}
        >
          {miniatura ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={miniatura} alt="Capa salva" className="h-full w-full object-cover" />
          ) : capaTem ? (
            <p className="p-3 text-center text-[11px] text-gray-500">Capa enviada (sem prévia)</p>
          ) : (
            <p className="p-3 text-center text-[11px] text-gray-400">
              Capa automática
              <br />
              (cores e logo da loja)
            </p>
          )}
          {capaTem && faixa && (
            <div className="absolute inset-x-0 bottom-0 bg-brand-900/85 px-1 py-1 text-center text-[7px] leading-tight text-white">
              Preços de dd/mm/aaaa · WhatsApp
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold">Minha capa (imagem)</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-gray-600">
            <dt className="font-medium text-gray-700">Formato</dt>
            <dd>{FORMATO_RECOMENDADO.nome}</dd>
            <dt className="font-medium text-gray-700">Tamanho</dt>
            <dd>{FORMATO_RECOMENDADO.pixels}</dd>
            <dt className="font-medium text-gray-700">Arquivo</dt>
            <dd>
              {FORMATO_RECOMENDADO.formatos}, {FORMATO_RECOMENDADO.tamanho}
            </dd>
          </dl>
          <p className="mt-1 text-xs text-gray-500">{FORMATO_RECOMENDADO.canva}</p>

          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={arquivoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subirCapa(f);
                }}
              />
              <button
                type="button"
                onClick={() => arquivoRef.current?.click()}
                disabled={ocupado !== null}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {ocupado === "capa" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {capaTem ? "Trocar a capa" : "Enviar minha capa"}
              </button>
              {capaTem && (
                <button
                  type="button"
                  onClick={tirarCapa}
                  disabled={ocupado !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-60"
                >
                  <Trash2 className="size-4" />
                  Tirar a capa
                </button>
              )}
            </div>
          )}

          {capaTem && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={faixa}
                disabled={!canEdit || ocupado !== null}
                onChange={(e) => void mudarFaixa(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Mostrar a faixa com a data e o WhatsApp</span>
                <span className="block text-xs text-gray-500">
                  Uma faixa fina no pé da capa: &quot;Preços e disponibilidade de dd/mm/aaaa&quot; e
                  o WhatsApp da loja. Sem ela, a capa é 100% sua — e a data só aparece no
                  rodapé das páginas.
                </span>
              </span>
            </label>
          )}
        </div>
      </div>

      {/* ── 2 · a capa automática, ajustada ────────────────────────────── */}
      <div className={`mt-6 border-t border-gray-100 pt-4 ${capaTem ? "opacity-60" : ""}`}>
        <p className="text-sm font-semibold">Capa automática</p>
        <p className="text-xs text-gray-500">
          {capaTem
            ? "Com a sua capa enviada, estes ajustes ficam guardados mas não aparecem."
            : "Sem imagem enviada, o PDF sai com esta capa: cores e logo da loja, três peças, título e data."}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Título</span>
            <input
              value={titulo}
              maxLength={TETO_TITULO}
              disabled={!canEdit}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="CATÁLOGO · MÊS ANO (automático)"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Linha abaixo do título</span>
            <input
              value={subtitulo}
              maxLength={TETO_SUBTITULO}
              disabled={!canEdit}
              onChange={(e) => setSubtitulo(e.target.value)}
              placeholder="Ex.: Lançamentos de verão · pronta entrega"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <PecasDaCapa pecas={pecas} onChange={setPecas} canEdit={canEdit} />

        {canEdit && (
          <button
            type="button"
            onClick={salvarAjustes}
            disabled={ocupado !== null}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-60"
          >
            {ocupado === "ajustes" && <Loader2 className="size-4 animate-spin" />}
            Salvar ajustes da capa automática
          </button>
        )}
      </div>

      {aviso && <p className="mt-3 text-sm text-amber-700">{aviso}</p>}
      {ok && <p className="mt-2 text-sm font-medium text-emerald-700">{ok}</p>}
      {erro && <p className="mt-2 text-sm font-medium text-rose-700">{erro}</p>}
    </section>
  );
}

/**
 * As peças da capa automática: até três, escolhidas pela busca de produtos
 * da loja (a mesma porta da tela de Pedidos). Sem nenhuma, o PDF escolhe
 * sozinho uma do começo, uma do meio e uma do fim do acervo.
 */
function PecasDaCapa({
  pecas,
  onChange,
  canEdit,
}: {
  pecas: Peca[];
  onChange: (p: Peca[]) => void;
  canEdit: boolean;
}) {
  const [termo, setTermo] = useState("");
  const [achadas, setAchadas] = useState<Peca[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const q = termo.trim();
    if (q.length < 2) {
      setAchadas([]);
      return;
    }
    const controle = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(q)}`, { signal: controle.signal });
        if (!res.ok) return;
        const lista = (await res.json()) as { id: string; name: string; images: { url: string }[] }[];
        setAchadas(
          lista.slice(0, 8).map((p) => ({ id: p.id, nome: p.name, foto: p.images[0]?.url ?? null }))
        );
      } catch {
        // busca cancelada ou sem rede: a lista fica como está
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controle.abort();
    };
  }, [termo]);

  const cheio = pecas.length >= TETO_FOTOS_DA_CAPA;

  return (
    <div className="mt-3">
      <p className="text-sm font-medium">
        Peças da capa{" "}
        <span className="font-normal text-gray-500">
          (até {TETO_FOTOS_DA_CAPA}; nenhuma escolhida = o sistema escolhe; a pausada fica guardada e volta ao reativar)
        </span>
      </p>
      {pecas.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {pecas.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 py-1 pl-1 pr-2 text-xs"
            >
              {p.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.foto} alt="" className="size-7 rounded-full object-cover" />
              ) : (
                <span className="size-7 rounded-full bg-gray-200" />
              )}
              <span className={`max-w-[160px] truncate ${p.ativa === false ? "text-gray-400 line-through" : ""}`}>
                {p.nome}
              </span>
              {p.ativa === false && (
                <span className="text-[10px] text-amber-700" title="Peça pausada: não sai na capa até voltar ao catálogo">
                  pausada
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Tirar ${p.nome} da capa`}
                  onClick={() => onChange(pecas.filter((x) => x.id !== p.id))}
                  className="text-gray-400 hover:text-rose-600"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !cheio && (
        <div className="relative mt-2 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-gray-400" />
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar peça pelo nome ou código…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm"
          />
          {buscando && <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-gray-400" />}
          {achadas.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {achadas.map((p) => {
                const ja = pecas.some((x) => x.id === p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={ja}
                      onClick={() => {
                        onChange([...pecas, p]);
                        setTermo("");
                        setAchadas([]);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {p.foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.foto} alt="" className="size-8 rounded object-cover" />
                      ) : (
                        <span className="size-8 rounded bg-gray-200" />
                      )}
                      <span className="truncate">{p.nome}</span>
                      {ja && <span className="ml-auto text-xs text-gray-400">já na capa</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
