"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Info } from "lucide-react";

/**
 * RN-055 + RN-054 · A parte FISCAL da nota, configurada pela loja.
 *
 * A tela existe para uma coisa só: **tirar a loja da obrigação de manter um
 * segundo catálogo no Bling**. Cadastrando o NCM por categoria aqui, a nota
 * sai completa daqui — e o atacado tem 5 a 15 categorias, não 164 variações.
 *
 * O texto da tela repete, de propósito, que **os números são do contador**:
 * NCM e natureza erradas são imposto errado, e quem responde é a loja. O
 * sistema não sugere número nenhum.
 */

type Estado = {
  conectado: boolean;
  ncmPadrao: string;
  origemMercadoria: number;
  naturezaContribuinteId: string;
  naturezaNaoContribuinteId: string;
  categorias: string[];
  ncmPorCategoria: Record<string, string>;
};

/** Mostra com os pontos, como o contador manda e o Bling recebe. */
function comPontos(v: string) {
  const d = (v ?? "").replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
}

export function BlingFiscal() {
  const [e, setE] = useState<Estado | null>(null);
  const [ncms, setNcms] = useState<Record<string, string>>({});
  const [padrao, setPadrao] = useState("");
  const [origem, setOrigem] = useState(0);
  const [contrib, setContrib] = useState("");
  const [naoContrib, setNaoContrib] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/bling/fiscal");
    if (!res.ok) return;
    const d: Estado = await res.json();
    setE(d);
    setNcms(
      Object.fromEntries(d.categorias.map((c) => [c, comPontos(d.ncmPorCategoria[c] ?? "")]))
    );
    setPadrao(comPontos(d.ncmPadrao));
    setOrigem(d.origemMercadoria);
    setContrib(d.naturezaContribuinteId ?? "");
    setNaoContrib(d.naturezaNaoContribuinteId ?? "");
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/bling/fiscal", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categorias: ncms,
        ncmPadrao: padrao,
        origemMercadoria: origem,
        // texto sempre: em branco APAGA o cadastro e volta à padrão do Bling
        naturezaContribuinteId: contrib,
        naturezaNaoContribuinteId: naoContrib,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(
      res.ok
        ? { tipo: "ok", texto: "Configuração fiscal salva." }
        : { tipo: "erro", texto: d.error ?? "Não consegui salvar." }
    );
    if (res.ok) carregar();
  }

  if (!e || !e.conectado) return null;

  return (
    <div className="mt-5 pt-5 border-t border-gray-100">
      <h3 className="font-semibold text-sm mb-1">Informação fiscal da nota</h3>
      <p className="text-sm text-gray-500 mb-4">
        Cadastrando aqui, a nota sai completa do AtacadoPro e{" "}
        <b>você não precisa cadastrar os produtos no Bling</b>.{" "}
        <span className="text-gray-400">
          Os números abaixo são do seu contador — o sistema não sugere nenhum.
        </span>
      </p>

      {/* ---- NCM por categoria: o caminho normal do atacado ---- */}
      <div className="rounded-xl border border-gray-100 p-4 mb-4">
        <p className="text-sm font-medium mb-1">NCM por categoria</p>
        <p className="text-xs text-gray-500 mb-3">
          O NCM é do <b>tipo</b> da peça, então uma linha resolve todas as cores e
          tamanhos daquela categoria. Deixar em branco faz a categoria usar o NCM
          padrão da loja.
        </p>
        {e.categorias.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhuma categoria de produto cadastrada ainda.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {e.categorias.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate text-gray-600" title={c}>
                  {c}
                </span>
                <input
                  value={ncms[c] ?? ""}
                  onChange={(ev) => setNcms((s) => ({ ...s, [c]: comPontos(ev.target.value) }))}
                  placeholder="0000.00.00"
                  inputMode="numeric"
                  className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-sm tabular-nums outline-none focus:border-brand-400"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ---- os degraus de baixo: padrão da loja e origem ---- */}
      <div className="grid gap-3 sm:grid-cols-2 mb-4">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">NCM padrão da loja</span>
          <input
            value={padrao}
            onChange={(ev) => setPadrao(comPontos(ev.target.value))}
            placeholder="0000.00.00"
            inputMode="numeric"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums outline-none focus:border-brand-400"
          />
          <span className="block text-xs text-gray-400 mt-1">
            Vale para a categoria que ficou sem NCM. Quem vende um tipo só de peça
            preenche só este.
          </span>
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Origem da mercadoria</span>
          <select
            value={origem}
            onChange={(ev) => setOrigem(Number(ev.target.value))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
          >
            <option value={0}>0 — Nacional</option>
            <option value={1}>1 — Estrangeira (importação direta)</option>
            <option value={2}>2 — Estrangeira (mercado interno)</option>
            <option value={3}>3 — Nacional com mais de 40% importado</option>
            <option value={4}>4 — Nacional (processos produtivos básicos)</option>
            <option value={5}>5 — Nacional com até 40% importado</option>
            <option value={6}>6 — Estrangeira sem similar nacional</option>
            <option value={7}>7 — Estrangeira sem similar (mercado interno)</option>
            <option value={8}>8 — Nacional com mais de 70% importado</option>
          </select>
          <span className="block text-xs text-gray-400 mt-1">
            Confecção fabricada no Brasil é <b>0 — Nacional</b>.
          </span>
        </label>
      </div>

      {/* ---- natureza de operação (RN-054) ---- */}
      <div className="rounded-xl border border-gray-100 p-4 mb-4">
        <p className="text-sm font-medium mb-1">Natureza de operação</p>
        <p className="text-xs text-gray-500 mb-3">
          O sistema escolhe conforme o documento da cliente: quem tem{" "}
          <b>CNPJ com inscrição estadual</b> é contribuinte; quem compra no{" "}
          <b>CPF</b> (ou CNPJ isento) é consumidor final. Deixando em branco, a
          nota sai pela natureza padrão da sua conta no Bling, como hoje.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Cliente contribuinte (CNPJ + IE)</span>
            <input
              value={contrib}
              onChange={(ev) => setContrib(ev.target.value.replace(/\D/g, ""))}
              placeholder="ID da natureza"
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums outline-none focus:border-brand-400"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Consumidor final (CPF)</span>
            <input
              value={naoContrib}
              onChange={(ev) => setNaoContrib(ev.target.value.replace(/\D/g, ""))}
              placeholder="ID da natureza"
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums outline-none focus:border-brand-400"
            />
          </label>
        </div>
        <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-3">
          <Info className="size-3.5 shrink-0 mt-0.5" />
          <span>
            Onde achar o ID: no Bling, em{" "}
            <b>Preferências → Notas Fiscais → Naturezas de operação</b>, abra a
            natureza; o número aparece no endereço da página.
          </span>
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {msg ? (
          <span
            className={`text-xs font-medium ${msg.tipo === "ok" ? "text-emerald-600" : "text-rose-600"}`}
          >
            {msg.texto}
          </span>
        ) : (
          <span />
        )}
        <button
          onClick={salvar}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar
        </button>
      </div>
    </div>
  );
}
