"use client";

import { Plus, Trash2, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Peças reutilizáveis da página do produto.
 *
 * A página é longa por natureza (é um manual), então cada bloco vive aqui e
 * o arquivo principal fica só com a montagem e a gravação. Evita repetir a
 * mesma tabela seis vezes e evita outra tela gigante no projeto.
 */

/* ============================================================ SEÇÃO */

export function Bloco({
  id,
  titulo,
  descricao,
  children,
  acao,
}: {
  id: string;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">
              {titulo}
            </h2>
            {descricao && (
              <p className="mt-1 text-sm text-slate-500">{descricao}</p>
            )}
          </div>
          {acao && <div className="shrink-0">{acao}</div>}
        </div>
        {children}
      </Card>
    </section>
  );
}

/* ============================================================ TEXTO */

/** Texto longo: vira parágrafo na leitura e caixa de texto na edição. */
export function TextoLongo({
  label,
  value,
  editando,
  onChange,
  placeholder,
  linhas = 5,
}: {
  label?: string;
  value: string;
  editando: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  linhas?: number;
}) {
  return (
    <div>
      {label && (
        <p className="mb-1.5 text-[13px] font-medium text-slate-700">{label}</p>
      )}
      {editando ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={linhas}
          placeholder={placeholder}
          className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
        />
      ) : value.trim() ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
          {value}
        </p>
      ) : (
        <p className="text-sm italic text-slate-300">Não preenchido</p>
      )}
    </div>
  );
}

/* ============================================================ TABELA */

export type ColDef = {
  key: string;
  label: string;
  tipo?: "texto" | "numero" | "area" | "select" | "url";
  opcoes?: { value: string; label: string }[];
  largura?: string;
  alinha?: "left" | "right";
  placeholder?: string;
  /** Número que é dinheiro: na leitura sai como R$, igual ao total. */
  moeda?: boolean;
};

export type Linha = Record<string, string | number | boolean | null>;

/**
 * Tabela editável genérica — serve para variações, posições, DRE, etapas e
 * materiais. Na leitura vira tabela limpa; na edição, cada célula é um campo
 * e aparecem os botões de adicionar/remover linha.
 */
export function TabelaEditavel({
  cols,
  linhas,
  editando,
  onChange,
  novaLinha,
  textoAdicionar = "Adicionar linha",
  vazio = "Nenhuma linha cadastrada",
  rodape,
}: {
  cols: ColDef[];
  linhas: Linha[];
  editando: boolean;
  onChange: (linhas: Linha[]) => void;
  novaLinha: () => Linha;
  textoAdicionar?: string;
  vazio?: string;
  rodape?: React.ReactNode;
}) {
  function setCelula(i: number, key: string, v: string | number | boolean | null) {
    const copia = linhas.map((l, idx) => (idx === i ? { ...l, [key]: v } : l));
    onChange(copia);
  }
  function remover(i: number) {
    onChange(linhas.filter((_, idx) => idx !== i));
  }

  if (!editando && linhas.length === 0) {
    return <p className="text-sm italic text-slate-300">{vazio}</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2.5 font-medium ${
                    c.alinha === "right" ? "text-right" : ""
                  }`}
                  style={c.largura ? { width: c.largura } : undefined}
                >
                  {c.label}
                </th>
              ))}
              {editando && <th className="w-10 px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {linhas.map((l, i) => (
              <tr key={i} className="align-top">
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 ${
                      c.alinha === "right" ? "text-right" : ""
                    }`}
                  >
                    {editando ? (
                      <Celula
                        col={c}
                        valor={l[c.key]}
                        onChange={(v) => setCelula(i, c.key, v)}
                      />
                    ) : (
                      <LeituraCelula col={c} valor={l[c.key]} />
                    )}
                  </td>
                ))}
                {editando && (
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => remover(i)}
                      aria-label="Remover linha"
                      className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {rodape}
        </table>
      </div>

      {editando && (
        <button
          type="button"
          onClick={() => onChange([...linhas, novaLinha()])}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600"
        >
          <Plus className="size-4" /> {textoAdicionar}
        </button>
      )}
    </div>
  );
}

const celulaCls =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-300 outline-none transition focus:border-brand-400";

function Celula({
  col,
  valor,
  onChange,
}: {
  col: ColDef;
  valor: string | number | boolean | null;
  onChange: (v: string | number | boolean | null) => void;
}) {
  if (col.tipo === "select") {
    return (
      <select
        value={String(valor ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className={celulaCls}
      >
        {(col.opcoes ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (col.tipo === "numero") {
    return (
      <input
        type="number"
        step="any"
        value={valor === null || valor === undefined ? "" : String(valor)}
        onChange={(e) =>
          // campo vazio vira null (= "não informado"), não zero
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        placeholder={col.placeholder}
        className={`${celulaCls} text-right`}
      />
    );
  }
  if (col.tipo === "area") {
    return (
      <textarea
        value={String(valor ?? "")}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={col.placeholder}
        className={`${celulaCls} resize-y leading-relaxed`}
      />
    );
  }
  return (
    <input
      value={String(valor ?? "")}
      onChange={(e) => onChange(e.target.value)}
      placeholder={col.placeholder}
      className={celulaCls}
    />
  );
}

function LeituraCelula({
  col,
  valor,
}: {
  col: ColDef;
  valor: string | number | boolean | null;
}) {
  if (valor === null || valor === undefined || valor === "") {
    return <span className="text-slate-300">—</span>;
  }
  if (col.tipo === "url") {
    return (
      <a
        href={String(valor)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-brand-600 hover:underline"
      >
        Abrir <ExternalLink className="size-3" />
      </a>
    );
  }
  if (col.tipo === "numero") {
    const n = Number(valor);
    return (
      <span className="tabular-nums">
        {col.moeda
          ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          : formatarNumero(n)}
      </span>
    );
  }
  return (
    <span className="whitespace-pre-wrap leading-relaxed text-slate-600">
      {String(valor)}
    </span>
  );
}

function formatarNumero(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
