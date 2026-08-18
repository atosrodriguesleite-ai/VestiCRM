"use client";

import { useEffect, useState } from "react";
import { Copy, CheckCircle2, Plus, Loader2, Link2 } from "lucide-react";
import { Card } from "@/components/ui";
import { copiarTexto } from "@/lib/copiar";

/**
 * LINKS COM TABELA DE PREÇO — atacado e varejo no mesmo catálogo.
 *
 * A loja que atende lojista E cliente final cria um link para cada público:
 * manda o de atacado para quem revende e o de varejo para quem leva uma peça.
 * O código é sorteado, então o preço de atacado não se descobre por tentativa.
 *
 * Esta seção só aparece para quem tem o recurso ativado — quem não pediu não
 * vê nada de diferente no catálogo.
 */

type Link = {
  id: string;
  name: string;
  code: string;
  priceMode: "VAREJO" | "ATACADO";
  active: boolean;
};

export function LinksDePreco({
  baseUrl,
  canEdit,
}: {
  /** endereço público do catálogo, já absoluto (montado no servidor) */
  baseUrl: string;
  canEdit: boolean;
}) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [nome, setNome] = useState("");
  const [modo, setModo] = useState<"VAREJO" | "ATACADO">("ATACADO");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/catalog-links")
      .then((r) => (r.ok ? r.json() : { links: [] }))
      .then((d) => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  }, []);

  const enderecoDe = (code: string) => `${baseUrl}/l/${code}`;

  async function criar() {
    if (!nome.trim() || busy) return;
    setBusy(true);
    setErro("");
    const res = await fetch("/api/catalog-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome.trim(), priceMode: modo }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      return setErro(d.error ?? "Não foi possível criar o link agora.");
    }
    const d = await res.json();
    setLinks((prev) => [...(prev ?? []), d.link]);
    setNome("");
  }

  async function alternar(l: Link) {
    setErro("");
    const desejado = !l.active;
    setLinks((prev) =>
      (prev ?? []).map((x) => (x.id === l.id ? { ...x, active: desejado } : x))
    );
    const res = await fetch("/api/catalog-links", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: l.id, active: desejado }),
    }).catch(() => null);
    // DESFAZ se o servidor recusou: mostrar "desativado" com o link ainda
    // no ar é pior que não ter o botão (a lojista acharia que fechou)
    if (!res || !res.ok) {
      setLinks((prev) =>
        (prev ?? []).map((x) => (x.id === l.id ? { ...x, active: l.active } : x))
      );
      setErro(
        desejado
          ? "Não consegui ativar o link agora. Tente de novo."
          : "Não consegui desativar o link — ele CONTINUA valendo. Tente de novo."
      );
    }
  }

  async function copiar(l: Link) {
    const deu = await copiarTexto(enderecoDe(l.code));
    if (!deu) return setErro("Não consegui copiar. Selecione o endereço e copie à mão.");
    setCopiado(l.id);
    setTimeout(() => setCopiado(null), 2000);
  }

  return (
    <Card className="p-5 md:p-6 mt-4">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Link2 className="size-4 text-brand-600" />
        Links com tabela de preço
      </h2>
      <p className="text-xs text-gray-500 mb-4 leading-snug">
        Um link para cada público: mande o de <b>atacado</b> para lojistas e o de{" "}
        <b>varejo</b> para cliente final. O mesmo catálogo, cada um vendo o seu
        preço. O endereço tem um código sorteado — quem não recebeu o link não
        descobre o preço de atacado. No link de atacado, o sistema{" "}
        <b>exige a quantidade mínima</b> cadastrada em cada produto.
      </p>

      {canEdit && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-gray-500">
              Nome do link (só você vê)
            </label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criar()}
              placeholder="Ex.: Lojistas"
              maxLength={40}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-500">
              Tabela
            </label>
            <select
              value={modo}
              onChange={(e) => setModo(e.target.value as "VAREJO" | "ATACADO")}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            >
              <option value="ATACADO">Atacado</option>
              <option value="VAREJO">Varejo</option>
            </select>
          </div>
          <button
            onClick={criar}
            disabled={busy || !nome.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Criar link
          </button>
        </div>
      )}

      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{erro}</p>
      )}

      {links === null ? (
        <p className="py-4 text-center text-sm text-gray-400">Carregando…</p>
      ) : links.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          Nenhum link criado ainda. O catálogo normal continua funcionando como sempre.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((l) => (
            <div
              key={l.id}
              className={`rounded-xl border px-3 py-2.5 ${
                l.active ? "border-gray-100" : "border-gray-100 bg-gray-50 opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{l.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    l.priceMode === "ATACADO"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-sky-50 text-sky-700"
                  }`}
                >
                  {l.priceMode === "ATACADO" ? "Atacado" : "Varejo"}
                </span>
                {!l.active && (
                  <span className="text-[11px] font-medium text-gray-400">desativado</span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => copiar(l)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300"
                  >
                    {copiado === l.id ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copiado === l.id ? "Copiado!" : "Copiar link"}
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => alternar(l)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:border-gray-300"
                    >
                      {l.active ? "Desativar" : "Ativar"}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-gray-400">
                /l/{l.code}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
