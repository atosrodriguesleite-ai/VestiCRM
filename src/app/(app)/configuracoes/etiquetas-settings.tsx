"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Tag } from "lucide-react";
import { Card } from "@/components/ui";
import {
  ALTURA_MAX_MM,
  ALTURA_MIN_MM,
  DADOS_DE_EXEMPLO,
  LARGURA_MAX_MM,
  LARGURA_MIN_MM,
  layoutEmbalagem,
  OPCOES_PADRAO,
  elementosCabem,
  type OpcoesEmbalagem,
} from "@/lib/etiquetas/modelo";
import { svgDaEtiqueta } from "@/lib/etiquetas/svg";

/**
 * CONFIGURAÇÕES → ETIQUETAS (RN-059): tamanho da etiqueta de embalagem e
 * quais campos ela mostra, com a prévia desenhada pela MESMA regra que
 * imprime (svg ← layoutEmbalagem). O que a lojista vê aqui é o que sai da
 * Zebra. Gerência e suporte editam; o resto só vê.
 */
export function EtiquetasSettings({ canEdit }: { canEdit: boolean }) {
  const [op, setOp] = useState<OpcoesEmbalagem>(OPCOES_PADRAO);
  const [carregado, setCarregado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  useEffect(() => {
    fetch("/api/etiquetas/modelo")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.opcoes) setOp(d.opcoes);
      })
      .finally(() => setCarregado(true));
  }, []);

  const modelo = useMemo(() => layoutEmbalagem(op), [op]);
  const cabe = useMemo(() => elementosCabem(modelo), [modelo]);
  const svg = useMemo(() => svgDaEtiqueta(modelo, DADOS_DE_EXEMPLO), [modelo]);

  async function salvar() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/etiquetas/modelo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    setMsg(
      r.ok
        ? { tipo: "ok", texto: "Etiqueta salva. As próximas impressões saem assim." }
        : { tipo: "erro", texto: d?.error ?? "Não foi possível salvar." }
    );
  }

  const num = (k: "larguraMm" | "alturaMm") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setOp((o) => ({ ...o, [k]: Number(e.target.value) || 0 }));
  const campo = "w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 disabled:bg-gray-50";

  return (
    <Card className="p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Tag className="size-4 text-brand-600" />
        Etiquetas de embalagem
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        O tamanho do rolo da sua impressora e o que a etiqueta mostra. O código de barras é
        gerado pelo sistema para cada cor e tamanho, e é ele que o leitor bipa na separação.
      </p>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 w-20">Largura</label>
            <input type="number" min={LARGURA_MIN_MM} max={LARGURA_MAX_MM} step={1} value={op.larguraMm} onChange={num("larguraMm")} disabled={!canEdit} className={campo} />
            <span className="text-xs text-gray-400">mm</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 w-20">Altura</label>
            <input type="number" min={ALTURA_MIN_MM} max={ALTURA_MAX_MM} step={1} value={op.alturaMm} onChange={num("alturaMm")} disabled={!canEdit} className={campo} />
            <span className="text-xs text-gray-400">mm</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={op.mostrarLoja} disabled={!canEdit} onChange={(e) => setOp((o) => ({ ...o, mostrarLoja: e.target.checked }))} />
            Nome da loja no rodapé
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={op.mostrarSku} disabled={!canEdit} onChange={(e) => setOp((o) => ({ ...o, mostrarSku: e.target.checked }))} />
            SKU da peça
          </label>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 w-20">Preço</label>
            <select
              value={op.preco ?? ""}
              disabled={!canEdit}
              onChange={(e) => setOp((o) => ({ ...o, preco: (e.target.value || null) as OpcoesEmbalagem["preco"] }))}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-brand-400 disabled:bg-gray-50"
            >
              <option value="">sem preço</option>
              <option value="atacado">atacado</option>
              <option value="varejo">varejo</option>
            </select>
          </div>
          {!cabe && (
            <p className="text-xs text-rose-600">
              Nesse tamanho não cabe tudo: aumente a altura ou tire um campo do rodapé.
            </p>
          )}
          {msg && (
            <p className={`text-sm ${msg.tipo === "ok" ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</p>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={salvar}
              disabled={busy || !cabe || !carregado}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-50"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Salvar etiqueta
            </button>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-2">Prévia (peça de exemplo, em tamanho aproximado):</p>
          <div
            className="inline-block rounded-lg bg-gray-50 p-3 [&>svg]:max-w-full [&>svg]:h-auto"
            style={{ width: `min(100%, ${op.larguraMm * 4}px)` }}
            // SVG gerado pelo próprio sistema a partir do modelo (sem entrada de usuário livre)
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="text-[11px] text-gray-400 mt-2">
            Para imprimir direto na Zebra pelo navegador, instale o <b>Zebra Browser Print</b> no
            computador da loja. Sem ele, o PDF funciona em qualquer impressora de etiquetas.
          </p>
        </div>
      </div>
    </Card>
  );
}
