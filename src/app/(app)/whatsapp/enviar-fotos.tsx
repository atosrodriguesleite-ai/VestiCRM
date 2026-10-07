"use client";

/**
 * RN-071 · a janelinha "Enviar fotos" da Central: a vendedora marca as
 * categorias (ou Todas), escolhe se entram só peças com estoque, e o
 * sistema gera o link de 7 dias — a mensagem pronta volta para o campo de
 * digitação (quem envia é a vendedora, nunca o sistema: RN-017).
 *
 * Janela presa à área visível (`--vvh`/`--vvtop`) com a página de trás
 * travada — a lição da grade (RN-062): no iPhone o teclado e a barra do
 * Safari mudam o `innerHeight` sozinhos.
 */

import { useEffect, useState } from "react";
import { Images, Loader2, X } from "lucide-react";
import { Portal } from "@/components/portal";
import { useTravarFundo } from "@/components/travar-fundo";

type Categoria = { nome: string; pecas: number; comEstoque: number };

export function EnviarFotosDialog({
  open,
  customerId,
  onClose,
  onGerado,
}: {
  open: boolean;
  customerId: string | null;
  onClose: () => void;
  onGerado: (resultado: { url: string; categorias: string[] }) => void;
}) {
  useTravarFundo(open);
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [todas, setTodas] = useState(true);
  const [soComEstoque, setSoComEstoque] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!open) return;
    setErro("");
    setCategorias(null);
    fetch("/api/fotos-link")
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { categorias?: Categoria[]; sessao?: string; error?: string };
        // recusa não é "catálogo sem foto": sessão vencida (RN-064) pede
        // login em outra aba; o resto mostra a frase do servidor
        if (!r.ok) {
          setErro(
            r.status === 401 && d.sessao === "vencida"
              ? "Sua sessão venceu. Entre de novo em outra aba e volte aqui."
              : d.error ?? "Não consegui carregar as categorias. Tente de novo."
          );
          return;
        }
        setCategorias(d.categorias ?? []);
      })
      .catch(() => setErro("Não consegui carregar as categorias. Tente de novo."));
  }, [open]);

  if (!open) return null;

  function alternar(nome: string) {
    setTodas(false);
    setMarcadas((prev) => {
      const n = new Set(prev);
      if (n.has(nome)) n.delete(nome);
      else n.add(nome);
      return n;
    });
  }

  const escolhidas = todas ? [] : [...marcadas];
  const podeGerar = (todas || marcadas.size > 0) && !gerando;
  const fotosEscolhidas = (categorias ?? [])
    .filter((c) => todas || marcadas.has(c.nome))
    .reduce((s, c) => s + (soComEstoque ? c.comEstoque : c.pecas), 0);

  async function gerar() {
    if (!podeGerar) return;
    setGerando(true);
    setErro("");
    try {
      const r = await fetch("/api/fotos-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categorias: escolhidas, soComEstoque, customerId: customerId ?? undefined }),
      });
      const d = (await r.json().catch(() => ({}))) as { url?: string; categorias?: string[]; error?: string };
      if (!r.ok || !d.url) {
        setErro(d.error ?? "Não consegui gerar o link. Tente de novo.");
        return;
      }
      onGerado({ url: d.url, categorias: d.categorias ?? escolhidas });
    } catch {
      setErro("Não consegui gerar o link. Tente de novo.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <Portal>
      <div
        className="fixed inset-x-0 top-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center"
        style={{ height: "var(--vvh, 100dvh)", transform: "translateY(var(--vvtop, 0px))" }}
        onClick={onClose}
      >
        <div
          className="flex max-h-[90%] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <Images className="size-4.5 text-brand-600" />
            <h2 className="flex-1 text-sm font-bold">Enviar fotos para a cliente</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-3 text-xs text-gray-500">
              Ela abre um link com as fotos do catálogo — <b>sem preço</b> — e salva as que quiser, uma a uma.
              O link vale por <b>7 dias</b>.
            </p>

            {erro && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{erro}</p>}

            {categorias === null && !erro && (
              <p className="flex items-center gap-2 py-6 text-sm text-gray-400">
                <Loader2 className="size-4 animate-spin" /> Carregando categorias…
              </p>
            )}

            {categorias && categorias.length === 0 && (
              <p className="py-6 text-sm text-gray-500">Nenhuma peça ativa com foto no catálogo ainda.</p>
            )}

            {categorias && categorias.length > 0 && (
              <ul className="space-y-1">
                <li>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={todas}
                      onChange={(e) => {
                        setTodas(e.target.checked);
                        if (e.target.checked) setMarcadas(new Set());
                      }}
                      className="size-4 accent-brand-600"
                    />
                    <span className="flex-1 text-sm font-semibold">Todas as categorias</span>
                  </label>
                </li>
                {categorias.map((c) => (
                  <li key={c.nome}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={todas || marcadas.has(c.nome)}
                        onChange={() => alternar(c.nome)}
                        className="size-4 accent-brand-600"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{c.nome}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">
                        {soComEstoque ? c.comEstoque : c.pecas} {(soComEstoque ? c.comEstoque : c.pecas) === 1 ? "peça" : "peças"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 px-3 py-2">
              <input
                type="checkbox"
                checked={soComEstoque}
                onChange={(e) => setSoComEstoque(e.target.checked)}
                className="size-4 accent-brand-600"
              />
              <span className="flex-1 text-xs text-gray-700">
                Só peças <b>com estoque</b> <span className="text-gray-400">(a cliente não posta o que você não tem)</span>
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
            <span className="text-[11px] text-gray-500">
              {categorias ? `${fotosEscolhidas} ${fotosEscolhidas === 1 ? "peça" : "peças"} no link` : ""}
            </span>
            <button
              type="button"
              onClick={gerar}
              disabled={!podeGerar}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {gerando && <Loader2 className="size-4 animate-spin" />}
              Gerar link
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
