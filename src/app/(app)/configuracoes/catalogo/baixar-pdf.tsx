"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";

/**
 * BAIXAR O CATÁLOGO EM PDF (RN-094).
 *
 * Pedido do dono (23/10/2026): há cliente que não consegue abrir o link do
 * catálogo. O PDF é UM arquivo — baixa de uma vez, fica no aparelho e abre
 * sem internet, sem navegador e sem JavaScript; a vendedora o encaminha no
 * WhatsApp como qualquer foto ou documento.
 *
 * A tela **não escolhe nada de dinheiro**: ela só diz por qual link de tabela
 * (quando a loja usa o recurso) e quais categorias. O preço, as peças e a
 * ordem saem do servidor, da mesma fonte da vitrine.
 */
export function BaixarCatalogoPdf({
  categorias,
  tabelas,
}: {
  categorias: string[];
  /** links de tabela de preço da loja (RN-018); vazio = recurso desligado */
  tabelas: { code: string; name: string; mode: string }[];
}) {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tabela, setTabela] = useState("");
  const [escolhidas, setEscolhidas] = useState<string[]>([]);

  const alternar = (c: string) =>
    setEscolhidas((atual) =>
      atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c]
    );

  async function baixar() {
    setBaixando(true);
    setErro(null);
    setAviso(null);
    try {
      const q = new URLSearchParams();
      if (tabela) q.set("l", tabela);
      for (const c of escolhidas) q.append("cat", c);
      const res = await fetch(`/api/catalogo/pdf?${q}`);
      if (!res.ok) {
        // a rota responde em português; o texto cru só aparece se faltar
        const j = await res.json().catch(() => null);
        setErro(j?.error ?? "Não deu para gerar o catálogo agora. Tente de novo.");
        return;
      }
      const blob = await res.blob();
      const nome =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "catalogo.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);

      /*
       * O QUE SAIU, DITO. A lojista vai mandar este arquivo para a cliente:
       * ela precisa saber quantas peças foram, se alguma ficou sem foto e se
       * o acervo não coube inteiro — descobrir isso pela cliente é tarde.
       */
      const n = (h: string) => Number(res.headers.get(h) ?? 0);
      const partes = [
        `${n("X-Catalogo-Pecas")} peças em ${n("X-Catalogo-Paginas")} páginas`,
        `${(blob.size / 1024 / 1024).toFixed(1)} MB`,
      ];
      if (n("X-Catalogo-Sem-Foto") > 0) {
        partes.push(`${n("X-Catalogo-Sem-Foto")} sem foto`);
      }
      if (n("X-Catalogo-Cortadas") > 0) {
        partes.push(
          `${n("X-Catalogo-Cortadas")} não couberam — gere por categoria para incluir todas`
        );
      }
      setAviso(`Pronto: ${partes.join(" · ")}.`);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-bold">Catálogo em PDF</h2>
      <p className="mt-1 text-sm text-gray-600">
        Um arquivo só, com as mesmas peças e os mesmos preços do catálogo online.
        Serve para a cliente que não consegue abrir o link: ela baixa uma vez e
        vê tudo depois, mesmo sem internet.
      </p>
      <p className="mt-1 text-xs text-gray-500">
        O PDF é uma fotografia de hoje — a data vai na capa, e o preço de
        amanhã só muda gerando outro.
      </p>

      {tabelas.length > 0 && (
        <label className="mt-4 block text-sm">
          <span className="font-semibold">Tabela de preço</span>
          <select
            value={tabela}
            onChange={(e) => setTabela(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Catálogo normal da loja</option>
            {tabelas.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name} ({t.mode === "ATACADO" ? "atacado" : "varejo"})
              </option>
            ))}
          </select>
        </label>
      )}

      {categorias.length > 1 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">
            Categorias{" "}
            <span className="font-normal text-gray-500">
              (nenhuma marcada = o catálogo inteiro)
            </span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categorias.map((c) => {
              const on = escolhidas.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => alternar(c)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <button
        type="button"
        onClick={baixar}
        disabled={baixando}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {baixando ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileDown className="size-4" />
        )}
        {baixando ? "Montando o catálogo…" : "Baixar catálogo em PDF"}
      </button>
      {baixando && (
        <p className="mt-2 text-xs text-gray-500">
          Pode levar alguns segundos: cada foto entra no arquivo.
        </p>
      )}
      {aviso && <p className="mt-2 text-sm font-medium text-emerald-700">{aviso}</p>}
      {erro && <p className="mt-2 text-sm font-medium text-rose-700">{erro}</p>}
    </section>
  );
}
